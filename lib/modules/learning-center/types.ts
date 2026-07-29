// Litmos domain types for the Jericho Security Learning Center. Field names
// mirror the Litmos v1 API's PascalCase records (SAP SuccessFactors Litmos API
// v1.0 OpenAPI spec + support.litmos.com developer articles) so live responses
// map 1:1; the demo source produces the same shapes.

export type LitmosAccessLevel = "Learner" | "Team_Leader" | "Administrator" | "Account_Owner";

export interface LitmosUser {
  Id: string;
  UserName: string;
  FirstName: string;
  LastName: string;
  Email: string;
  Active: boolean;
  AccessLevel: LitmosAccessLevel | string;
  Brand?: string;
}

// Full record from GET /users/{id}. Litmos's PUT /users/{id} replaces the whole
// record, so updates must read this, patch only the changed fields, and write
// every other field back verbatim — otherwise unlisted fields are wiped. The
// full field set (spec order) is carried so nothing is dropped on round-trip.
export interface LitmosUserDetail extends LitmosUser {
  FullName?: string;
  DisableMessages?: boolean;
  Skype?: string;
  PhoneWork?: string;
  PhoneMobile?: string;
  LastLogin?: string;
  // One-time login URL — the only API-side way to (re)send a login link is to
  // read this and email it ourselves (Litmos has no resend endpoint).
  LoginKey?: string;
  IsCustomUsername?: boolean;
  SkipFirstLogin?: boolean;
  TimeZone?: string;
  SalesforceId?: string;
  OriginalId?: number;
  Street1?: string;
  Street2?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Country?: string;
  SalesforceContactId?: string;
  SalesforceAccountId?: string;
  CreatedDate?: string;
  Points?: number;
  CompanyName?: string;
  JobTitle?: string;
  CustomField1?: string;
  CustomField2?: string;
  CustomField3?: string;
  CustomField4?: string;
  CustomField5?: string;
  CustomField6?: string;
  CustomField7?: string;
  CustomField8?: string;
  CustomField9?: string;
  CustomField10?: string;
  Culture?: string;
  ManagerId?: string;
  ManagerName?: string;
  EnableTextNotification?: boolean;
  Website?: string;
  Twitter?: string;
  ExpirationDate?: string;
  JobRole?: string;
  ExternalEmployeeId?: string;
  ProfileType?: string;
}

export interface LitmosTeam {
  Id: string;
  Name: string;
  Description?: string;
  ParentTeamId?: string | null;
}

export interface LitmosCourse {
  Id: string;
  Code?: string;
  Name: string;
  Active: boolean;
  Description?: string;
  OriginalId?: number;
  // True when the course sits in a team's optional library (self sign-up)
  // rather than being force-assigned. Only meaningful on team-course rows.
  CourseTeamLibrary?: boolean;
  CreatedBy?: string;
  Tags?: string[];
}

// GET /courses/{id}/details — carries the due-date/compliance configuration.
export interface LitmosCourseDetail extends LitmosCourse {
  IncludeInLibrary?: boolean;
  CompleteInOrder?: boolean;
  CourseImageURL?: string;
  CreatedDate?: string;
  UpdatedDate?: string;
  // Fixed calendar due date (same for everyone), ISO yyyy-mm-dd, or null.
  DueDate?: string | null;
  // Floating due date: days after the learner was assigned.
  DueDateSpan?: number | null;
  ComplianceDate?: string | null;
  // Days a learner stays compliant after completing; presence marks the course
  // as a compliance/recertification course.
  ComplianceDateSpan?: number | null;
  ComplianceRetake?: boolean;
  Topics?: string[];
  Certificate?: boolean;
}

export interface LitmosModule {
  Id: string;
  Code?: string;
  Name: string;
  Description?: string;
}

export interface LitmosLearningPath {
  Id: string;
  Name: string;
  Description?: string;
  Active: boolean;
  OriginalId?: number;
  LearningPathTeamLibrary?: boolean;
}

// GET /users/{id}/courses — a learner's assignment + progress row. Litmos spells
// the compliance field "ComplaintTill" on this endpoint (verbatim API typo).
export interface LitmosUserCourse {
  Id: string;
  Code?: string;
  Name: string;
  Active: boolean;
  Complete: boolean;
  PercentageComplete: number;
  AssignedDate?: string;
  StartDate?: string;
  CompletedDate?: string | null;
  UpToDate?: boolean;
  Overdue?: boolean;
  ComplaintTill?: string | null;
  IsLearningPath?: boolean;
}

export interface LitmosUserLearningPath {
  Id: string;
  Name: string;
  Active: boolean;
  Complete: boolean;
  PercentageComplete: number;
  AssignedDate?: string;
  CompletedDate?: string | null;
}

// GET /courses/{id}/users — per-user due date & compliance status for a course.
export interface LitmosCourseUserStatus {
  Id: string;
  UserName: string;
  FirstName: string;
  LastName: string;
  Completed: boolean;
  PercentageComplete: number;
  CompliantTill?: string | null;
  DueDate?: string | null;
}

// GET /results/details — org-wide delta feed of course results.
export interface LitmosResultRow {
  Id: string; // user id
  UserName: string;
  FirstName: string;
  LastName: string;
  Email: string;
  CourseId: string;
  CourseName: string;
  Complete: boolean;
  PercentageComplete: number;
  CompletedDate?: string | null;
  UpdatedDate?: string;
  Overdue?: boolean;
  CompliantTillDate?: string | null;
}

export interface LitmosAchievement {
  UserId: string;
  Title: string;
  AchievementDate: string;
  CourseId?: string;
  Type?: string;
  Score?: number;
  CertificateId?: string;
  FirstName?: string;
  LastName?: string;
}

export interface GamificationSummary {
  TotalBadgesEarned: number;
  TotalPointsEarned: number;
}

export interface LitmosBadge {
  Id: string;
  Title: string;
  Description?: string;
  Icon?: string;
  IconBadgeColor?: string;
}

// /teams/{id}/gamificationdetails — raw per-member points/badges, the input for
// our computed leaderboards (Litmos has no leaderboard endpoint).
export interface TeamGamificationEntry {
  UserId: string;
  FirstName: string;
  LastName: string;
  Email?: string;
  TotalPointsEarned: number;
  TotalBadgesEarned: number;
}

// ─── write inputs ─────────────────────────────────────────────────────────────

export interface CreateUserInput {
  FirstName: string;
  LastName: string;
  Email: string;
  AccessLevel?: string;
  CompanyName?: string;
  JobTitle?: string;
  Brand?: string;
  // Send the Litmos login/welcome email at creation (?sendmessage=true).
  sendWelcomeEmail?: boolean;
}

export interface UpdateUserInput {
  FirstName?: string;
  LastName?: string;
  Email?: string;
  Active?: boolean;
  AccessLevel?: string;
  CompanyName?: string;
  JobTitle?: string;
  Brand?: string;
  DisableMessages?: boolean;
}

// POST /bulkimports/courses — the ONLY course create/update API. Matching an
// existing course's CourseCode makes it an update; a new code creates a
// metadata-only shell (content/modules cannot be created this way).
export interface CourseShellInput {
  CourseTitle: string;
  CourseCode: string;
  Description?: string;
  Active: boolean;
  ContentLibrary?: boolean;
  DueDate?: string | null; // yyyy-mm-dd fixed date
  DueDateSpan?: number | null; // days after assignment (max 100)
  ComplianceDateSpan?: number | null; // days compliant after completion (max 100)
  ComplianceRetake?: boolean;
}

export class LitmosError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LitmosError";
    this.status = status;
  }
}

export function isGamificationDisabled(e: unknown): boolean {
  return e instanceof LitmosError && e.status === 403;
}
