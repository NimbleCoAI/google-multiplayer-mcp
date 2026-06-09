import { describe, it, expect, vi } from "vitest";

// Reproduces the live E2E bug: the granted scopes (drive/calendar/gmail/docs/
// sheets) don't include openid/email, so oauth2.userinfo.get() throws AFTER the
// token has been saved. exchangeCode must still succeed — the auth worked.
vi.mock("googleapis", () => {
  const mockGetToken = vi.fn(() => ({
    tokens: { access_token: "a", refresh_token: "mock-refresh", scope: "s" },
  }));
  const mockOAuth2 = vi.fn(() => ({
    generateAuthUrl: vi.fn(() => "https://accounts.google.com/x"),
    getToken: mockGetToken,
    setCredentials: vi.fn(),
    on: vi.fn(),
  }));
  return {
    google: {
      auth: { OAuth2: mockOAuth2 },
      oauth2: vi.fn(() => ({
        userinfo: {
          get: vi.fn(() => {
            throw new Error("missing required authentication credential");
          }),
        },
      })),
    },
  };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const tokenStore = new Map<string, string>();
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (typeof p === "string" && p.includes("config.json")) return true;
      if (typeof p === "string" && p.endsWith(".json")) return tokenStore.has(p);
      return false;
    }),
    readFileSync: vi.fn((p: string) => {
      if (typeof p === "string" && p.includes("config.json")) {
        return JSON.stringify({ clientId: "id", clientSecret: "secret" });
      }
      return tokenStore.get(p) ?? "";
    }),
    writeFileSync: vi.fn((p: string, data: string) => tokenStore.set(p, data)),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
});

const { exchangeCode, loadTokens } = await import("../src/auth.js");

describe("exchangeCode with unauthorized userinfo", () => {
  it("still succeeds and saves the token when the email lookup fails", async () => {
    const result = await exchangeCode("scope-limited", "good-code");
    // Auth succeeded — token saved, even though the email could not be read.
    expect(loadTokens("scope-limited")?.refresh_token).toBe("mock-refresh");
    expect(result.email).toBe("unknown");
  });
});
