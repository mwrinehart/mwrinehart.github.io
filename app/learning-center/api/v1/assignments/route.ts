import { ApiError, authorizeRequest, jsonError } from "@/lib/modules/learning-center/api";

// POST /learning-center/api/v1/assignments — assign a course to a user, scoped
// to the key's tenant. Requires the "assign" scope.
// Body: { email: string, courseId: string, sendEmail?: boolean }
export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await authorizeRequest(req, "assign");
    let body: { email?: unknown; courseId?: unknown; sendEmail?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      throw new ApiError(400, "Body must be JSON.");
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const courseId = typeof body.courseId === "string" ? body.courseId : "";
    if (!email || !courseId) throw new ApiError(400, "email and courseId are required.");

    const user = await ctx.source.findUserByEmail(email);
    if (!user) throw new ApiError(404, "No user with that email.");
    // Tenancy: the target must belong to this key's tenant subtree.
    if (!ctx.memberIds.has(user.Id)) throw new ApiError(403, "That user is not in this tenant.");

    const courses = await ctx.source.listCourses();
    if (!courses.some((c) => c.Id === courseId)) throw new ApiError(404, "Unknown courseId.");

    await ctx.source.assignCoursesToUser(user.Id, [courseId], body.sendEmail === true);
    return Response.json({ ok: true, assigned: { email, courseId } }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
