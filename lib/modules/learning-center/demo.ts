// DemoLitmosSource — a seeded, fully mutable in-memory Litmos tenant. Active
// whenever no LITMOS_API_KEY is configured (or LEARNING_CENTER_DEMO=1), so the
// entire Learning Center — learner view, team-admin dashboard, rules engine,
// notifications, duplication — works end-to-end with zero external calls.
//
// The seed models Jericho's real tenant shape: customer organizations as teams
// (with sub-teams), one team on a custom brand (Meridian Health — its admins
// may manage notification templates) and one on the Jericho default brand
// (Northwind Logistics — notifications locked), security-awareness courses with
// due-date/compliance configs in every interesting state, learning paths, and
// gamification data. Mutations persist for the process lifetime (globalThis).

import type {
  CourseShellInput,
  CreateUserInput,
  GamificationSummary,
  LitmosAchievement,
  LitmosBadge,
  LitmosCourse,
  LitmosCourseDetail,
  LitmosCourseUserStatus,
  LitmosLearningPath,
  LitmosModule,
  LitmosResultRow,
  LitmosTeam,
  LitmosUser,
  LitmosUserCourse,
  LitmosUserDetail,
  LitmosUserLearningPath,
  TeamGamificationEntry,
  UpdateUserInput,
} from "./types";
import { LitmosError } from "./types";
import type { LitmosSource, ModuleAttachMode } from "./source";

const DAY = 86_400_000;

interface UserCourseState {
  assignedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  pct: number;
  score: number | null;
  compliantTill: number | null;
  updatedAt: number;
  viaLearningPath: string | null;
  viaTeam: string | null;
}

interface DemoState {
  seq: number;
  users: Map<string, LitmosUserDetail>;
  teams: Map<string, LitmosTeam>;
  teamMembers: Map<string, Set<string>>;
  teamAdmins: Map<string, Set<string>>;
  teamLeaders: Map<string, Set<string>>;
  courses: Map<string, LitmosCourseDetail>;
  courseModules: Map<string, LitmosModule[]>;
  learningPaths: Map<string, LitmosLearningPath>;
  lpCourses: Map<string, string[]>;
  // teamId -> courseId -> { library } (library=true is the team's optional
  // self-signup library; library=false is an assignment)
  teamCourses: Map<string, Map<string, { library: boolean }>>;
  teamLps: Map<string, Set<string>>;
  userCourses: Map<string, Map<string, UserCourseState>>;
  userLps: Map<string, Map<string, { assignedAt: number }>>;
  badges: Map<string, LitmosBadge[]>;
  bonusPoints: Map<string, number>;
  achievements: LitmosAchievement[];
}

function iso(ms: number | null | undefined): string | undefined {
  return ms == null ? undefined : new Date(ms).toISOString();
}

function courseDueAtMs(course: LitmosCourseDetail, assignedAt: number): number | null {
  if (course.DueDate) {
    const t = Date.parse(course.DueDate);
    return Number.isNaN(t) ? null : t;
  }
  if (course.DueDateSpan != null) return assignedAt + course.DueDateSpan * DAY;
  return null;
}

// ─── seed ─────────────────────────────────────────────────────────────────────

function seed(): DemoState {
  const now = Date.now();
  const s: DemoState = {
    seq: 1000,
    users: new Map(),
    teams: new Map(),
    teamMembers: new Map(),
    teamAdmins: new Map(),
    teamLeaders: new Map(),
    courses: new Map(),
    courseModules: new Map(),
    learningPaths: new Map(),
    lpCourses: new Map(),
    teamCourses: new Map(),
    teamLps: new Map(),
    userCourses: new Map(),
    userLps: new Map(),
    badges: new Map(),
    bonusPoints: new Map(),
    achievements: [],
  };

  const team = (id: string, name: string, parent: string | null, description = "") => {
    s.teams.set(id, { Id: id, Name: name, Description: description, ParentTeamId: parent });
    s.teamMembers.set(id, new Set());
    s.teamAdmins.set(id, new Set());
    s.teamLeaders.set(id, new Set());
    s.teamCourses.set(id, new Map());
    s.teamLps.set(id, new Set());
  };

  team("t-meridian", "Meridian Health", null, "Regional healthcare network — custom brand");
  team("t-clinical", "Clinical Operations", "t-meridian");
  team("t-nursing", "Nursing", "t-clinical");
  team("t-revenue", "Revenue Cycle", "t-meridian");
  team("t-itsec", "IT & Security", "t-meridian");
  team("t-northwind", "Northwind Logistics", null, "Freight & logistics — Jericho default brand");
  team("t-drivers", "Drivers", "t-northwind");

  const user = (
    id: string,
    first: string,
    last: string,
    email: string,
    opts: { access?: string; brand?: string; title?: string; company?: string; active?: boolean; createdDaysAgo?: number } = {},
  ) => {
    s.users.set(id, {
      Id: id,
      UserName: email,
      FirstName: first,
      LastName: last,
      FullName: `${first} ${last}`,
      Email: email,
      Active: opts.active ?? true,
      AccessLevel: opts.access ?? "Learner",
      Brand: opts.brand ?? "",
      CompanyName: opts.company ?? "",
      JobTitle: opts.title ?? "",
      DisableMessages: false,
      SkipFirstLogin: false,
      IsCustomUsername: false,
      LoginKey: `https://jerichosecurity.litmos.com/account/Login?loginkey=DEMO-${id}`,
      CreatedDate: iso(now - (opts.createdDaysAgo ?? 90) * DAY),
      LastLogin: iso(now - 2 * DAY),
    });
    s.userCourses.set(id, new Map());
    s.userLps.set(id, new Map());
    s.badges.set(id, []);
  };

  // Jericho staff (account level)
  user("u-matt", "Matt", "Rinehart", "matt@jerichosecurity.com", { access: "Account_Owner", company: "Jericho Security", title: "Account Owner" });

  // Meridian Health (custom brand) — admins + members
  const MH = { brand: "Meridian Health", company: "Meridian Health" };
  user("u-sasha", "Sasha", "Nguyen", "admin@meridianhealth.com", { ...MH, title: "Security Training Lead" });
  user("u-omar", "Omar", "Haddad", "omar.haddad@meridianhealth.com", { ...MH, title: "Clinical Ops Manager" });
  user("u-priya", "Priya", "Raman", "priya.raman@meridianhealth.com", { ...MH, title: "Nurse Educator" });
  user("u-dana", "Dana", "Kowalski", "dana.kowalski@meridianhealth.com", { ...MH, title: "Charge Nurse" });
  user("u-leo", "Leo", "Fontaine", "leo.fontaine@meridianhealth.com", { ...MH, title: "RN" });
  user("u-grace", "Grace", "Okafor", "grace.okafor@meridianhealth.com", { ...MH, title: "RN" });
  user("u-tomas", "Tomas", "Silva", "tomas.silva@meridianhealth.com", { ...MH, title: "Billing Specialist" });
  user("u-june", "June", "Park", "june.park@meridianhealth.com", { ...MH, title: "Revenue Analyst" });
  user("u-arjun", "Arjun", "Mehta", "arjun.mehta@meridianhealth.com", { ...MH, title: "Systems Administrator" });
  user("u-bea", "Bea", "Lindqvist", "bea.lindqvist@meridianhealth.com", { ...MH, title: "Security Analyst" });
  user("u-noor", "Noor", "Al-Sayed", "noor.alsayed@meridianhealth.com", { ...MH, title: "Help Desk" });
  user("u-felix", "Felix", "Abara", "felix.abara@meridianhealth.com", { ...MH, title: "Intake Coordinator", createdDaysAgo: 3 });
  user("u-ines", "Ines", "Moreau", "ines.moreau@meridianhealth.com", { ...MH, title: "Scheduler", active: false });

  // Northwind Logistics (Jericho default brand)
  const NW = { brand: "Jericho Security", company: "Northwind Logistics" };
  user("u-hank", "Hank", "Bauer", "hank.bauer@northwindlogistics.com", { ...NW, title: "Operations Director" });
  user("u-rosa", "Rosa", "Delgado", "rosa.delgado@northwindlogistics.com", { ...NW, title: "Dispatch Lead" });
  user("u-kofi", "Kofi", "Mensah", "kofi.mensah@northwindlogistics.com", { ...NW, title: "Driver" });
  user("u-lena", "Lena", "Hoffman", "lena.hoffman@northwindlogistics.com", { ...NW, title: "Driver" });
  user("u-sven", "Sven", "Eriksen", "sven.eriksen@northwindlogistics.com", { ...NW, title: "Warehouse Supervisor" });

  const addTo = (teamId: string, ...userIds: string[]) => {
    for (const uid of userIds) s.teamMembers.get(teamId)!.add(uid);
  };
  addTo("t-meridian", "u-sasha", "u-omar", "u-tomas", "u-arjun", "u-felix", "u-ines");
  addTo("t-clinical", "u-omar", "u-priya", "u-dana");
  addTo("t-nursing", "u-priya", "u-dana", "u-leo", "u-grace");
  addTo("t-revenue", "u-tomas", "u-june");
  addTo("t-itsec", "u-arjun", "u-bea", "u-noor");
  addTo("t-northwind", "u-hank", "u-rosa", "u-sven");
  addTo("t-drivers", "u-kofi", "u-lena", "u-rosa");

  s.teamAdmins.get("t-meridian")!.add("u-sasha");
  s.teamAdmins.get("t-clinical")!.add("u-omar");
  s.teamAdmins.get("t-northwind")!.add("u-hank");
  s.teamLeaders.get("t-nursing")!.add("u-priya");
  s.teamLeaders.get("t-revenue")!.add("u-june");

  const course = (
    id: string,
    name: string,
    opts: {
      code: string;
      description: string;
      tags: string[];
      active?: boolean;
      library?: boolean;
      dueSpan?: number;
      dueDate?: string;
      complianceSpan?: number;
      retake?: boolean;
      certificate?: boolean;
      modules: string[];
      createdDaysAgo?: number;
    },
  ) => {
    s.courses.set(id, {
      Id: id,
      Code: opts.code,
      Name: name,
      Active: opts.active ?? true,
      Description: opts.description,
      IncludeInLibrary: opts.library ?? true,
      DueDate: opts.dueDate ?? null,
      DueDateSpan: opts.dueSpan ?? null,
      ComplianceDateSpan: opts.complianceSpan ?? null,
      ComplianceRetake: opts.retake ?? false,
      Certificate: opts.certificate ?? false,
      Tags: opts.tags,
      Topics: opts.tags,
      CreatedDate: iso(now - (opts.createdDaysAgo ?? 200) * DAY),
      CreatedBy: "Jericho Content Team",
    });
    s.courseModules.set(
      id,
      opts.modules.map((m, i) => ({ Id: `${id}-m${i + 1}`, Code: `${opts.code}-M${i + 1}`, Name: m, Description: "" })),
    );
  };

  course("c-phish", "Phishing Foundations", {
    code: "JS-PHISH-101",
    description: "Spot and report the phishing lures that actually land in 2026 — from QR-code bait to consent-screen hijacks.",
    tags: ["Phishing"],
    complianceSpan: 365,
    retake: true,
    certificate: true,
    modules: ["The Anatomy of a Lure", "QR & Callback Phishing", "Simulation Lab", "Assessment"],
  });
  course("c-spear", "Spear Phishing & Executive Whaling", {
    code: "JS-PHISH-201",
    description: "Targeted attacks on finance and leadership: BEC, invoice fraud, and thread hijacking.",
    tags: ["Phishing"],
    dueSpan: 30,
    modules: ["Recon: How Attackers Pick You", "Business Email Compromise", "Assessment"],
    createdDaysAgo: 120,
  });
  course("c-deepfake", "Deepfake Defense: Voice & Video", {
    code: "JS-AI-301",
    description: "Verify before you trust — detecting synthetic voice calls and video imposters in real workflows.",
    tags: ["AI Threats"],
    dueSpan: 21,
    certificate: true,
    modules: ["Voice Cloning in the Wild", "Video Imposters on Calls", "Verification Playbook", "Assessment"],
    createdDaysAgo: 30,
  });
  course("c-social", "Social Engineering Red Flags", {
    code: "JS-SE-101",
    description: "Pretexting, tailgating, and urgency traps — the human exploits behind most breaches.",
    tags: ["Fundamentals"],
    modules: ["Pretexting & Impersonation", "Physical Social Engineering", "Assessment"],
  });
  course("c-passkey", "Password & Passkey Hygiene", {
    code: "JS-ID-101",
    description: "From password managers to passkeys: locking down the credentials attackers want most.",
    tags: ["Fundamentals"],
    modules: ["Why Passwords Fail", "Passkeys in Practice", "Assessment"],
  });
  course("c-mfa", "MFA Everywhere", {
    code: "JS-ID-201",
    description: "Phishing-resistant MFA, fatigue attacks, and what to do when a prompt you didn't request appears.",
    tags: ["Fundamentals"],
    dueSpan: 45,
    modules: ["MFA Fatigue Attacks", "Choosing Strong Factors", "Assessment"],
  });
  course("c-report", "Reporting Suspicious Activity", {
    code: "JS-IR-101",
    description: "See something, say something — how and when to escalate, and why fast reports save incidents.",
    tags: ["Fundamentals"],
    dueSpan: 14,
    modules: ["The Reporting Flow", "Assessment"],
  });
  course("c-data", "Data Handling & Classification", {
    code: "JS-DATA-201",
    description: "Classify, store, and share data safely — public to restricted, on every channel.",
    tags: ["Compliance"],
    complianceSpan: 180,
    retake: true,
    modules: ["Classification Levels", "Safe Sharing", "Assessment"],
  });
  course("c-incident", "Incident Response Basics", {
    code: "JS-IR-201",
    description: "The first hour of an incident: containment, communication, and what not to delete.",
    tags: ["Response"],
    modules: ["First-Hour Playbook", "Tabletop Exercise", "Assessment"],
  });
  course("c-remote", "Secure Remote Work", {
    code: "JS-OPS-101",
    description: "Home networks, public Wi-Fi, and travel: keeping company data safe outside the office.",
    tags: ["Fundamentals"],
    modules: ["Home Network Hardening", "Travel Security", "Assessment"],
  });
  course("c-ai", "AI Threats: Prompt Injection Awareness", {
    code: "JS-AI-101",
    description: "How attackers weaponize AI assistants — poisoned documents, injected instructions, data exfil.",
    tags: ["AI Threats"],
    certificate: true,
    modules: ["Prompt Injection 101", "Safe AI Workflows", "Assessment"],
    createdDaysAgo: 14,
  });
  course("c-hipaa", "HIPAA Privacy Essentials", {
    code: "JS-HC-301",
    description: "PHI handling for healthcare teams: minimum necessary, disclosures, and breach duties.",
    tags: ["Compliance", "Healthcare"],
    complianceSpan: 365,
    retake: true,
    certificate: true,
    modules: ["PHI & Minimum Necessary", "Permitted Disclosures", "Breach Notification", "Assessment"],
  });
  course("c-pci", "PCI Basics for Billing Teams", {
    code: "JS-FIN-201",
    description: "Cardholder data rules for anyone who touches payments.",
    tags: ["Compliance"],
    complianceSpan: 365,
    modules: ["Cardholder Data Rules", "Assessment"],
  });
  course("c-newhire", "New Hire Security Orientation", {
    code: "JS-ONB-101",
    description: "Day-one security: accounts, devices, phishing reporting, and who to call.",
    tags: ["Onboarding"],
    dueSpan: 7,
    library: false,
    modules: ["Welcome to Security", "Your First Week Checklist", "Assessment"],
  });
  course("c-legacy", "Security Awareness 2019 (Legacy)", {
    code: "JS-LEG-001",
    description: "Retired annual awareness course kept for records.",
    tags: ["Fundamentals"],
    active: false,
    modules: ["Legacy Content"],
    createdDaysAgo: 2400,
  });

  const lp = (id: string, name: string, description: string, courses: string[]) => {
    s.learningPaths.set(id, { Id: id, Name: name, Description: description, Active: true, LearningPathTeamLibrary: false });
    s.lpCourses.set(id, courses);
  };
  lp("lp-core", "Security Awareness Core", "The four-course foundation every employee completes.", ["c-phish", "c-social", "c-passkey", "c-report"]);
  lp("lp-health", "Healthcare Compliance Track", "HIPAA + data handling for clinical and revenue teams.", ["c-hipaa", "c-data"]);
  lp("lp-onboard", "New Hire Onboarding", "Orientation plus MFA setup for new joiners.", ["c-newhire", "c-mfa"]);

  // Team content. Assignments (library:false) reach every member; library
  // entries are optional self-signup content.
  const teamCourse = (teamId: string, courseId: string, library: boolean) => {
    s.teamCourses.get(teamId)!.set(courseId, { library });
  };
  teamCourse("t-meridian", "c-phish", false);
  teamCourse("t-meridian", "c-deepfake", false);
  teamCourse("t-meridian", "c-report", false);
  teamCourse("t-meridian", "c-ai", true);
  teamCourse("t-meridian", "c-remote", true);
  teamCourse("t-meridian", "c-incident", true);
  teamCourse("t-clinical", "c-hipaa", false);
  teamCourse("t-nursing", "c-hipaa", false);
  teamCourse("t-revenue", "c-pci", false);
  teamCourse("t-revenue", "c-hipaa", false);
  teamCourse("t-itsec", "c-incident", false);
  teamCourse("t-northwind", "c-phish", false);
  teamCourse("t-northwind", "c-social", false);
  teamCourse("t-drivers", "c-remote", false);
  s.teamLps.get("t-meridian")!.add("lp-core");
  s.teamLps.get("t-itsec")!.add("lp-health");

  // Per-user assignment states in every interesting shape: completed (some
  // compliant, some expiring, some lapsed), in progress, not started, overdue.
  const uc = (
    userId: string,
    courseId: string,
    st: { assignedDaysAgo: number; pct?: number; completedDaysAgo?: number; score?: number; viaTeam?: string; viaLp?: string },
  ) => {
    const assignedAt = now - st.assignedDaysAgo * DAY;
    const completedAt = st.completedDaysAgo != null ? now - st.completedDaysAgo * DAY : null;
    const c = s.courses.get(courseId)!;
    const compliantTill =
      completedAt != null && c.ComplianceDateSpan != null ? completedAt + c.ComplianceDateSpan * DAY : null;
    s.userCourses.get(userId)!.set(courseId, {
      assignedAt,
      startedAt: st.pct || completedAt ? assignedAt + DAY : null,
      completedAt,
      pct: completedAt != null ? 100 : (st.pct ?? 0),
      score: st.score ?? (completedAt != null ? 88 : null),
      compliantTill,
      updatedAt: completedAt ?? assignedAt,
      viaLearningPath: st.viaLp ?? null,
      viaTeam: st.viaTeam ?? null,
    });
    if (completedAt != null) {
      s.achievements.push({
        UserId: userId,
        Title: c.Name,
        AchievementDate: new Date(completedAt).toISOString(),
        CourseId: courseId,
        Type: "Course Completed",
        Score: st.score ?? 88,
        CertificateId: c.Certificate ? `cert-${userId}-${courseId}` : undefined,
        FirstName: s.users.get(userId)!.FirstName,
        LastName: s.users.get(userId)!.LastName,
      });
    }
  };

  // Meridian core assignments (via t-meridian)
  const meridianMembers = ["u-sasha", "u-omar", "u-tomas", "u-arjun", "u-felix"];
  uc("u-sasha", "c-phish", { assignedDaysAgo: 400, completedDaysAgo: 200, score: 97, viaTeam: "t-meridian" }); // compliant till +165d
  uc("u-omar", "c-phish", { assignedDaysAgo: 400, completedDaysAgo: 355, score: 84, viaTeam: "t-meridian" }); // expiring in ~10d
  uc("u-tomas", "c-phish", { assignedDaysAgo: 400, completedDaysAgo: 390, score: 76, viaTeam: "t-meridian" }); // LAPSED 25d ago
  uc("u-arjun", "c-phish", { assignedDaysAgo: 60, completedDaysAgo: 50, score: 92, viaTeam: "t-meridian" });
  uc("u-felix", "c-phish", { assignedDaysAgo: 3, pct: 25, viaTeam: "t-meridian" });
  uc("u-sasha", "c-deepfake", { assignedDaysAgo: 28, completedDaysAgo: 20, score: 91, viaTeam: "t-meridian" });
  uc("u-omar", "c-deepfake", { assignedDaysAgo: 28, pct: 60, viaTeam: "t-meridian" }); // due 21d after assign → OVERDUE 7d
  uc("u-tomas", "c-deepfake", { assignedDaysAgo: 28, pct: 0, viaTeam: "t-meridian" }); // OVERDUE, not started
  uc("u-arjun", "c-deepfake", { assignedDaysAgo: 10, pct: 35, viaTeam: "t-meridian" }); // due in 11d
  uc("u-felix", "c-deepfake", { assignedDaysAgo: 3, pct: 0, viaTeam: "t-meridian" }); // due in 18d
  uc("u-sasha", "c-report", { assignedDaysAgo: 90, completedDaysAgo: 85, score: 100, viaTeam: "t-meridian" });
  uc("u-omar", "c-report", { assignedDaysAgo: 90, completedDaysAgo: 80, score: 90, viaTeam: "t-meridian" });
  uc("u-tomas", "c-report", { assignedDaysAgo: 20, pct: 0, viaTeam: "t-meridian" }); // OVERDUE (14d span)
  uc("u-arjun", "c-report", { assignedDaysAgo: 9, pct: 50, viaTeam: "t-meridian" }); // due in 5d
  uc("u-felix", "c-report", { assignedDaysAgo: 3, pct: 0, viaTeam: "t-meridian" }); // due in 11d

  // Clinical / Nursing HIPAA (compliance course)
  uc("u-omar", "c-hipaa", { assignedDaysAgo: 380, completedDaysAgo: 350, score: 89, viaTeam: "t-clinical" }); // expiring in ~15d
  uc("u-priya", "c-hipaa", { assignedDaysAgo: 380, completedDaysAgo: 100, score: 96, viaTeam: "t-nursing" });
  uc("u-dana", "c-hipaa", { assignedDaysAgo: 380, completedDaysAgo: 372, score: 81, viaTeam: "t-nursing" }); // LAPSED 7d ago
  uc("u-leo", "c-hipaa", { assignedDaysAgo: 45, pct: 70, viaTeam: "t-nursing" });
  uc("u-grace", "c-hipaa", { assignedDaysAgo: 45, completedDaysAgo: 30, score: 93, viaTeam: "t-nursing" });

  // Revenue Cycle
  uc("u-tomas", "c-pci", { assignedDaysAgo: 200, completedDaysAgo: 190, score: 85, viaTeam: "t-revenue" });
  uc("u-june", "c-pci", { assignedDaysAgo: 200, pct: 40, viaTeam: "t-revenue" });
  uc("u-june", "c-hipaa", { assignedDaysAgo: 200, completedDaysAgo: 170, score: 88, viaTeam: "t-revenue" });

  // IT & Security
  uc("u-arjun", "c-incident", { assignedDaysAgo: 120, completedDaysAgo: 100, score: 94, viaTeam: "t-itsec" });
  uc("u-bea", "c-incident", { assignedDaysAgo: 120, completedDaysAgo: 90, score: 98, viaTeam: "t-itsec" });
  uc("u-noor", "c-incident", { assignedDaysAgo: 120, pct: 15, viaTeam: "t-itsec" });
  uc("u-bea", "c-ai", { assignedDaysAgo: 12, completedDaysAgo: 8, score: 100 }); // self-enrolled from library
  uc("u-arjun", "c-ai", { assignedDaysAgo: 10, pct: 45 });

  // LP assignments (Security Awareness Core → Meridian members)
  for (const uid of meridianMembers) {
    s.userLps.get(uid)!.set("lp-core", { assignedAt: now - 400 * DAY });
    for (const cid of ["c-social", "c-passkey"]) {
      if (!s.userCourses.get(uid)!.has(cid)) {
        uc(uid, cid, uid === "u-felix" ? { assignedDaysAgo: 3, pct: 0, viaLp: "lp-core" } : { assignedDaysAgo: 400, completedDaysAgo: 340, score: 87, viaLp: "lp-core" });
      }
    }
  }

  // Northwind
  uc("u-hank", "c-phish", { assignedDaysAgo: 100, completedDaysAgo: 92, score: 90, viaTeam: "t-northwind" });
  uc("u-rosa", "c-phish", { assignedDaysAgo: 100, completedDaysAgo: 70, score: 82, viaTeam: "t-northwind" });
  uc("u-sven", "c-phish", { assignedDaysAgo: 100, pct: 55, viaTeam: "t-northwind" });
  uc("u-hank", "c-social", { assignedDaysAgo: 100, completedDaysAgo: 60, score: 88, viaTeam: "t-northwind" });
  uc("u-rosa", "c-social", { assignedDaysAgo: 100, pct: 30, viaTeam: "t-northwind" });
  uc("u-sven", "c-social", { assignedDaysAgo: 100, pct: 0, viaTeam: "t-northwind" });
  uc("u-kofi", "c-remote", { assignedDaysAgo: 40, completedDaysAgo: 33, score: 79, viaTeam: "t-drivers" });
  uc("u-lena", "c-remote", { assignedDaysAgo: 40, pct: 20, viaTeam: "t-drivers" });
  uc("u-rosa", "c-remote", { assignedDaysAgo: 40, completedDaysAgo: 25, score: 91, viaTeam: "t-drivers" });

  // Badges + bonus points (beyond completion-derived points)
  const badge = (userId: string, id: string, title: string, description: string, color: string) => {
    s.badges.get(userId)!.push({ Id: id, Title: title, Description: description, IconBadgeColor: color });
  };
  badge("u-bea", "b-fast", "Fast Finisher", "Completed a course within 48 hours of assignment", "#6119E5");
  badge("u-bea", "b-ai", "AI Sentinel", "Completed every AI Threats course", "#F4A301");
  badge("u-sasha", "b-phish", "Phish Spotter", "Perfect score on a phishing assessment", "#6119E5");
  badge("u-priya", "b-comp", "Compliance Champion", "All compliance courses current", "#6119E5");
  badge("u-arjun", "b-fast", "Fast Finisher", "Completed a course within 48 hours of assignment", "#6119E5");
  badge("u-hank", "b-phish", "Phish Spotter", "Perfect score on a phishing assessment", "#6119E5");
  s.bonusPoints.set("u-bea", 250);
  s.bonusPoints.set("u-sasha", 150);
  s.bonusPoints.set("u-priya", 120);
  s.bonusPoints.set("u-arjun", 80);
  s.bonusPoints.set("u-hank", 60);

  return s;
}

// ─── source implementation ────────────────────────────────────────────────────

export class DemoLitmosSource implements LitmosSource {
  readonly mode = "demo" as const;
  private readonly s: DemoState;

  constructor(state: DemoState) {
    this.s = state;
  }

  private userBrief(u: LitmosUserDetail): LitmosUser {
    const { Id, UserName, FirstName, LastName, Email, Active, AccessLevel, Brand } = u;
    return { Id, UserName, FirstName, LastName, Email, Active, AccessLevel, Brand };
  }

  private courseBrief(c: LitmosCourseDetail): LitmosCourse {
    const { Id, Code, Name, Active, Description, Tags, CreatedBy } = c;
    return { Id, Code, Name, Active, Description, Tags, CreatedBy };
  }

  private pointsFor(userId: string): { points: number; badges: number } {
    // 100 points per completion + seeded bonus, matching how Litmos gamification
    // accrues per trigger event.
    const completions = [...(this.s.userCourses.get(userId)?.values() ?? [])].filter((st) => st.completedAt != null).length;
    return { points: completions * 100 + (this.s.bonusPoints.get(userId) ?? 0), badges: (this.s.badges.get(userId) ?? []).length };
  }

  // ── users ──────────────────────────────────────────────────────────────────

  async listUsers(opts?: { search?: string }): Promise<LitmosUser[]> {
    const q = opts?.search?.trim().toLowerCase();
    let rows = [...this.s.users.values()];
    if (q) {
      rows = rows.filter((u) =>
        [u.Email, u.UserName, u.FirstName, u.LastName, `${u.FirstName} ${u.LastName}`].some((f) => f?.toLowerCase().includes(q)),
      );
    }
    return rows.map((u) => this.userBrief(u));
  }

  async getUser(id: string): Promise<LitmosUserDetail | null> {
    const u = this.s.users.get(id);
    return u ? { ...u, Points: this.pointsFor(id).points } : null;
  }

  async findUserByEmail(email: string): Promise<LitmosUser | null> {
    const target = email.trim().toLowerCase();
    for (const u of this.s.users.values()) {
      if (u.Email.toLowerCase() === target || u.UserName.toLowerCase() === target) return this.userBrief(u);
    }
    return null;
  }

  async createUser(input: CreateUserInput): Promise<LitmosUserDetail> {
    const email = input.Email.trim();
    if (await this.findUserByEmail(email)) throw new LitmosError(409, "A user with this username/email already exists.");
    const id = `u-demo-${this.s.seq++}`;
    const record: LitmosUserDetail = {
      Id: id,
      UserName: email.toLowerCase(),
      FirstName: input.FirstName,
      LastName: input.LastName,
      FullName: `${input.FirstName} ${input.LastName}`,
      Email: email,
      Active: true,
      AccessLevel: input.AccessLevel ?? "Learner",
      Brand: input.Brand ?? "",
      CompanyName: input.CompanyName ?? "",
      JobTitle: input.JobTitle ?? "",
      DisableMessages: false,
      LoginKey: `https://jerichosecurity.litmos.com/account/Login?loginkey=DEMO-${id}`,
      CreatedDate: new Date().toISOString(),
    };
    this.s.users.set(id, record);
    this.s.userCourses.set(id, new Map());
    this.s.userLps.set(id, new Map());
    this.s.badges.set(id, []);
    return record;
  }

  async updateUser(id: string, patch: UpdateUserInput): Promise<void> {
    const u = this.s.users.get(id);
    if (!u) throw new LitmosError(404, "User not found.");
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (u as unknown as Record<string, unknown>)[k] = v;
    }
    u.FullName = `${u.FirstName} ${u.LastName}`;
    if (patch.Email) u.UserName = patch.Email.trim().toLowerCase();
  }

  // ── teams ──────────────────────────────────────────────────────────────────

  async listTeams(): Promise<LitmosTeam[]> {
    return [...this.s.teams.values()].map((t) => ({ ...t }));
  }

  async getTeam(id: string): Promise<LitmosTeam | null> {
    const t = this.s.teams.get(id);
    return t ? { ...t } : null;
  }

  async createSubTeam(parentId: string, name: string, description?: string): Promise<LitmosTeam> {
    if (!this.s.teams.has(parentId)) throw new LitmosError(404, "Parent team not found.");
    const id = `t-demo-${this.s.seq++}`;
    const team: LitmosTeam = { Id: id, Name: name, Description: description ?? "", ParentTeamId: parentId };
    this.s.teams.set(id, team);
    this.s.teamMembers.set(id, new Set());
    this.s.teamAdmins.set(id, new Set());
    this.s.teamLeaders.set(id, new Set());
    this.s.teamCourses.set(id, new Map());
    this.s.teamLps.set(id, new Set());
    return team;
  }

  async listTeamUsers(teamId: string): Promise<LitmosUser[]> {
    const ids = this.s.teamMembers.get(teamId);
    if (!ids) throw new LitmosError(404, "Team not found.");
    // Litmos returns only ACTIVE users on this endpoint.
    return [...ids]
      .map((id) => this.s.users.get(id))
      .filter((u): u is LitmosUserDetail => !!u && u.Active)
      .map((u) => this.userBrief(u));
  }

  async addUsersToTeam(teamId: string, userIds: string[], _sendMessage: boolean): Promise<void> {
    const members = this.s.teamMembers.get(teamId);
    if (!members) throw new LitmosError(404, "Team not found.");
    const now = Date.now();
    for (const uid of userIds) {
      if (!this.s.users.has(uid)) throw new LitmosError(404, "Invalid user id in the list.");
      members.add(uid);
      // Team-assigned content auto-applies to members who join later — mirror
      // Litmos's core propagation behavior.
      for (const [courseId, tc] of this.s.teamCourses.get(teamId) ?? []) {
        if (!tc.library && !this.s.userCourses.get(uid)!.has(courseId)) {
          this.s.userCourses.get(uid)!.set(courseId, {
            assignedAt: now,
            startedAt: null,
            completedAt: null,
            pct: 0,
            score: null,
            compliantTill: null,
            updatedAt: now,
            viaLearningPath: null,
            viaTeam: teamId,
          });
        }
      }
    }
  }

  async removeUserFromTeam(teamId: string, userId: string): Promise<void> {
    const members = this.s.teamMembers.get(teamId);
    if (!members?.has(userId)) throw new LitmosError(404, "User does not exist on the team.");
    members.delete(userId);
    this.s.teamAdmins.get(teamId)?.delete(userId);
    this.s.teamLeaders.get(teamId)?.delete(userId);
  }

  async listUserTeams(userId: string): Promise<LitmosTeam[]> {
    if (!this.s.users.has(userId)) throw new LitmosError(404, "User not found.");
    const out: LitmosTeam[] = [];
    for (const [teamId, members] of this.s.teamMembers) {
      if (members.has(userId)) out.push({ ...this.s.teams.get(teamId)! });
    }
    return out;
  }

  async listTeamAdmins(teamId: string): Promise<LitmosUser[]> {
    const ids = this.s.teamAdmins.get(teamId);
    if (!ids) throw new LitmosError(404, "Team not found.");
    return [...ids].map((id) => this.userBrief(this.s.users.get(id)!));
  }

  async listTeamLeaders(teamId: string): Promise<LitmosUser[]> {
    const ids = this.s.teamLeaders.get(teamId);
    if (!ids) throw new LitmosError(404, "Team not found.");
    return [...ids].map((id) => this.userBrief(this.s.users.get(id)!));
  }

  private assertMember(teamId: string, userId: string): void {
    if (!this.s.teamMembers.get(teamId)?.has(userId)) throw new LitmosError(404, "User does not exist on the team.");
  }

  async promoteTeamAdmin(teamId: string, userId: string): Promise<void> {
    this.assertMember(teamId, userId);
    this.s.teamAdmins.get(teamId)!.add(userId);
  }

  async demoteTeamAdmin(teamId: string, userId: string): Promise<void> {
    this.assertMember(teamId, userId);
    this.s.teamAdmins.get(teamId)!.delete(userId);
  }

  async promoteTeamLeader(teamId: string, userId: string): Promise<void> {
    this.assertMember(teamId, userId);
    this.s.teamLeaders.get(teamId)!.add(userId);
  }

  async demoteTeamLeader(teamId: string, userId: string): Promise<void> {
    this.assertMember(teamId, userId);
    this.s.teamLeaders.get(teamId)!.delete(userId);
  }

  // ── courses ────────────────────────────────────────────────────────────────

  async listCourses(): Promise<LitmosCourse[]> {
    return [...this.s.courses.values()].map((c) => this.courseBrief(c));
  }

  async getCourseDetails(id: string): Promise<LitmosCourseDetail | null> {
    const c = this.s.courses.get(id);
    return c ? { ...c } : null;
  }

  async listCourseModules(courseId: string): Promise<LitmosModule[]> {
    return [...(this.s.courseModules.get(courseId) ?? [])];
  }

  async listCourseUsers(courseId: string): Promise<LitmosCourseUserStatus[]> {
    const course = this.s.courses.get(courseId);
    if (!course) throw new LitmosError(404, "Course not found.");
    const out: LitmosCourseUserStatus[] = [];
    for (const [userId, byCourse] of this.s.userCourses) {
      const st = byCourse.get(courseId);
      if (!st) continue;
      const u = this.s.users.get(userId)!;
      const dueAt = courseDueAtMs(course, st.assignedAt);
      out.push({
        Id: userId,
        UserName: u.UserName,
        FirstName: u.FirstName,
        LastName: u.LastName,
        Completed: st.completedAt != null,
        PercentageComplete: st.pct,
        CompliantTill: iso(st.compliantTill) ?? null,
        DueDate: iso(dueAt) ?? null,
      });
    }
    return out;
  }

  async upsertCourseShell(input: CourseShellInput): Promise<void> {
    const existing = [...this.s.courses.values()].find((c) => (c.Code ?? "").toLowerCase() === input.CourseCode.trim().toLowerCase());
    if (existing) {
      existing.Name = input.CourseTitle;
      if (input.Description !== undefined) existing.Description = input.Description;
      existing.Active = input.Active;
      if (input.ContentLibrary !== undefined) existing.IncludeInLibrary = input.ContentLibrary;
      existing.DueDate = input.DueDate ?? null;
      existing.DueDateSpan = input.DueDateSpan ?? null;
      existing.ComplianceDateSpan = input.ComplianceDateSpan ?? null;
      if (input.ComplianceRetake !== undefined) existing.ComplianceRetake = input.ComplianceRetake;
      return;
    }
    const id = `c-demo-${this.s.seq++}`;
    this.s.courses.set(id, {
      Id: id,
      Code: input.CourseCode,
      Name: input.CourseTitle,
      Active: input.Active,
      Description: input.Description ?? "",
      IncludeInLibrary: input.ContentLibrary ?? false,
      DueDate: input.DueDate ?? null,
      DueDateSpan: input.DueDateSpan ?? null,
      ComplianceDateSpan: input.ComplianceDateSpan ?? null,
      ComplianceRetake: input.ComplianceRetake ?? false,
      Certificate: false,
      Tags: [],
      CreatedDate: new Date().toISOString(),
      CreatedBy: "Learning Center",
    });
    this.s.courseModules.set(id, []);
  }

  async findCourseByCode(code: string): Promise<LitmosCourse | null> {
    const target = code.trim().toLowerCase();
    const c = [...this.s.courses.values()].find((x) => (x.Code ?? "").toLowerCase() === target);
    return c ? this.courseBrief(c) : null;
  }

  async attachModules(courseId: string, moduleIds: string[], mode: ModuleAttachMode): Promise<void> {
    const target = this.s.courseModules.get(courseId);
    if (!target || !this.s.courses.has(courseId)) throw new LitmosError(404, "Course not found.");
    const all = [...this.s.courseModules.values()].flat();
    for (const mid of moduleIds) {
      const src = all.find((m) => m.Id === mid);
      if (!src) throw new LitmosError(404, `Module ${mid} not found.`);
      if (mode === "copy") {
        target.push({ ...src, Id: `${src.Id}-copy-${this.s.seq++}` });
      } else {
        // link/mirror keep the source module's identity (shared / synchronized)
        target.push({ ...src });
      }
    }
  }

  // ── team content ───────────────────────────────────────────────────────────

  private teamCoursesMap(teamId: string): Map<string, { library: boolean }> {
    const m = this.s.teamCourses.get(teamId);
    if (!m) throw new LitmosError(404, "Team not found.");
    return m;
  }

  async listTeamCourses(teamId: string): Promise<LitmosCourse[]> {
    const m = this.teamCoursesMap(teamId);
    return [...m.entries()].map(([courseId, tc]) => ({ ...this.courseBrief(this.s.courses.get(courseId)!), CourseTeamLibrary: tc.library }));
  }

  async assignCoursesToTeam(teamId: string, courseIds: string[], opts: { library: boolean; includeSubteams: boolean }): Promise<void> {
    const targets = [teamId, ...(opts.includeSubteams ? this.descendantTeamIds(teamId) : [])];
    const now = Date.now();
    for (const cid of courseIds) {
      if (!this.s.courses.has(cid)) throw new LitmosError(404, `Course ${cid} not found.`);
    }
    for (const tid of targets) {
      const m = this.teamCoursesMap(tid);
      for (const cid of courseIds) {
        m.set(cid, { library: opts.library });
        if (!opts.library) {
          for (const uid of this.s.teamMembers.get(tid) ?? []) {
            if (!this.s.userCourses.get(uid)!.has(cid)) {
              this.s.userCourses.get(uid)!.set(cid, {
                assignedAt: now,
                startedAt: null,
                completedAt: null,
                pct: 0,
                score: null,
                compliantTill: null,
                updatedAt: now,
                viaLearningPath: null,
                viaTeam: tid,
              });
            }
          }
        }
      }
    }
  }

  async unassignCoursesFromTeam(teamId: string, courseIds: string[], library: boolean): Promise<void> {
    const m = this.teamCoursesMap(teamId);
    for (const cid of courseIds) {
      const entry = m.get(cid);
      if (entry && entry.library === library) m.delete(cid);
      // Litmos keeps individual assignment rows; we mirror that (user rows stay).
    }
  }

  async listTeamLearningPaths(teamId: string): Promise<LitmosLearningPath[]> {
    const ids = this.s.teamLps.get(teamId);
    if (!ids) throw new LitmosError(404, "Team not found.");
    return [...ids].map((id) => ({ ...this.s.learningPaths.get(id)! }));
  }

  async assignLearningPathsToTeam(teamId: string, lpIds: string[]): Promise<void> {
    const set = this.s.teamLps.get(teamId);
    if (!set) throw new LitmosError(404, "Team not found.");
    const now = Date.now();
    for (const lpId of lpIds) {
      if (!this.s.learningPaths.has(lpId)) throw new LitmosError(404, "Learning path not found.");
      set.add(lpId);
      for (const uid of this.s.teamMembers.get(teamId) ?? []) {
        this.s.userLps.get(uid)!.set(lpId, { assignedAt: now });
        for (const cid of this.s.lpCourses.get(lpId) ?? []) {
          if (!this.s.userCourses.get(uid)!.has(cid)) {
            this.s.userCourses.get(uid)!.set(cid, {
              assignedAt: now,
              startedAt: null,
              completedAt: null,
              pct: 0,
              score: null,
              compliantTill: null,
              updatedAt: now,
              viaLearningPath: lpId,
              viaTeam: teamId,
            });
          }
        }
      }
    }
  }

  async unassignLearningPathsFromTeam(teamId: string, lpIds: string[]): Promise<void> {
    const set = this.s.teamLps.get(teamId);
    if (!set) throw new LitmosError(404, "Team not found.");
    for (const lpId of lpIds) set.delete(lpId);
  }

  // ── learning paths ─────────────────────────────────────────────────────────

  async listLearningPaths(): Promise<LitmosLearningPath[]> {
    return [...this.s.learningPaths.values()].map((lp) => ({ ...lp }));
  }

  async listLearningPathCourses(lpId: string): Promise<LitmosCourse[]> {
    const ids = this.s.lpCourses.get(lpId);
    if (!ids) throw new LitmosError(404, "Learning path not found.");
    return ids.map((id) => this.courseBrief(this.s.courses.get(id)!));
  }

  // ── per-user assignments ───────────────────────────────────────────────────

  async listUserCourses(userId: string): Promise<LitmosUserCourse[]> {
    const byCourse = this.s.userCourses.get(userId);
    if (!byCourse) throw new LitmosError(404, "User not found.");
    const now = Date.now();
    return [...byCourse.entries()].map(([courseId, st]) => {
      const c = this.s.courses.get(courseId)!;
      const dueAt = courseDueAtMs(c, st.assignedAt);
      return {
        Id: courseId,
        Code: c.Code,
        Name: c.Name,
        Active: c.Active,
        Complete: st.completedAt != null,
        PercentageComplete: st.pct,
        AssignedDate: iso(st.assignedAt),
        StartDate: iso(st.startedAt),
        CompletedDate: iso(st.completedAt) ?? null,
        Overdue: st.completedAt == null && dueAt != null && dueAt < now,
        UpToDate: st.compliantTill == null || st.compliantTill > now,
        ComplaintTill: iso(st.compliantTill) ?? null,
        IsLearningPath: false,
      };
    });
  }

  async assignCoursesToUser(userId: string, courseIds: string[], _sendMessage: boolean): Promise<void> {
    const byCourse = this.s.userCourses.get(userId);
    if (!byCourse) throw new LitmosError(404, "User not found.");
    const now = Date.now();
    for (const cid of courseIds) {
      if (!this.s.courses.has(cid)) throw new LitmosError(404, `Course ${cid} not found.`);
      if (!byCourse.has(cid)) {
        byCourse.set(cid, {
          assignedAt: now,
          startedAt: null,
          completedAt: null,
          pct: 0,
          score: null,
          compliantTill: null,
          updatedAt: now,
          viaLearningPath: null,
          viaTeam: null,
        });
      }
    }
  }

  async unassignCourseFromUser(userId: string, courseId: string): Promise<void> {
    const byCourse = this.s.userCourses.get(userId);
    if (!byCourse) throw new LitmosError(404, "User not found.");
    const st = byCourse.get(courseId);
    if (!st) throw new LitmosError(404, "Course is not assigned to this user.");
    // Mirror the real API: a course delivered via a learning path can't be
    // unassigned directly (HTTP 406) — the LP assignment governs it.
    if (st.viaLearningPath) {
      throw new LitmosError(406, "This course was assigned via a learning path — remove the learning path instead.");
    }
    byCourse.delete(courseId);
  }

  async listUserLearningPaths(userId: string): Promise<LitmosUserLearningPath[]> {
    const byLp = this.s.userLps.get(userId);
    if (!byLp) throw new LitmosError(404, "User not found.");
    const out: LitmosUserLearningPath[] = [];
    for (const [lpId, st] of byLp) {
      const lp = this.s.learningPaths.get(lpId)!;
      const courseIds = this.s.lpCourses.get(lpId) ?? [];
      const states = courseIds.map((cid) => this.s.userCourses.get(userId)?.get(cid));
      const done = states.filter((x) => x?.completedAt != null).length;
      const pct = courseIds.length ? Math.round((done / courseIds.length) * 100) : 0;
      out.push({
        Id: lpId,
        Name: lp.Name,
        Active: lp.Active,
        Complete: pct === 100,
        PercentageComplete: pct,
        AssignedDate: iso(st.assignedAt),
        CompletedDate: null,
      });
    }
    return out;
  }

  async assignLearningPathsToUser(userId: string, lpIds: string[]): Promise<void> {
    const byLp = this.s.userLps.get(userId);
    if (!byLp) throw new LitmosError(404, "User not found.");
    const now = Date.now();
    for (const lpId of lpIds) {
      if (!this.s.learningPaths.has(lpId)) throw new LitmosError(404, "Learning path not found.");
      byLp.set(lpId, { assignedAt: now });
      for (const cid of this.s.lpCourses.get(lpId) ?? []) {
        if (!this.s.userCourses.get(userId)!.has(cid)) {
          this.s.userCourses.get(userId)!.set(cid, {
            assignedAt: now,
            startedAt: null,
            completedAt: null,
            pct: 0,
            score: null,
            compliantTill: null,
            updatedAt: now,
            viaLearningPath: lpId,
            viaTeam: null,
          });
        }
      }
    }
  }

  async unassignLearningPathFromUser(userId: string, lpId: string): Promise<void> {
    const byLp = this.s.userLps.get(userId);
    if (!byLp?.has(lpId)) throw new LitmosError(404, "Learning path is not assigned to this user.");
    byLp.delete(lpId);
    for (const [cid, st] of this.s.userCourses.get(userId) ?? []) {
      if (st.viaLearningPath === lpId && st.completedAt == null) this.s.userCourses.get(userId)!.delete(cid);
    }
  }

  async resetUserCourse(userId: string, courseId: string): Promise<void> {
    const st = this.s.userCourses.get(userId)?.get(courseId);
    if (!st) throw new LitmosError(404, "Course is not assigned to this user.");
    st.pct = 0;
    st.completedAt = null;
    st.startedAt = null;
    st.score = null;
    st.updatedAt = Date.now();
    // CompliantTill survives a reset — the learner stays compliant through the
    // retake window, exactly like Litmos's automatic-retake behavior.
  }

  // ── gamification ───────────────────────────────────────────────────────────

  async getUserGamificationSummary(userId: string): Promise<GamificationSummary> {
    if (!this.s.users.has(userId)) throw new LitmosError(404, "User not found.");
    const { points, badges } = this.pointsFor(userId);
    return { TotalBadgesEarned: badges, TotalPointsEarned: points };
  }

  async listUserBadges(userId: string): Promise<LitmosBadge[]> {
    return [...(this.s.badges.get(userId) ?? [])];
  }

  async getTeamGamificationDetails(teamId: string): Promise<TeamGamificationEntry[]> {
    const members = this.s.teamMembers.get(teamId);
    if (!members) throw new LitmosError(404, "Team not found.");
    return [...members].map((uid) => {
      const u = this.s.users.get(uid)!;
      const { points, badges } = this.pointsFor(uid);
      return { UserId: uid, FirstName: u.FirstName, LastName: u.LastName, Email: u.Email, TotalPointsEarned: points, TotalBadgesEarned: badges };
    });
  }

  async resetUserGamification(userId: string): Promise<void> {
    if (!this.s.users.has(userId)) throw new LitmosError(404, "User not found.");
    this.s.badges.set(userId, []);
    // Zero out completion-derived points too by applying a negative bonus.
    const completions = [...(this.s.userCourses.get(userId)?.values() ?? [])].filter((st) => st.completedAt != null).length;
    this.s.bonusPoints.set(userId, -completions * 100);
  }

  // ── reporting ──────────────────────────────────────────────────────────────

  async listResultsSince(sinceIso: string): Promise<LitmosResultRow[]> {
    const since = Date.parse(sinceIso);
    const out: LitmosResultRow[] = [];
    for (const [userId, byCourse] of this.s.userCourses) {
      const u = this.s.users.get(userId)!;
      for (const [courseId, st] of byCourse) {
        if (Number.isNaN(since) || st.updatedAt >= since) {
          const c = this.s.courses.get(courseId)!;
          const dueAt = courseDueAtMs(c, st.assignedAt);
          out.push({
            Id: userId,
            UserName: u.UserName,
            FirstName: u.FirstName,
            LastName: u.LastName,
            Email: u.Email,
            CourseId: courseId,
            CourseName: c.Name,
            Complete: st.completedAt != null,
            PercentageComplete: st.pct,
            CompletedDate: iso(st.completedAt) ?? null,
            UpdatedDate: iso(st.updatedAt),
            Overdue: st.completedAt == null && dueAt != null && dueAt < Date.now(),
            CompliantTillDate: iso(st.compliantTill) ?? null,
          });
        }
      }
    }
    return out;
  }

  async listAchievements(opts: { since?: string; userId?: string }): Promise<LitmosAchievement[]> {
    let rows = [...this.s.achievements];
    if (opts.userId) rows = rows.filter((a) => a.UserId === opts.userId);
    if (opts.since) {
      const since = Date.parse(opts.since);
      if (!Number.isNaN(since)) rows = rows.filter((a) => Date.parse(a.AchievementDate) >= since);
    }
    return rows;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private descendantTeamIds(teamId: string): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      for (const t of this.s.teams.values()) {
        if (t.ParentTeamId === id) {
          out.push(t.Id);
          walk(t.Id);
        }
      }
    };
    walk(teamId);
    return out;
  }

  // Demo-only helper: complete a course for a learner (drives the learner view's
  // "mark complete" affordance so the demo is fully interactive).
  async demoCompleteCourse(userId: string, courseId: string, score = 90): Promise<void> {
    const st = this.s.userCourses.get(userId)?.get(courseId);
    if (!st) throw new LitmosError(404, "Course is not assigned to this user.");
    const c = this.s.courses.get(courseId)!;
    const now = Date.now();
    st.pct = 100;
    st.completedAt = now;
    st.startedAt = st.startedAt ?? now;
    st.score = score;
    st.updatedAt = now;
    st.compliantTill = c.ComplianceDateSpan != null ? now + c.ComplianceDateSpan * DAY : null;
    this.s.achievements.push({
      UserId: userId,
      Title: c.Name,
      AchievementDate: new Date(now).toISOString(),
      CourseId: courseId,
      Type: "Course Completed",
      Score: score,
      CertificateId: c.Certificate ? `cert-${userId}-${courseId}` : undefined,
      FirstName: this.s.users.get(userId)!.FirstName,
      LastName: this.s.users.get(userId)!.LastName,
    });
  }

  // Demo-only helper: set a learner's progress (drives "start course").
  async demoStartCourse(userId: string, courseId: string): Promise<void> {
    const st = this.s.userCourses.get(userId)?.get(courseId);
    if (!st) throw new LitmosError(404, "Course is not assigned to this user.");
    if (st.completedAt == null) {
      st.startedAt = st.startedAt ?? Date.now();
      st.pct = Math.max(st.pct, 10);
      st.updatedAt = Date.now();
    }
  }
}

const globalForDemo = globalThis as unknown as { __jerichoLcDemo?: DemoLitmosSource };

export function getDemoSource(): DemoLitmosSource {
  return (globalForDemo.__jerichoLcDemo ??= new DemoLitmosSource(seed()));
}

// Test-only: fresh isolated instance.
export function createDemoSourceForTest(): DemoLitmosSource {
  return new DemoLitmosSource(seed());
}
