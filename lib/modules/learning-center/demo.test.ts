import { describe, expect, it } from "vitest";
import { createDemoSourceForTest } from "./demo";
import { canSelfEnroll } from "./source";
import { LitmosError } from "./types";

describe("DemoLitmosSource — Litmos behavior parity", () => {
  it("seeds a tenant with teams, sub-teams, users, and courses", async () => {
    const s = createDemoSourceForTest();
    const teams = await s.listTeams();
    expect(teams.length).toBeGreaterThanOrEqual(7);
    const nursing = teams.find((t) => t.Name === "Nursing");
    expect(nursing?.ParentTeamId).toBeTruthy();
    const users = await s.listUsers();
    expect(users.length).toBeGreaterThanOrEqual(18);
    const courses = await s.listCourses();
    expect(courses.some((c) => !c.Active)).toBe(true); // inactive course present
  });

  it("resolves team admins the way the live /teams/{id}/admins does", async () => {
    const s = createDemoSourceForTest();
    const admins = await s.listTeamAdmins("t-meridian");
    expect(admins.map((a) => a.Email)).toContain("admin@meridianhealth.com");
  });

  it("auto-assigns team courses to members who join later (core Litmos propagation)", async () => {
    const s = createDemoSourceForTest();
    const created = await s.createUser({ FirstName: "New", LastName: "Joiner", Email: "new.joiner@meridianhealth.com" });
    await s.addUsersToTeam("t-meridian", [created.Id], false);
    const courses = await s.listUserCourses(created.Id);
    // t-meridian has assigned (non-library) courses incl. c-phish
    expect(courses.some((c) => c.Id === "c-phish")).toBe(true);
    // library-only entries must NOT be auto-assigned
    expect(courses.some((c) => c.Id === "c-ai")).toBe(false);
  });

  it("cascades team assignment to sub-teams only when asked", async () => {
    const s = createDemoSourceForTest();
    await s.assignCoursesToTeam("t-meridian", ["c-incident"], { library: false, includeSubteams: true });
    const nursingCourses = await s.listTeamCourses("t-nursing");
    expect(nursingCourses.some((c) => c.Id === "c-incident" && !c.CourseTeamLibrary)).toBe(true);
    // members of the sub-team got it too
    const leo = await s.listUserCourses("u-leo");
    expect(leo.some((c) => c.Id === "c-incident")).toBe(true);
  });

  it("updateUser preserves fields it wasn't asked to change (no live-data wipe)", async () => {
    const s = createDemoSourceForTest();
    const before = await s.getUser("u-omar");
    expect(before?.JobTitle).toBeTruthy();
    await s.updateUser("u-omar", { Active: false });
    const after = await s.getUser("u-omar");
    expect(after?.Active).toBe(false);
    expect(after?.JobTitle).toBe(before?.JobTitle);
    expect(after?.CompanyName).toBe(before?.CompanyName);
    expect(after?.Email).toBe(before?.Email);
  });

  it("blocks direct unassign of LP-delivered courses with a 406, like the real API", async () => {
    const s = createDemoSourceForTest();
    // u-sasha has c-social via lp-core in the seed
    const err = await s.unassignCourseFromUser("u-sasha", "c-social").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LitmosError);
    expect((err as LitmosError).status).toBe(406);
  });

  it("reset puts a course back to 0% but keeps the compliance window (retake semantics)", async () => {
    const s = createDemoSourceForTest();
    const before = (await s.listUserCourses("u-priya")).find((c) => c.Id === "c-hipaa")!;
    expect(before.Complete).toBe(true);
    expect(before.ComplaintTill).toBeTruthy();
    await s.resetUserCourse("u-priya", "c-hipaa");
    const after = (await s.listUserCourses("u-priya")).find((c) => c.Id === "c-hipaa")!;
    expect(after.Complete).toBe(false);
    expect(after.PercentageComplete).toBe(0);
    expect(after.ComplaintTill).toBe(before.ComplaintTill);
  });

  it("supports the full duplication flow: shell upsert → resolve by code → attach modules → team library", async () => {
    const s = createDemoSourceForTest();
    await s.upsertCourseShell({ CourseTitle: "Phishing (Meridian)", CourseCode: "TL-TEST-1", Description: "copy", Active: true, ContentLibrary: false, DueDateSpan: 14 });
    const found = await s.findCourseByCode("tl-test-1");
    expect(found).toBeTruthy();
    const sourceModules = await s.listCourseModules("c-phish");
    await s.attachModules(found!.Id, sourceModules.map((m) => m.Id), "copy");
    const copied = await s.listCourseModules(found!.Id);
    expect(copied).toHaveLength(sourceModules.length);
    // copy mode duplicates with new ids
    expect(copied.every((m) => !sourceModules.some((src) => src.Id === m.Id))).toBe(true);
    await s.assignCoursesToTeam("t-meridian", [found!.Id], { library: true, includeSubteams: false });
    const lib = await s.listTeamCourses("t-meridian");
    expect(lib.some((c) => c.Id === found!.Id && c.CourseTeamLibrary)).toBe(true);
  });

  it("upsertCourseShell with an existing code updates settings in place", async () => {
    const s = createDemoSourceForTest();
    await s.upsertCourseShell({ CourseTitle: "Phishing Foundations", CourseCode: "JS-PHISH-101", Active: true, DueDateSpan: 30, ComplianceDateSpan: 60, ComplianceRetake: false });
    const details = await s.getCourseDetails("c-phish");
    expect(details?.DueDateSpan).toBe(30);
    expect(details?.ComplianceDateSpan).toBe(60);
  });

  it("computes overdue and compliance states relative to now", async () => {
    const s = createDemoSourceForTest();
    const omar = await s.listUserCourses("u-omar");
    const deepfake = omar.find((c) => c.Id === "c-deepfake")!;
    expect(deepfake.Overdue).toBe(true); // assigned 28d ago with a 21-day span
    const tomas = await s.listUserCourses("u-tomas");
    const phish = tomas.find((c) => c.Id === "c-phish")!;
    expect(phish.ComplaintTill && Date.parse(phish.ComplaintTill) < Date.now()).toBe(true); // lapsed
  });

  it("exposes gamification details per team and enforces membership on promotion", async () => {
    const s = createDemoSourceForTest();
    const details = await s.getTeamGamificationDetails("t-itsec");
    const bea = details.find((d) => d.Email === "bea.lindqvist@meridianhealth.com");
    expect(bea && bea.TotalPointsEarned > 0).toBe(true);
    const err = await s.promoteTeamAdmin("t-itsec", "u-hank").catch((e: unknown) => e); // hank is not a member
    expect((err as LitmosError).status).toBe(404);
  });

  it("canSelfEnroll gates on team-library membership (not just any course id)", async () => {
    const s = createDemoSourceForTest();
    // c-ai is in t-meridian's library; u-sasha is a Meridian member → eligible.
    expect(await canSelfEnroll(s, "u-sasha", "c-ai")).toBe(true);
    // c-phish is a required (non-library) team assignment, not self-enrollable.
    expect(await canSelfEnroll(s, "u-sasha", "c-phish")).toBe(false);
    // A Northwind member cannot self-enroll in Meridian's library course.
    expect(await canSelfEnroll(s, "u-kofi", "c-ai")).toBe(false);
  });

  it("filters results by since date", async () => {
    const s = createDemoSourceForTest();
    const all = await s.listResultsSince(new Date(0).toISOString());
    const recent = await s.listResultsSince(new Date(Date.now() - 15 * 86_400_000).toISOString());
    expect(all.length).toBeGreaterThan(recent.length);
  });
});
