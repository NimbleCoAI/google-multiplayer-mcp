/**
 * Shared auth-error wrapping for service tool handlers.
 *
 * When a Google API tool call fails because the identity's OAuth grant has
 * expired or been revoked (`invalid_grant`) or the request is unauthenticated
 * (HTTP 401 / "Invalid Credentials"), the MCP must return a *structured,
 * actionable* error to the agent rather than a raw googleapis stack trace.
 *
 * The agent reads `status === "auth_expired"` and follows `action`: call
 * `google_auth_url` and DM the user the returned consent URL. This is Phase 2
 * groundwork — the proactive-DM hook on the hermes side is the deferred second
 * half. This payload is inert until an agent acts on it.
 */

/** Structured payload returned for a failed tool call. */
export interface ToolErrorPayload {
  status: "auth_expired" | "error";
  message: string;
  /** Present only for auth_expired: the tool the agent should call next. */
  action?: string;
  /** Underlying error detail, preserved for debugging. */
  detail?: string;
}

/** The MCP tool the agent should invoke to recover an expired grant. */
const REAUTH_TOOL = "google_auth_url";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/**
 * Extract an HTTP-ish status code from a googleapis/GaxiosError-shaped error.
 * Gaxios surfaces the status as either `err.code` (sometimes numeric) or
 * `err.response.status`.
 */
function statusCode(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;

  const response = e.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === "number") {
    return response.status;
  }

  if (typeof e.code === "number") return e.code;
  // Gaxios sometimes stringifies the status into `code`.
  if (typeof e.code === "string" && /^\d+$/.test(e.code)) {
    return Number(e.code);
  }

  return undefined;
}

/**
 * Returns true if the error indicates the OAuth grant is no longer valid —
 * i.e. the user needs to re-authenticate.
 *
 * Detected signals:
 *  - message contains `invalid_grant` (refresh token expired/revoked)
 *  - message contains `Invalid Credentials` (googleapis 401 body)
 *  - HTTP status 401 (from `response.status` or numeric `code`)
 *
 * Deliberately does NOT match 403 (permission denied) or other statuses —
 * those are not fixed by re-authenticating and have their own handling.
 */
export function isAuthExpiredError(err: unknown): boolean {
  if (err === null || err === undefined) return false;

  const msg = errorMessage(err).toLowerCase();
  if (msg.includes("invalid_grant")) return true;
  if (msg.includes("invalid credentials")) return true;

  if (statusCode(err) === 401) return true;

  return false;
}

/**
 * Convert a thrown tool-handler error into a structured payload. Auth-expired
 * errors get `status: "auth_expired"` plus an actionable recovery instruction;
 * everything else passes through as a generic `status: "error"`.
 */
export function formatToolError(err: unknown): ToolErrorPayload {
  const detail = errorMessage(err);

  if (isAuthExpiredError(err)) {
    return {
      status: "auth_expired",
      message:
        "The Google authorization for this identity has expired or been " +
        `revoked. Call ${REAUTH_TOOL} to get a fresh consent URL, then DM ` +
        "that consent URL to the user and ask them to complete the re-auth " +
        "flow (paste the resulting code back to google_auth_exchange). The " +
        "Google tools will not work until re-authentication completes.",
      action: `Call ${REAUTH_TOOL}, then DM the user the consent URL.`,
      detail,
    };
  }

  return {
    status: "error",
    message: detail,
  };
}
