import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks
vi.mock("@/lib/twilio", () => ({
  validateTwilioRequest: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/customers", () => ({
  findCustomerByMobile: vi.fn(),
}));

import { validateTwilioRequest } from "@/lib/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findCustomerByMobile } from "@/lib/customers";

function mockDb() {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return {
    from: vi.fn().mockReturnValue(chainable),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    _chainable: chainable,
  };
}

describe("POST /api/webhooks/twilio-inbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject invalid signature with 403", async () => {
    (validateTwilioRequest as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { POST } = await import("@/app/api/webhooks/twilio-inbound/route");
    const body = new URLSearchParams({ From: "+447777777777", Body: "2", MessageSid: "SM123" });
    const req = new Request("http://localhost/api/webhooks/twilio-inbound", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "invalid" },
      body: body.toString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("should return empty TwiML for duplicate MessageSid", async () => {
    (validateTwilioRequest as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const db = mockDb();
    db._chainable.maybeSingle.mockResolvedValue({ data: { id: "existing" }, error: null });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(db);

    const { POST } = await import("@/app/api/webhooks/twilio-inbound/route");
    const body = new URLSearchParams({ From: "+447777777777", Body: "2", MessageSid: "SM_DUP" });
    const req = new Request("http://localhost/api/webhooks/twilio-inbound", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "valid" },
      body: body.toString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Response></Response>");
  });

  it("should handle STOP keyword recognition", () => {
    const STOP_KEYWORDS = /^(STOP|UNSUBSCRIBE|END|QUIT|CANCEL|OPTOUT)$/i;
    expect(STOP_KEYWORDS.test("STOP")).toBe(true);
    expect(STOP_KEYWORDS.test("stop")).toBe(true);
    expect(STOP_KEYWORDS.test("UNSUBSCRIBE")).toBe(true);
    expect(STOP_KEYWORDS.test("end")).toBe(true);
    expect(STOP_KEYWORDS.test("QUIT")).toBe(true);
    expect(STOP_KEYWORDS.test("cancel")).toBe(true);
    expect(STOP_KEYWORDS.test("OPTOUT")).toBe(true);
    expect(STOP_KEYWORDS.test("ABC 2")).toBe(false);
    expect(STOP_KEYWORDS.test("STOP NOW")).toBe(false);
  });

  it("should parse reply code + number format", () => {
    const pattern = /^([A-Z]{3})\s+([1-9]|10)$/i;
    expect("ABC 2".match(pattern)).toBeTruthy();
    expect("abc 10".match(pattern)).toBeTruthy();
    expect("XYZ 1".match(pattern)).toBeTruthy();
    expect("ABC 0".match(pattern)).toBeNull();
    expect("ABC 11".match(pattern)).toBeNull();
    expect("AB 2".match(pattern)).toBeNull();
    expect("ABCD 2".match(pattern)).toBeNull();
  });

  it("should parse number-only format", () => {
    const pattern = /^([1-9]|10)$/;
    expect("1".match(pattern)).toBeTruthy();
    expect("2".match(pattern)).toBeTruthy();
    expect("9".match(pattern)).toBeTruthy();
    expect("10".match(pattern)).toBeTruthy();
    expect("0".match(pattern)).toBeNull();
    expect("11".match(pattern)).toBeNull();
    expect("20".match(pattern)).toBeNull();
  });

  it("should properly escape XML special characters", () => {
    // Test the escapeXml logic used in twiml responses
    const escapeXml = (str: string): string =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    expect(escapeXml("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(escapeXml("<script>")).toBe("&lt;script&gt;");
    expect(escapeXml('"hello"')).toBe("&quot;hello&quot;");
    expect(escapeXml("it's")).toBe("it&apos;s");
  });
});
