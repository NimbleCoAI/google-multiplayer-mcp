import { describe, it, expect, vi } from "vitest";

// Mock googleapis: generateAuthUrl returns a Google consent URL, getToken
// returns a token set with a refresh token, userinfo returns an email.
vi.mock("googleapis", () => {
  const mockGenerateAuthUrl = vi.fn(
    () => "https://accounts.google.com/o/oauth2/auth?mock=1",
  );
  const mockGetToken = vi.fn((code: string) => {
    if (!code) throw new Error("invalid_grant");
    return {
      tokens: {
        access_token: "mock-access",
        refresh_token: "mock-refresh",
        scope: "https://www.googleapis.com/auth/calendar",
        token_type: "Bearer",
        expiry_date: 1_900_000_000_000,
      },
    };
  });
  const mockSetCredentials = vi.fn();
  const mockOAuth2 = vi.fn(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    setCredentials: mockSetCredentials,
    on: vi.fn(),
  }));
  return {
    google: {
      auth: { OAuth2: mockOAuth2 },
      oauth2: vi.fn(() => ({
        userinfo: {
          get: vi.fn(() => ({ data: { email: "paste@example.com" } })),
        },
      })),
    },
  };
});

// Mock fs so no real files are touched; tokens persist in an in-memory store.
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const tokenStore = new Map<string, string>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (typeof path === "string" && path.includes("config.json")) return true;
      if (typeof path === "string" && path.endsWith(".json")) {
        return tokenStore.has(path);
      }
      return false;
    }),
    readFileSync: vi.fn((path: string) => {
      if (typeof path === "string" && path.includes("config.json")) {
        return JSON.stringify({
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        });
      }
      if (tokenStore.has(path)) return tokenStore.get(path)!;
      return "";
    }),
    writeFileSync: vi.fn((path: string, data: string) => {
      tokenStore.set(path, data);
    }),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
});

const { generateConsentUrl, exchangeCode, loadTokens } = await import(
  "../src/auth.js"
);

describe("generateConsentUrl", () => {
  it("returns a Google consent URL without starting a callback server", () => {
    const url = generateConsentUrl("paste-identity");
    expect(url).toContain("https://accounts.google.com");
  });
});

describe("exchangeCode", () => {
  it("exchanges a pasted code, saves the token, and returns the email", async () => {
    const result = await exchangeCode("exchange-identity", "pasted-code-123");
    expect(result.email).toBe("paste@example.com");

    const saved = loadTokens("exchange-identity");
    expect(saved?.refresh_token).toBe("mock-refresh");
  });

  it("propagates an invalid_grant error when the code is empty", async () => {
    await expect(exchangeCode("bad-identity", "")).rejects.toThrow(
      "invalid_grant",
    );
  });
});
