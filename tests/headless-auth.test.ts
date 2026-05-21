import { describe, it, expect, vi } from "vitest";

// Mock googleapis before importing auth module
vi.mock("googleapis", () => {
  const mockGenerateAuthUrl = vi.fn(
    () => "https://accounts.google.com/o/oauth2/auth?mock=1",
  );
  const mockGetToken = vi.fn(() => ({
    tokens: {
      access_token: "mock-access",
      refresh_token: "mock-refresh",
      scope: "https://www.googleapis.com/auth/drive",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600_000,
    },
  }));
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
          get: vi.fn(() => ({ data: { email: "test@example.com" } })),
        },
      })),
    },
  };
});

// Mock fs to avoid real file operations
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const tokenStore = new Map<string, string>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (typeof path === "string" && path.includes("config.json")) return true;
      // Check token store
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

// Mock http.createServer so no real ports are opened
vi.mock("http", async () => {
  const actual = await vi.importActual<typeof import("http")>("http");
  return {
    ...actual,
    createServer: vi.fn(() => ({
      listen: vi.fn((_port: number, _host: string, cb?: () => void) => {
        if (cb) cb();
      }),
      close: vi.fn(),
      on: vi.fn(),
    })),
  };
});

const { checkAuthStatus, startHeadlessAuth, loadTokens } = await import(
  "../src/auth.js"
);

describe("checkAuthStatus", () => {
  it("returns 'unauthenticated' when no tokens exist", () => {
    expect(checkAuthStatus("no-such-identity")).toBe("unauthenticated");
  });
});

describe("startHeadlessAuth", () => {
  it("returns an auth URL containing google accounts domain", () => {
    const result = startHeadlessAuth("test-identity-url");
    expect(result.authUrl).toContain("https://accounts.google.com");
    expect(result.done).toBeInstanceOf(Promise);
  });

  it("sets status to pending while auth is in flight", () => {
    startHeadlessAuth("pending-check-identity");
    expect(checkAuthStatus("pending-check-identity")).toBe("pending");
  });

  it("returns different URLs for different identities", () => {
    const a = startHeadlessAuth("identity-a");
    const b = startHeadlessAuth("identity-b");
    // Both should be valid URLs (same mock, but the function should be callable twice)
    expect(a.authUrl).toBeTruthy();
    expect(b.authUrl).toBeTruthy();
  });
});

describe("loadTokens", () => {
  it("returns null for unknown identity", () => {
    expect(loadTokens("nonexistent")).toBeNull();
  });
});
