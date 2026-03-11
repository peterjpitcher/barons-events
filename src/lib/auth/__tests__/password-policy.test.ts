import { vi, describe, it, expect, beforeEach } from "vitest";
import { validatePassword } from "../password-policy";

// "Password1!ab" (12 chars) — meets all policy constraints.
// SHA-1 = EE903C4ED23E65ADF50DB545DB81E90C9C98E19C
// prefix (first 5 chars) = EE903
// suffix (remaining 35 chars) = C4ED23E65ADF50DB545DB81E90C9C98E19C
const TEST_PASSWORD = "Password1!ab";
const TEST_SHA1_PREFIX = "EE903";
const TEST_SHA1_SUFFIX = "C4ED23E65ADF50DB545DB81E90C9C98E19C";

/**
 * Builds a minimal mock HIBP response body that does NOT include the target suffix.
 * Used to simulate a "safe" (not breached) response.
 */
function buildSafeHibpBody(): string {
  // Include some unrelated suffixes so the response is plausible but omits TEST_SHA1_SUFFIX
  return [
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0",
    "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:42",
    "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC:0",
  ].join("\n");
}

/**
 * Builds a mock HIBP response body that includes the target suffix with count > 0.
 * Used to simulate a "breached" response.
 */
function buildBreachedHibpBody(): string {
  return [
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0",
    `${TEST_SHA1_SUFFIX}:128`,
    "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC:0",
  ].join("\n");
}

function mockFetchOk(body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () => body,
    })
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("validatePassword", () => {
  describe("minimum length constraint", () => {
    it("should reject a password shorter than 12 characters", async () => {
      const result = await validatePassword("Sh0rt!");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be at least 12 characters long.");
    });

    it("should reject an 11-character password that otherwise meets all constraints", async () => {
      // "Password1!x" = 11 chars — has upper, lower, digit, special; only fails length
      const result = await validatePassword("Password1!x");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be at least 12 characters long.");
      // Must not complain about other constraints
      expect(result.errors).not.toContain("Password must contain at least one uppercase letter.");
      expect(result.errors).not.toContain("Password must contain at least one lowercase letter.");
      expect(result.errors).not.toContain("Password must contain at least one number.");
      expect(result.errors).not.toContain("Password must contain at least one special character.");
    });
  });

  describe("maximum length constraint", () => {
    it("should reject a password longer than 128 characters", async () => {
      const longPassword = "Aa1!" + "a".repeat(125); // 129 characters total
      const result = await validatePassword(longPassword);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be no longer than 128 characters.");
    });

    it("should accept a password of exactly 128 characters when all other constraints pass", async () => {
      mockFetchOk(buildSafeHibpBody());
      const exactPassword = "Aa1!" + "a".repeat(124); // 128 characters total
      const result = await validatePassword(exactPassword);
      expect(result.errors).not.toContain("Password must be no longer than 128 characters.");
    });
  });

  describe("uppercase letter constraint", () => {
    it("should reject a password with no uppercase letter", async () => {
      // 12 chars, has digit, special, lowercase — missing uppercase only
      const result = await validatePassword("password1!ab");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one uppercase letter.");
    });
  });

  describe("lowercase letter constraint", () => {
    it("should reject a password with no lowercase letter", async () => {
      // 12 chars, has digit, special, uppercase — missing lowercase only
      const result = await validatePassword("PASSWORD1!AB");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one lowercase letter.");
    });
  });

  describe("number constraint", () => {
    it("should reject a password with no number", async () => {
      // 13 chars, has upper, lower, special — missing digit only
      const result = await validatePassword("Password!abcd");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one number.");
    });
  });

  describe("special character constraint", () => {
    it("should reject a password with no special character", async () => {
      // 13 chars, has upper, lower, digit — missing special char only
      const result = await validatePassword("Password12345");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one special character.");
    });
  });

  describe("HIBP integration", () => {
    it("should return valid:true when password passes all constraints and is not in HIBP", async () => {
      mockFetchOk(buildSafeHibpBody());

      const result = await validatePassword(TEST_PASSWORD);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid:false with a breach message when password appears in HIBP", async () => {
      mockFetchOk(buildBreachedHibpBody());

      const result = await validatePassword(TEST_PASSWORD);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "This password has appeared in a data breach. Please choose a different password."
      );
    });

    it("should be fail-open when fetch throws (HIBP unavailable)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error"))
      );

      const result = await validatePassword(TEST_PASSWORD);

      // Fail-open: HIBP unavailability must not block a valid password
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should be fail-open when HIBP returns a non-OK HTTP status", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          text: async () => "",
        })
      );

      const result = await validatePassword(TEST_PASSWORD);

      // Fail-open: a bad status must not block a valid password
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should not call HIBP when basic constraints fail (avoids wasted API calls)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      // Password missing uppercase — fails a basic constraint before HIBP check
      await validatePassword("password1!abc");

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("SHA-1 k-anonymity — correct algorithm and prefix format", () => {
    it("should send exactly 5 uppercase hex characters to the HIBP API (SHA-1, not SHA-256)", async () => {
      mockFetchOk(buildSafeHibpBody());

      await validatePassword(TEST_PASSWORD);

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledOnce();

      const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;

      // Extract the prefix from the URL: https://api.pwnedpasswords.com/range/{prefix}
      const urlMatch = calledUrl.match(/\/range\/([0-9A-F]{5})$/i);
      expect(urlMatch).not.toBeNull();

      const sentPrefix = urlMatch![1].toUpperCase();

      // Must be exactly 5 characters — SHA-1 prefix (not SHA-256 which would also be 5 chars,
      // but the value must match the known SHA-1 hash of the test password, not SHA-256).
      expect(sentPrefix).toHaveLength(5);
      expect(sentPrefix).toMatch(/^[0-9A-F]{5}$/);

      // Must match the known SHA-1 prefix for "Password1!ab".
      // SHA-1("Password1!ab") = EE903C4ED23E65ADF50DB545DB81E90C9C98E19C → prefix = EE903.
      // SHA-256("Password1!ab") starts with a different 5-char sequence,
      // confirming SHA-1 is used as required by the HIBP API specification.
      expect(sentPrefix).toBe(TEST_SHA1_PREFIX);
    });

    it("should correctly match the breached password suffix in the HIBP response body", async () => {
      // The suffix is the SHA-1 hash minus the first 5 chars sent as the prefix.
      // This confirms the source splits the hash correctly for k-anonymity matching.
      mockFetchOk(buildBreachedHibpBody());

      const result = await validatePassword(TEST_PASSWORD);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "This password has appeared in a data breach. Please choose a different password."
      );
    });
  });

  describe("multiple simultaneous constraint errors", () => {
    it("should accumulate all failing constraint errors for a very weak password", async () => {
      // "short" — fails minimum length, uppercase, number, and special character
      const result = await validatePassword("short");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be at least 12 characters long.");
      expect(result.errors).toContain("Password must contain at least one uppercase letter.");
      expect(result.errors).toContain("Password must contain at least one number.");
      expect(result.errors).toContain("Password must contain at least one special character.");
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });
});
