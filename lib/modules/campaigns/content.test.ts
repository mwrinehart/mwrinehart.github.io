import { describe, expect, it } from "vitest";
import { evaluateGate } from "./content";
import type { CampaignRow } from "./schema";

// evaluateGate only reads status + autonomyMode; build a minimal stand-in.
const campaign = (status: string, autonomyMode: string): CampaignRow =>
  ({ status, autonomyMode }) as unknown as CampaignRow;

describe("evaluateGate", () => {
  it("blocks any job when the campaign is not active", () => {
    expect(evaluateGate(campaign("draft", "auto"), { riskScore: 0 }).status).toBe("blocked");
    expect(evaluateGate(campaign("paused", "auto"), { riskScore: 0 }).status).toBe("blocked");
    expect(evaluateGate(campaign("completed", "auto"), { riskScore: 0 }).status).toBe("blocked");
  });

  it("auto mode approves regardless of risk", () => {
    expect(evaluateGate(campaign("active", "auto"), { riskScore: 99 }).status).toBe("approved");
  });

  it("manual mode always requires review", () => {
    expect(evaluateGate(campaign("active", "manual"), { riskScore: 0 }).status).toBe("pending_review");
  });

  it("review mode approves low risk and holds high risk", () => {
    expect(evaluateGate(campaign("active", "review"), { riskScore: 10 }).status).toBe("approved");
    expect(evaluateGate(campaign("active", "review"), { riskScore: 40 }).status).toBe("pending_review");
    expect(evaluateGate(campaign("active", "review"), { riskScore: 80 }).status).toBe("pending_review");
  });
});
