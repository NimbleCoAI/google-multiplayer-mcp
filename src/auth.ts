/** OAuth token management and browser-based auth flow. */

import { createServer } from "http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { google } from "googleapis";
import type { GlobalConfig, TokenSet } from "./types.js";

const CONFIG_DIR = join(homedir(), ".nimbleco-google");
const TOKEN_DIR = join(CONFIG_DIR, "tokens");
const GLOBAL_CONFIG_PATH = join(CONFIG_DIR, "config.json");

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
];

const REDIRECT_PORT = 8095;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

/** Load global config (client ID/secret). */
function loadGlobalConfig(): GlobalConfig {
  // Env vars override file config
  const envId = process.env.GOOGLE_CLIENT_ID ?? "";
  const envSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }

  if (!existsSync(GLOBAL_CONFIG_PATH)) {
    throw new Error(
      `Google MCP not configured. Create ${GLOBAL_CONFIG_PATH} with clientId and clientSecret, ` +
        `or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.`,
    );
  }

  return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, "utf-8"));
}

/** Get the token file path for an identity. */
function tokenPath(identity: string): string {
  return join(
    process.env.GOOGLE_TOKEN_DIR ?? TOKEN_DIR,
    `${identity}.json`,
  );
}

/** Load saved tokens for an identity. Returns null if not found. */
export function loadTokens(identity: string): TokenSet | null {
  const path = tokenPath(identity);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Save tokens for an identity. */
function saveTokens(identity: string, tokens: TokenSet): void {
  const dir = process.env.GOOGLE_TOKEN_DIR ?? TOKEN_DIR;
  mkdirSync(dir, { recursive: true });
  writeFileSync(tokenPath(identity), JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}

/** Create an OAuth2 client for the given identity, loaded with saved tokens. */
export function createAuthClient(
  identity: string,
): InstanceType<typeof google.auth.OAuth2> {
  const config = loadGlobalConfig();
  const client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    REDIRECT_URI,
  );

  const tokens = loadTokens(identity);
  if (!tokens?.refresh_token) {
    throw new Error(
      `No tokens for identity "${identity}". Run: google-mcp auth ${identity}`,
    );
  }

  client.setCredentials(tokens);

  // Persist refreshed tokens automatically
  client.on("tokens", (newTokens) => {
    const existing = loadTokens(identity) ?? {};
    // Strip null values so they don't violate TokenSet's undefined-only fields
    const cleaned = Object.fromEntries(
      Object.entries(newTokens).filter(([, v]) => v !== null),
    ) as TokenSet;
    saveTokens(identity, { ...existing, ...cleaned });
  });

  return client;
}

/** Run the OAuth browser flow for an identity. */
export async function runAuthFlow(identity: string): Promise<void> {
  const config = loadGlobalConfig();
  const client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    REDIRECT_URI,
  );

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log(`Authenticating identity: ${identity}`);
  console.log(`Opening Google OAuth consent flow...\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h2>Authenticated! You can close this tab.</h2></body></html>",
          );
          server.close();
          resolve(code);
        } else {
          const error = url.searchParams.get("error") ?? "No code received";
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>Error: ${error}</h2></body></html>`);
          server.close();
          reject(new Error(error));
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Listening on port ${REDIRECT_PORT} for OAuth callback...`);
      console.log(`\nOpen this URL in your browser:\n\n  ${authUrl}\n`);

      import("open")
        .then((mod) => mod.default(authUrl))
        .catch(() => {
          // Browser open failed — URL is already printed
        });
    });

    setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timed out after 2 minutes"));
    }, 120_000);
  });

  const { tokens } = await client.getToken(code);
  saveTokens(identity, tokens as TokenSet);

  // Get user email for confirmation
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const userInfo = await oauth2.userinfo.get();
  console.log(`\nConnected as ${userInfo.data.email ?? "unknown"}`);
}

/** Print auth status for all known identities. */
export async function printAuthStatus(): Promise<void> {
  const dir = process.env.GOOGLE_TOKEN_DIR ?? TOKEN_DIR;
  if (!existsSync(dir)) {
    console.log("No identities configured.");
    return;
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log("No identities configured.");
    return;
  }

  for (const file of files) {
    const identity = file.replace(".json", "");
    const tokens = loadTokens(identity);
    if (tokens?.refresh_token) {
      try {
        const client = createAuthClient(identity);
        const oauth2 = google.oauth2({ version: "v2", auth: client });
        const info = await oauth2.userinfo.get();
        console.log(`${identity}: connected (${info.data.email})`);
      } catch {
        console.log(`${identity}: token exists but may need refresh`);
      }
    } else {
      console.log(`${identity}: not authenticated`);
    }
  }
}
