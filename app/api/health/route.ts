// Liveness probe (parity with CBM's /api/health and Horizon's /api/scan/status).
export async function GET() {
  return Response.json({ ok: true, service: "jericho-platform", uptime: process.uptime(), ts: Date.now() });
}
