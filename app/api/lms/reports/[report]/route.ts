// CSV export for LMS reports. Authenticated (org-scoped via requireTenant);
// returns the named report as a download. risk-training crosses modules, which
// routes are allowed to do (dashboard precedent).

import { requireTenant } from "@/lib/platform/org";
import { toCsv } from "@/lib/modules/lms/types";
import { completionByCourse, completionByTeam, correlateTrainingRisk, trainingStatsByEmail } from "@/lib/modules/lms/reports";
import { listLmsAssignments } from "@/lib/modules/lms/assignments";
import { listComplianceProfiles, listComplianceRecords } from "@/lib/modules/lms/compliance";
import { riskByEmail } from "@/lib/modules/behavior/reports";

const REPORTS = ["courses", "teams", "assignments", "compliance", "risk-training"] as const;

function iso(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString() : "";
}

async function buildReport(orgId: string, report: string): Promise<{ headers: string[]; rows: Array<Array<string | number | null | undefined>> } | null> {
  switch (report) {
    case "courses": {
      const rows = await completionByCourse(orgId);
      return {
        headers: ["Course ID", "Course", "Assigned", "Completed", "Overdue", "Completion %"],
        rows: rows.map((r) => [r.courseId, r.courseName, r.assigned, r.completed, r.overdue, r.completionRate]),
      };
    }
    case "teams": {
      const rows = await completionByTeam(orgId);
      return {
        headers: ["Team ID", "Team", "Learners", "Assigned", "Completed", "Overdue", "Completion %"],
        rows: rows.map((r) => [r.teamId, r.teamName, r.learners, r.assigned, r.completed, r.overdue, r.completionRate]),
      };
    }
    case "assignments": {
      const rows = await listLmsAssignments(orgId, { limit: 5000 });
      return {
        headers: ["Learner email", "Learner name", "Course", "Status", "Assigned at", "Due date", "Completed at", "Score", "Assigned by"],
        rows: rows.map((a) => [
          a.learnerEmail,
          a.learnerName,
          a.courseName || a.courseLitmosId,
          a.status,
          iso(a.assignedAt),
          iso(a.dueDate),
          iso(a.completedAt),
          a.score,
          a.assignedBy,
        ]),
      };
    }
    case "compliance": {
      const [records, profiles] = await Promise.all([listComplianceRecords(orgId, { limit: 5000 }), listComplianceProfiles(orgId)]);
      const profileName = new Map(profiles.map((p) => [p.id, p.name]));
      return {
        headers: ["Profile", "Learner email", "Learner name", "Course ID", "Status", "Last completed", "Expires"],
        rows: records.map((r) => [
          profileName.get(r.profileId) ?? r.profileId,
          r.learnerEmail,
          r.learnerName,
          r.courseLitmosId,
          r.status,
          iso(r.lastCompletedAt),
          iso(r.expiresAt),
        ]),
      };
    }
    case "risk-training": {
      const [risk, training] = await Promise.all([riskByEmail(orgId), trainingStatsByEmail(orgId)]);
      const { rows } = correlateTrainingRisk(risk, training);
      return {
        headers: ["Email", "Name", "Risk score", "Completed", "Open", "Overdue"],
        rows: rows.map((r) => [r.email, r.name, r.riskScore, r.completed, r.open, r.overdue]),
      };
    }
    default:
      return null;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ report: string }> }) {
  const { report } = await ctx.params;
  let orgId: string;
  try {
    ({ orgId } = await requireTenant());
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const built = await buildReport(orgId, report);
  if (!built) {
    return Response.json({ error: `unknown report "${report}"`, valid: [...REPORTS] }, { status: 404 });
  }

  return new Response(toCsv(built.headers, built.rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lms-${report}.csv"`,
    },
  });
}
