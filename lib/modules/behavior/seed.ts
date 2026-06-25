// Demo data for the Behavior module so the anchor module is visibly functional
// without a real data-source sync. Invoked by the "Load sample data" action on
// the Behavior overview. Idempotent-ish: it no-ops if the org already has people.

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { behaviorPeople, behaviors, pulseFindings } from "./schema";

const SAMPLE_PEOPLE = [
  { name: "Dana Holt", dept: "Finance", risk: 82 },
  { name: "Marcus Lee", dept: "Engineering", risk: 64 },
  { name: "Priya Nair", dept: "Sales", risk: 41 },
  { name: "Tom Becker", dept: "Operations", risk: 28 },
  { name: "Sofia Ramos", dept: "HR", risk: 12 },
  { name: "Wei Zhang", dept: "Engineering", risk: 55 },
];

const SAMPLE_BEHAVIORS = [
  { type: "phish_click", desc: "Clicked a simulated phishing link", severity: "high" },
  { type: "password_reuse", desc: "Reused a password flagged in a breach corpus", severity: "critical" },
  { type: "risky_download", desc: "Downloaded an executable from an unknown sender", severity: "medium" },
];

const SAMPLE_FINDINGS = [
  { title: "CISA adds new actively-exploited CVE to KEV catalog", severity: "critical", category: "Vulnerabilities" },
  { title: "HHS issues updated HIPAA security guidance", severity: "medium", category: "Regulatory" },
  { title: "Phishing campaign impersonates payroll provider", severity: "high", category: "Threat Intel" },
];

export async function seedBehaviorDemo(orgId: string): Promise<void> {
  const existing = await db.select({ id: behaviorPeople.id }).from(behaviorPeople).where(eq(behaviorPeople.orgId, orgId));
  if (existing.length > 0) return;

  const now = Date.now();
  const day = 86_400_000;

  const peopleIds: string[] = [];
  for (const p of SAMPLE_PEOPLE) {
    const id = randomUUID();
    peopleIds.push(id);
    await db.insert(behaviorPeople).values({
      id,
      orgId,
      email: `${p.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      name: p.name,
      department: p.dept,
      riskScore: p.risk,
      lastActiveAt: now - Math.floor(Math.random() * 5) * day,
      createdAt: now,
    });
  }

  for (let i = 0; i < SAMPLE_BEHAVIORS.length; i++) {
    const b = SAMPLE_BEHAVIORS[i];
    await db.insert(behaviors).values({
      id: randomUUID(),
      orgId,
      personId: peopleIds[i % peopleIds.length],
      behaviorType: b.type,
      description: b.desc,
      severity: b.severity,
      detectedAt: now - i * day,
      resolved: false,
    });
  }

  for (let i = 0; i < SAMPLE_FINDINGS.length; i++) {
    const f = SAMPLE_FINDINGS[i];
    await db.insert(pulseFindings).values({
      id: randomUUID(),
      orgId,
      feedId: null,
      feedName: "Sample Feed",
      title: f.title,
      summary: "Seeded sample finding for demonstration of the shared feed engine.",
      link: `https://example.com/finding/${i}`,
      severity: f.severity,
      category: f.category,
      keywords: null,
      publishedAt: now - i * day,
      scannedAt: now,
    });
  }
}
