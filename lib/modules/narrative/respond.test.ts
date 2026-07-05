import { describe, expect, it } from "vitest";
import { RESPONSE_POSTURES, clampRisk, evaluateResponseGate, parseResponseDraft } from "./respond";
import { parseAssessment } from "./analyze";
import type { NarrativeResponseRow, NarrativeRow } from "./schema";

// The gate only reads narrative.status/verdict and response.posture; build
// minimal row stand-ins like Campaigns' content.test.ts.
const narrative = (status: string, verdict: string): NarrativeRow => ({ status, verdict }) as unknown as NarrativeRow;
const response = (posture: string): NarrativeResponseRow => ({ posture }) as unknown as NarrativeResponseRow;

describe("evaluateResponseGate", () => {
  it("blocks any response to a dismissed narrative regardless of posture", () => {
    for (const posture of RESPONSE_POSTURES) {
      expect(evaluateResponseGate(narrative("dismissed", "false"), response(posture)).status).toBe("blocked");
    }
  });

  it("blocks counter-messaging without a false/misleading verdict, naming the verdict", () => {
    for (const verdict of ["unverified", "unsubstantiated", "true"]) {
      const gate = evaluateResponseGate(narrative("active", verdict), response("debunk"));
      expect(gate.status).toBe("blocked");
      expect(gate.reason).toContain(verdict);
    }
  });

  it("routes counter-messaging on false/misleading verdicts to human review", () => {
    for (const posture of ["debunk", "prebunk", "amplify_truth"]) {
      expect(evaluateResponseGate(narrative("active", "false"), response(posture)).status).toBe("pending_review");
      expect(evaluateResponseGate(narrative("active", "misleading"), response(posture)).status).toBe("pending_review");
    }
  });

  it("allows a monitor posture to reach review even on an unverified narrative", () => {
    expect(evaluateResponseGate(narrative("active", "unverified"), response("monitor")).status).toBe("pending_review");
  });

  it("never returns approved — every outward response requires a human decision", () => {
    for (const status of ["emerging", "active", "countered", "dismissed"]) {
      for (const verdict of ["unverified", "false", "misleading", "unsubstantiated", "true"]) {
        for (const posture of RESPONSE_POSTURES) {
          const gate = evaluateResponseGate(narrative(status, verdict), response(posture));
          expect(["pending_review", "blocked"]).toContain(gate.status);
        }
      }
    }
  });
});

describe("clampRisk", () => {
  it("clamps junk and out-of-range values into 0..100", () => {
    expect(clampRisk(Number.NaN)).toBe(0);
    expect(clampRisk(undefined)).toBe(0);
    expect(clampRisk(-5)).toBe(0);
    expect(clampRisk(150)).toBe(100);
    expect(clampRisk(42.4)).toBe(42);
  });
});

describe("parseResponseDraft", () => {
  const valid = {
    posture: "debunk",
    rationale: "The claim is contradicted by the fact library.",
    draftMessage: "Our records show no breach occurred.",
    audience: "customers",
    channels: ["company blog", "press statement"],
    risk: 30,
  };

  it("parses valid JSON wrapped in code fences", () => {
    const draft = parseResponseDraft("```json\n" + JSON.stringify(valid) + "\n```");
    expect(draft).not.toBeNull();
    expect(draft?.posture).toBe("debunk");
    expect(draft?.draftMessage).toBe(valid.draftMessage);
    expect(draft?.audience).toBe("customers");
    expect(draft?.channels).toEqual(["company blog", "press statement"]);
    expect(draft?.risk).toBe(30);
  });

  it("rejects an invalid posture", () => {
    expect(parseResponseDraft(JSON.stringify({ ...valid, posture: "astroturf" }))).toBeNull();
  });

  it("rejects a missing draftMessage", () => {
    const { draftMessage: _omit, ...rest } = valid;
    expect(parseResponseDraft(JSON.stringify(rest))).toBeNull();
  });

  it("filters channels to strings and caps them at 8", () => {
    const channels = ["a", "b", 1, "c", "d", null, "e", "f", "g", "h", "i", "j"];
    const draft = parseResponseDraft(JSON.stringify({ ...valid, channels }));
    expect(draft?.channels).toHaveLength(8);
    expect(draft?.channels.every((c) => typeof c === "string")).toBe(true);
  });
});

describe("parseAssessment", () => {
  const valid = {
    title: "Alleged breach cover-up",
    claim: "Meridian Health is hiding a breach.",
    summary: "A cover-up claim is spreading across social platforms.",
    verdict: "false",
    confidence: 250,
    rationale: "Directly contradicted by the audited fact library.",
  };

  it("parses fenced JSON and clamps confidence into 0..100", () => {
    const a = parseAssessment("```json\n" + JSON.stringify(valid) + "\n```");
    expect(a).not.toBeNull();
    expect(a?.verdict).toBe("false");
    expect(a?.confidence).toBe(100);
    expect(a?.title).toBe(valid.title);
  });

  it("rejects a verdict outside the whitelist", () => {
    expect(parseAssessment(JSON.stringify({ ...valid, verdict: "bogus" }))).toBeNull();
  });
});
