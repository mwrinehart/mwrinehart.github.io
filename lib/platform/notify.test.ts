import { describe, expect, it } from "vitest";
import { buildGoogleChatPayload } from "./notify";

describe("buildGoogleChatPayload", () => {
  it("bolds the subject on its own line when present", () => {
    expect(buildGoogleChatPayload("Training overdue", "Complete it today.")).toEqual({ text: "*Training overdue*\nComplete it today." });
  });

  it("sends the bare body when there is no subject", () => {
    expect(buildGoogleChatPayload(undefined, "Complete it today.")).toEqual({ text: "Complete it today." });
    expect(buildGoogleChatPayload("", "Complete it today.")).toEqual({ text: "Complete it today." });
  });

  it("escapes Google Chat control characters so a hostile course/learner name can't inject a link", () => {
    expect(buildGoogleChatPayload("A & B", "<https://evil.example|Click here> completed")).toEqual({
      text: "*A &amp; B*\n&lt;https://evil.example|Click here&gt; completed",
    });
  });
});
