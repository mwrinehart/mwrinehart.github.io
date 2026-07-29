// LitmosSource — the single seam between the Learning Center and Litmos. Two
// implementations: LiveLitmosSource (client.ts, real v1 REST API) and
// DemoLitmosSource (demo.ts, seeded in-memory tenant). Everything above this
// interface (auth, scoping, rules, pages) is implementation-agnostic, which is
// what lets the whole dashboard run and be verified without a Litmos key.

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
import { isDemoMode, litmosCreds } from "./config";

export type ModuleAttachMode = "copy" | "link" | "mirror";

export interface LitmosSource {
  readonly mode: "live" | "demo";

  // users
  listUsers(opts?: { search?: string }): Promise<LitmosUser[]>;
  getUser(id: string): Promise<LitmosUserDetail | null>;
  findUserByEmail(email: string): Promise<LitmosUser | null>;
  createUser(input: CreateUserInput): Promise<LitmosUserDetail>;
  updateUser(id: string, patch: UpdateUserInput): Promise<void>;

  // teams & membership
  listTeams(): Promise<LitmosTeam[]>;
  getTeam(id: string): Promise<LitmosTeam | null>;
  createSubTeam(parentId: string, name: string, description?: string): Promise<LitmosTeam>;
  listTeamUsers(teamId: string): Promise<LitmosUser[]>;
  addUsersToTeam(teamId: string, userIds: string[], sendMessage: boolean): Promise<void>;
  removeUserFromTeam(teamId: string, userId: string): Promise<void>;
  listUserTeams(userId: string): Promise<LitmosTeam[]>;
  listTeamAdmins(teamId: string): Promise<LitmosUser[]>;
  listTeamLeaders(teamId: string): Promise<LitmosUser[]>;
  promoteTeamAdmin(teamId: string, userId: string): Promise<void>;
  demoteTeamAdmin(teamId: string, userId: string): Promise<void>;
  promoteTeamLeader(teamId: string, userId: string): Promise<void>;
  demoteTeamLeader(teamId: string, userId: string): Promise<void>;

  // courses, modules, library
  listCourses(): Promise<LitmosCourse[]>;
  getCourseDetails(id: string): Promise<LitmosCourseDetail | null>;
  listCourseModules(courseId: string): Promise<LitmosModule[]>;
  listCourseUsers(courseId: string): Promise<LitmosCourseUserStatus[]>;
  // POST /bulkimports/courses (create when CourseCode is new, update when it
  // matches). The only API-side way to create a course or edit its settings.
  upsertCourseShell(input: CourseShellInput): Promise<void>;
  findCourseByCode(code: string): Promise<LitmosCourse | null>;
  // POST /courses/{id}/modules/{copy|link|mirror} — module-level duplication.
  attachModules(courseId: string, moduleIds: string[], mode: ModuleAttachMode): Promise<void>;

  // team content
  listTeamCourses(teamId: string): Promise<LitmosCourse[]>;
  assignCoursesToTeam(teamId: string, courseIds: string[], opts: { library: boolean; includeSubteams: boolean }): Promise<void>;
  unassignCoursesFromTeam(teamId: string, courseIds: string[], library: boolean): Promise<void>;
  listTeamLearningPaths(teamId: string): Promise<LitmosLearningPath[]>;
  assignLearningPathsToTeam(teamId: string, lpIds: string[]): Promise<void>;
  unassignLearningPathsFromTeam(teamId: string, lpIds: string[]): Promise<void>;

  // learning paths
  listLearningPaths(): Promise<LitmosLearningPath[]>;
  listLearningPathCourses(lpId: string): Promise<LitmosCourse[]>;

  // per-user assignments & results
  listUserCourses(userId: string): Promise<LitmosUserCourse[]>;
  assignCoursesToUser(userId: string, courseIds: string[], sendMessage: boolean): Promise<void>;
  unassignCourseFromUser(userId: string, courseId: string): Promise<void>;
  listUserLearningPaths(userId: string): Promise<LitmosUserLearningPath[]>;
  assignLearningPathsToUser(userId: string, lpIds: string[]): Promise<void>;
  unassignLearningPathFromUser(userId: string, lpId: string): Promise<void>;
  // PUT /users/{id}/courses/{courseId}/reset — the recertification primitive.
  resetUserCourse(userId: string, courseId: string): Promise<void>;

  // gamification (read + reset only; Litmos exposes no write for points)
  getUserGamificationSummary(userId: string): Promise<GamificationSummary>;
  listUserBadges(userId: string): Promise<LitmosBadge[]>;
  getTeamGamificationDetails(teamId: string): Promise<TeamGamificationEntry[]>;
  resetUserGamification(userId: string): Promise<void>;

  // reporting
  listResultsSince(sinceIso: string): Promise<LitmosResultRow[]>;
  listAchievements(opts: { since?: string; userId?: string }): Promise<LitmosAchievement[]>;
}

// A learner may self-enroll in a course only when it sits in the optional
// library of a team they belong to. Enforced server-side (not just in the UI)
// so the self-enroll action can't be POSTed for an arbitrary course id.
export async function canSelfEnroll(source: LitmosSource, litmosUserId: string, courseId: string): Promise<boolean> {
  const teams = await source.listUserTeams(litmosUserId);
  for (const team of teams) {
    try {
      const teamCourses = await source.listTeamCourses(team.Id);
      if (teamCourses.some((c) => c.Id === courseId && c.CourseTeamLibrary && c.Active)) return true;
    } catch {
      // team unavailable — skip
    }
  }
  return false;
}

export async function getSource(): Promise<LitmosSource> {
  if (isDemoMode()) {
    const { getDemoSource } = await import("./demo");
    return getDemoSource();
  }
  const creds = litmosCreds();
  if (!creds) throw new Error("Litmos is not configured (set LITMOS_API_KEY or LEARNING_CENTER_DEMO=1).");
  const { LiveLitmosSource } = await import("./client");
  return new LiveLitmosSource(creds);
}
