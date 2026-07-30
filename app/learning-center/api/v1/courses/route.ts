import { authorizeRequest, jsonError } from "@/lib/modules/learning-center/api";

// GET /learning-center/api/v1/courses — the course catalog (account-wide in
// Litmos; a tenant sees the same catalog it can assign from).
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authorizeRequest(req, "read");
    const courses = (await ctx.source.listCourses()).map((c) => ({ id: c.Id, code: c.Code ?? null, name: c.Name, active: c.Active }));
    return Response.json({ courses }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
