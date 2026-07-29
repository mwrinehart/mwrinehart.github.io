// Learner home — the Netflix-style Learning Center. Hero = the most urgent
// item (overdue → in progress → not started), then horizontally scrolling rows
// by state, the team's self-signup library, and a gamification strip. All data
// comes from the LitmosSource (live API or demo tenant).

import Link from "next/link";
import { requireLcSession } from "@/lib/modules/learning-center/auth";
import { getSource } from "@/lib/modules/learning-center/source";
import { buildLeaderboard } from "@/lib/modules/learning-center/leaderboard";
import type {
  GamificationSummary,
  LitmosBadge,
  LitmosCourse,
  LitmosTeam,
  LitmosUserCourse,
  LitmosUserLearningPath,
} from "@/lib/modules/learning-center/types";
import type { LeaderboardRow } from "@/lib/modules/learning-center/leaderboard";
import { CourseRow } from "@/components/learning-center/CourseRow";
import { CourseCard } from "@/components/learning-center/CourseCard";
import { Poster } from "@/components/learning-center/Poster";
import { LcProgress } from "@/components/learning-center/ui";

const DAY = 86_400_000;

function tagOf(c: { Code?: string }): string | undefined {
  // Course codes are structured JS-<AREA>-<level>; surface the area as the tag.
  const m = /^[A-Z]+-([A-Z]+)-/.exec(c.Code ?? "");
  const names: Record<string, string> = {
    PHISH: "Phishing",
    AI: "AI Threats",
    SE: "Social Engineering",
    ID: "Identity",
    IR: "Response",
    DATA: "Data",
    HC: "Healthcare",
    FIN: "Finance",
    OPS: "Operations",
    ONB: "Onboarding",
  };
  return m ? (names[m[1]] ?? m[1]) : undefined;
}

export default async function LearnerHome() {
  const session = await requireLcSession();
  const source = await getSource();

  let courses: LitmosUserCourse[] = [];
  let lps: LitmosUserLearningPath[] = [];
  let teams: LitmosTeam[] = [];
  let summary: GamificationSummary | null = null;
  let badges: LitmosBadge[] = [];
  let leaderboard: LeaderboardRow[] = [];
  let leaderboardTeam: LitmosTeam | null = null;
  const library: Array<{ course: LitmosCourse; teamName: string }> = [];

  if (session.litmosUserId) {
    const uid = session.litmosUserId;
    [courses, lps, teams] = await Promise.all([source.listUserCourses(uid), source.listUserLearningPaths(uid), source.listUserTeams(uid)]);

    const assignedIds = new Set(courses.map((c) => c.Id));
    for (const team of teams) {
      try {
        for (const c of await source.listTeamCourses(team.Id)) {
          if (c.CourseTeamLibrary && c.Active && !assignedIds.has(c.Id) && !library.some((l) => l.course.Id === c.Id)) {
            library.push({ course: c, teamName: team.Name });
          }
        }
      } catch {
        // team library unavailable — skip
      }
    }

    try {
      summary = await source.getUserGamificationSummary(uid);
      badges = await source.listUserBadges(uid);
      leaderboardTeam = teams[0] ?? null;
      if (leaderboardTeam) {
        leaderboard = buildLeaderboard(await source.getTeamGamificationDetails(leaderboardTeam.Id)).slice(0, 5);
      }
    } catch {
      summary = null; // gamification disabled for the tenant
    }
  }

  const now = Date.now();
  const active = courses.filter((c) => c.Active);
  const overdue = active.filter((c) => !c.Complete && c.Overdue);
  const expiring = active.filter((c) => {
    if (!c.ComplaintTill) return false;
    const till = Date.parse(c.ComplaintTill);
    return !Number.isNaN(till) && till - now < 30 * DAY;
  });
  const inProgress = active.filter((c) => !c.Complete && !c.Overdue && c.PercentageComplete > 0);
  const notStarted = active.filter((c) => !c.Complete && !c.Overdue && c.PercentageComplete === 0);
  const completed = active.filter((c) => c.Complete);

  const hero = overdue[0] ?? inProgress[0] ?? notStarted[0] ?? null;
  const heroDetails = hero ? await source.getCourseDetails(hero.Id) : null;
  const heroDone = completed.length;
  const heroTotal = active.length;

  const attention = [...overdue, ...expiring.filter((c) => !overdue.includes(c))];

  return (
    <main className="mx-auto max-w-6xl px-5 pb-16">
      {/* Hero — the one bold flat-purple moment. */}
      <section className="mt-6 mb-10 rounded-3xl bg-lc-purple text-white overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div className="flex-1 p-8 md:p-10 flex flex-col justify-center">
            {hero ? (
              <>
                <div className="text-xs font-bold uppercase tracking-widest text-white/70">
                  {hero.Overdue ? "Overdue — jump back in" : hero.PercentageComplete > 0 ? "Continue where you left off" : "Up next for you"}
                </div>
                <h1 className="mt-2 text-3xl md:text-4xl font-bold leading-tight">{hero.Name}</h1>
                {heroDetails?.Description && <p className="mt-3 text-sm text-white/85 max-w-xl leading-relaxed">{heroDetails.Description}</p>}
                <div className="mt-6 flex items-center gap-4">
                  <Link
                    href={`/learning-center/course/${encodeURIComponent(hero.Id)}`}
                    className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-lc-purple hover:opacity-90"
                  >
                    {hero.PercentageComplete > 0 ? "Continue course" : "Start course"}
                  </Link>
                  {hero.PercentageComplete > 0 && (
                    <span className="text-sm font-semibold text-white/80">{Math.round(hero.PercentageComplete)}% complete</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-bold uppercase tracking-widest text-white/70">All caught up</div>
                <h1 className="mt-2 text-3xl md:text-4xl font-bold leading-tight">
                  {session.litmosUserId ? "Nice work — nothing due right now." : `Welcome, ${session.displayName}.`}
                </h1>
                <p className="mt-3 text-sm text-white/85 max-w-xl">
                  {session.litmosUserId
                    ? "Browse your team's library below to keep your streak going."
                    : "Your account isn't linked to a learner profile — head to the Team Admin dashboard to manage your teams."}
                </p>
              </>
            )}
            {heroTotal > 0 && (
              <div className="mt-8 flex items-center gap-3 text-xs font-semibold text-white/80">
                <div className="h-1.5 w-44 rounded-full bg-white/20 overflow-hidden">
                  <div className="h-full rounded-full bg-white" style={{ width: `${heroTotal ? Math.round((heroDone / heroTotal) * 100) : 0}%` }} />
                </div>
                {heroDone} of {heroTotal} courses completed
              </div>
            )}
          </div>
          {hero && (
            <div className="md:w-80 lg:w-96 p-6 md:p-8 flex items-center">
              <div className="w-full">
                <Poster courseId={hero.Id} title={hero.Name} tag={tagOf(hero)} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Gamification strip */}
      {summary && (
        <section className="mb-10 rounded-2xl border border-lc-line p-5 flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-lc-muted">Your points</div>
            <div className="text-2xl font-bold text-lc-purple">{summary.TotalPointsEarned.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-lc-muted">Badges</div>
            <div className="flex gap-1.5 mt-1">
              {badges.length ? (
                badges.slice(0, 6).map((b) => (
                  <span key={b.Id + b.Title} title={`${b.Title} — ${b.Description ?? ""}`} className="rounded-full bg-lc-tint px-2.5 py-1 text-xs font-semibold text-lc-ink">
                    ★ {b.Title}
                  </span>
                ))
              ) : (
                <span className="text-sm text-lc-muted">None yet — complete courses to earn badges.</span>
              )}
            </div>
          </div>
          {leaderboard.length > 0 && leaderboardTeam && (
            <div className="ml-auto">
              <div className="text-xs font-semibold uppercase tracking-wide text-lc-muted mb-1">{leaderboardTeam.Name} leaders</div>
              <ol className="flex gap-4">
                {leaderboard.slice(0, 3).map((row) => (
                  <li key={row.userId} className="text-xs font-semibold text-lc-ink">
                    <span className="text-lc-purple font-bold">#{row.rank}</span> {row.name}
                    <span className="text-lc-muted font-medium"> · {row.points.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {attention.length > 0 && (
        <CourseRow title="Needs your attention" subtitle="Overdue training and certifications about to expire.">
          {attention.map((c) => {
            const till = c.ComplaintTill ? Date.parse(c.ComplaintTill) : NaN;
            const chip = c.Overdue && !c.Complete ? "Overdue" : till < now ? "Not compliant" : "Recertify soon";
            return <CourseCard key={c.Id} courseId={c.Id} title={c.Name} tag={tagOf(c)} pct={c.PercentageComplete} chip={chip} chipTone="amber" />;
          })}
        </CourseRow>
      )}

      {inProgress.length > 0 && (
        <CourseRow title="Continue learning">
          {inProgress.map((c) => (
            <CourseCard key={c.Id} courseId={c.Id} title={c.Name} tag={tagOf(c)} pct={c.PercentageComplete} />
          ))}
        </CourseRow>
      )}

      {notStarted.length > 0 && (
        <CourseRow title="Assigned to you" subtitle="Fresh assignments from your team.">
          {notStarted.map((c) => (
            <CourseCard key={c.Id} courseId={c.Id} title={c.Name} tag={tagOf(c)} chip="New" chipTone="purple" />
          ))}
        </CourseRow>
      )}

      {lps.length > 0 && (
        <section className="mb-9">
          <h2 className="text-lg font-bold text-lc-ink mb-3 px-1">Your learning paths</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {lps.map((lp) => (
              <div key={lp.Id} className="rounded-2xl border border-lc-line p-5">
                <div className="text-sm font-bold text-lc-ink">{lp.Name}</div>
                <div className="mt-3 flex items-center gap-2">
                  <LcProgress pct={lp.PercentageComplete} className="flex-1" />
                  <span className="text-xs font-semibold text-lc-muted">{Math.round(lp.PercentageComplete)}%</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {library.length > 0 && (
        <CourseRow title="From your team's library" subtitle="Optional courses you can take any time.">
          {library.map(({ course }) => (
            <CourseCard key={course.Id} courseId={course.Id} title={course.Name} tag={tagOf(course)} chip="Library" chipTone="ink" />
          ))}
        </CourseRow>
      )}

      {completed.length > 0 && (
        <CourseRow title="Completed" subtitle="Everything you've finished — nice work.">
          {completed.map((c) => (
            <CourseCard key={c.Id} courseId={c.Id} title={c.Name} tag={tagOf(c)} chip="✓ Done" chipTone="purple" />
          ))}
        </CourseRow>
      )}

      {courses.length === 0 && session.litmosUserId && (
        <div className="rounded-2xl bg-lc-tint p-10 text-center">
          <div className="font-bold text-lc-ink">No training assigned yet</div>
          <p className="text-sm text-lc-muted mt-1">When your team assigns you courses, they&apos;ll show up here.</p>
        </div>
      )}
    </main>
  );
}
