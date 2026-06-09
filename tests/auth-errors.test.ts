import { describe, it, expect } from "vitest";
import { isAuthExpiredError, formatToolError } from "../src/auth-errors.js";

/**
 * These tests pin the contract for the structured auth-expired error that the
 * central tool dispatcher returns to the agent. Phase 2 groundwork: the agent
 * must be able to detect status === "auth_expired" and act on the actionable
 * instruction (call google_auth_url, DM the user the consent URL) instead of
 * parsing a raw googleapis stack trace.
 */

describe("isAuthExpiredError", () => {
  it("detects an invalid_grant message (refresh token revoked/expired)", () => {
    expect(isAuthExpiredError(new Error("invalid_grant"))).toBe(true);
  });

  it("detects invalid_grant embedded in a longer message", () => {
    expect(
      isAuthExpiredError(
        new Error("Error refreshing access token: invalid_grant (Token has been expired or revoked.)"),
      ),
    ).toBe(true);
  });

  it("detects a 401 via a GaxiosError-shaped response.status", () => {
    const err: any = new Error("Request failed with status code 401");
    err.response = { status: 401 };
    expect(isAuthExpiredError(err)).toBe(true);
  });

  it("detects a 401 via a numeric code field", () => {
    const err: any = new Error("Invalid Credentials");
    err.code = 401;
    expect(isAuthExpiredError(err)).toBe(true);
  });

  it("detects the googleapis 'Invalid Credentials' message", () => {
    expect(isAuthExpiredError(new Error("Invalid Credentials"))).toBe(true);
  });

  it("does NOT treat a 403/permission error as auth-expired", () => {
    const err: any = new Error("Item is outside allowed folders");
    err.code = 403;
    expect(isAuthExpiredError(err)).toBe(false);
  });

  it("does NOT treat a generic 404/500 error as auth-expired", () => {
    const err: any = new Error("File not found");
    err.response = { status: 404 };
    expect(isAuthExpiredError(err)).toBe(false);
  });

  it("does NOT treat a plain non-auth Error as auth-expired", () => {
    expect(isAuthExpiredError(new Error("boom"))).toBe(false);
  });

  it("handles non-Error throwables without crashing", () => {
    expect(isAuthExpiredError("invalid_grant")).toBe(true);
    expect(isAuthExpiredError(null)).toBe(false);
    expect(isAuthExpiredError(undefined)).toBe(false);
  });
});

describe("formatToolError", () => {
  it("returns a structured auth_expired payload for an invalid_grant error", () => {
    const payload = formatToolError(new Error("invalid_grant"));
    expect(payload.status).toBe("auth_expired");
    // Actionable: tells the agent exactly which tool to call.
    expect(payload.action).toContain("google_auth_url");
    // Instructs the agent to DM the user the consent URL.
    expect(payload.message.toLowerCase()).toContain("dm");
    expect(payload.message.toLowerCase()).toContain("consent");
    // Preserves the underlying detail for debugging.
    expect(payload.detail).toContain("invalid_grant");
  });

  it("returns a structured auth_expired payload for a 401", () => {
    const err: any = new Error("Invalid Credentials");
    err.response = { status: 401 };
    const payload = formatToolError(err);
    expect(payload.status).toBe("auth_expired");
    expect(payload.action).toContain("google_auth_url");
  });

  it("returns a generic error payload for a non-auth error", () => {
    const payload = formatToolError(new Error("Item is outside allowed folders"));
    expect(payload.status).toBe("error");
    expect(payload.message).toContain("Item is outside allowed folders");
    // No auth action for non-auth errors.
    expect(payload.action).toBeUndefined();
  });
});
