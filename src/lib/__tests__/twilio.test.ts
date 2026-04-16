import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the twilio module before import
const mockCreate = vi.fn();
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: mockCreate } }),
}));

describe("sendTwilioSms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.TWILIO_FROM_NUMBER = "+447000000000";
  });

  it("should send SMS and return the SID", async () => {
    mockCreate.mockResolvedValue({ sid: "SM_test_sid_123" });

    const { sendTwilioSms } = await import("@/lib/twilio");
    const result = await sendTwilioSms({ to: "+447777777777", body: "Hello" });

    expect(mockCreate).toHaveBeenCalledWith({
      to: "+447777777777",
      from: "+447000000000",
      body: "Hello",
    });
    expect(result.sid).toBe("SM_test_sid_123");
  });

  it("should throw when credentials are missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;

    const { sendTwilioSms } = await import("@/lib/twilio");
    await expect(sendTwilioSms({ to: "+447777777777", body: "Hello" }))
      .rejects.toThrow("Twilio credentials not configured");
  });
});

describe("validateTwilioRequest", () => {
  it("should return false for missing signature", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.TWILIO_WEBHOOK_URL = "https://example.com/webhook";

    const { validateTwilioRequest } = await import("@/lib/twilio");
    const result = validateTwilioRequest(null, {});
    expect(result).toBe(false);
  });
});
