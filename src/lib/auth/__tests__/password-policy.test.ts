import { vi, describe, it, expect, beforeEach } from "vitest";
import { validatePassword } from "../password-policy";

// "passwordlongerthan12chars" (25 chars) — meets all policy constraints (no composition rules).
// SHA-1 = computed for HIBP tests via the known hash below.
// Using a simple long-enough password with no special chars to confirm composition rules are NOT enforced.
const TEST_PASSWORD = "passwordlongerthan12chars";
// SHA-1("passwordlongerthan12chars") prefix/suffix for HIBP mock routing.
// We still mock HIBP using the old TEST_PASSWORD for HIBP-specific tests so those remain stable.
// For HIBP tests we keep the original well-known password with a known SHA-1:
// "Password1!ab" SHA-1 = EE903C4ED23E65ADF50DB545DB81E90C9C98E19C
const HIBP_TEST_PASSWORD = "Password1!ab";
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
      const result = await validatePassword("shortpass");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be at least 12 characters long.");
    });

    it("should reject an 11-character password", async () => {
      // 11 chars — fails length only; no composition rules apply
      const result = await validatePassword("onlyeleven1");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be at least 12 characters long.");
      // Must not produce any composition-rule errors
      expect(result.errors).not.toContain("Password must contain at least one uppercase letter.");
      expect(result.errors).not.toContain("Password must contain at least one lowercase letter.");
      expect(result.errors).not.toContain("Password must contain at least one number.");
      expect(result.errors).not.toContain("Password must contain at least one special character.");
    });
  });

  describe("maximum length constraint", () => {
    it("should reject a password longer than 72 characters", async () => {
      const longPassword = "a".repeat(73); // 73 characters — exceeds bcrypt byte limit
      const result = await validatePassword(longPassword);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be no longer than 72 characters.");
    });

    it("should accept a password of exactly 72 characters when all other constraints pass", async () => {
      mockFetchOk(buildSafeHibpBody());
      const exactPassword = "a".repeat(72); // 72 characters — at the limit
      const result = await validatePassword(exactPassword);
      expect(result.errors).not.toContain("Password must be no longer than 72 characters.");
    });
  });

  describe("no mandatory character composition rules (NIST SP 800-63B)", () => {
    it("should accept a password with no uppercase letters", async () => {
      mockFetchOk(buildSafeHibpBody());
      // 12+ chars, all lowercase, no uppercase, no digits, no specials
      const result = await validatePassword("alllowercasepassword");
      expect(result.valid).toBe(true);
      expect(result.errors).not.toContain("Password must contain at least one uppercase letter.");
    });

    it("should accept a password with no lowercase letters", async () => {
      mockFetchOk(buildSafeHibpBody());
      // 12+ chars, all uppercase
      const result = await validatePassword("ALLUPPERCASEPASSWORD");
      expect(result.valid).toBe(true);
      expect(result.errors).not.toContain("Password must contain at least one lowercase letter.");
    });

    it("should accept a password with no digits", async () => {
      mockFetchOk(buildSafeHibpBody());
      // 12+ chars, no digits
      const result = await validatePassword("nodigitsatallpassword");
      expect(result.valid).toBe(true);
      expect(result.errors).not.toContain("Password must contain at least one number.");
    });

    it("should accept a password with no special characters", async () => {
      mockFetchOk(buildSafeHibpBody());
      // 12+ chars, no special chars
      const result = await validatePassword("nospecialcharspassword");
      expect(result.valid).toBe(true);
      expect(result.errors).not.toContain("Password must contain at least one special character.");
    });
  });

  describe("current password reuse detection", () => {
    it("should reject when the new password matches the current password hash", async () => {
      // We need a real bcrypt hash; import bcryptjs to generate one for the test
      const bcrypt = await import("bcryptjs");
      const currentHash = await bcrypt.hash("mycurrentpassword!abc", 10);

      const result = await validatePassword("mycurrentpassword!abc", currentHash);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "New password must be different from your current password."
      );
    });

    it("should not reject when the new password differs from the current password hash", async () => {
      mockFetchOk(buildSafeHibpBody());
      const bcrypt = await import("bcryptjs");
      const currentHash = await bcrypt.hash("mycurrentpassword!abc", 10);

      const result = await validatePassword("adifferentlongpassword", currentHash);

      expect(result.errors).not.toContain(
        "New password must be different from your current password."
      );
    });

    it("should skip reuse check when no currentPasswordHash is provided", async () => {
      mockFetchOk(buildSafeHibpBody());
      // No second argument — reuse check must be skipped entirely
      const result = await validatePassword("alowercaselongpassword");
      expect(result.valid).toBe(true);
      expect(result.errors).not.toContain(
        "New password must be different from your current password."
      );
    });
  });

  describe("HIBP integration", () => {
    it("should return valid:true when password passes all constraints and is not in HIBP", async () => {
      mockFetchOk(buildSafeHibpBody());

      const result = await validatePassword(HIBP_TEST_PASSWORD);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid:false with a breach message when password appears in HIBP", async () => {
      mockFetchOk(buildBreachedHibpBody());

      const result = await validatePassword(HIBP_TEST_PASSWORD);

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

      const result = await validatePassword(HIBP_TEST_PASSWORD);

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

      const result = await validatePassword(HIBP_TEST_PASSWORD);

      // Fail-open: a bad status must not block a valid password
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should not call HIBP when basic constraints fail (avoids wasted API calls)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      // Password shorter than 12 chars — fails a basic constraint before HIBP check
      await validatePassword("short");

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("SHA-1 k-anonymity — correct algorithm and prefix format", () => {
    it("should send exactly 5 uppercase hex characters to the HIBP API (SHA-1, not SHA-256)", async () => {
      mockFetchOk(buildSafeHibpBody());

      await validatePassword(HIBP_TEST_PASSWORD);

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

      const result = await validatePassword(HIBP_TEST_PASSWORD);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "This password has appeared in a data breach. Please choose a different password."
      );
    });
  });

  describe("accumulation of multiple constraint errors", () => {
    it("should report only the length error for a short password (no composition errors)", async () => {
      // "short" — fails only minimum length; must NOT report composition-rule errors
      const result = await validatePassword("short");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be at least 12 characters long.");
      // Composition rules must not appear
      expect(result.errors).not.toContain("Password must contain at least one uppercase letter.");
      expect(result.errors).not.toContain("Password must contain at least one lowercase letter.");
      expect(result.errors).not.toContain("Password must contain at least one number.");
      expect(result.errors).not.toContain("Password must contain at least one special character.");
    });
  });
});
