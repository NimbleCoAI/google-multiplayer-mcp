/** MCP server — dynamic tool registration and call routing. */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { PermissionConfig, ToolDef } from "./types.js";
import { createAuthClient, startHeadlessAuth, checkAuthStatus } from "./auth.js";
import { getDriveTools } from "./services/drive.js";
import { getCalendarTools } from "./services/calendar.js";
import { getGmailTools } from "./services/gmail.js";
import { getDocsTools } from "./services/docs.js";
import { getSheetsTools } from "./services/sheets.js";

/** Collect all tools the agent is allowed to use based on permissions. */
export function collectTools(config: PermissionConfig): ToolDef[] {
  const auth = createAuthClient(config.identity);
  return [
    ...getDriveTools(config, auth),
    ...getCalendarTools(config, auth),
    ...getGmailTools(config, auth),
    ...getDocsTools(config, auth),
    ...getSheetsTools(config, auth),
  ];
}

// ─── Auth MCP tool definitions ──────────────────────────────────

interface AuthToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ type: "text"; text: string }[]>;
}

function getAuthTools(identity: string): AuthToolDef[] {
  return [
    {
      name: "google_auth_start",
      description:
        "Start a Google OAuth authentication flow. Returns a URL that the user " +
        "must open in their browser to grant access. After calling this, poll " +
        "google_auth_status until it returns 'authenticated'.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      handler: async () => {
        // If already authenticated, short-circuit
        const status = checkAuthStatus(identity);
        if (status === "authenticated") {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "already_authenticated",
                message: `Identity "${identity}" is already authenticated.`,
              }),
            },
          ];
        }
        if (status === "pending") {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "pending",
                message:
                  "An auth flow is already in progress. Poll google_auth_status for updates.",
              }),
            },
          ];
        }

        const { authUrl } = startHeadlessAuth(identity);
        return [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "auth_required",
              url: authUrl,
              message:
                "Send this URL to the user. Once they complete authentication in their browser, " +
                "call google_auth_status to confirm.",
            }),
          },
        ];
      },
    },
    {
      name: "google_auth_status",
      description:
        "Check whether Google OAuth authentication has completed for the configured identity. " +
        "Returns 'authenticated', 'pending', or 'unauthenticated'.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      handler: async () => {
        const status = checkAuthStatus(identity);
        return [
          {
            type: "text" as const,
            text: JSON.stringify({ status, identity }),
          },
        ];
      },
    },
  ];
}

/** Start the MCP server over stdio. */
export async function startServer(config: PermissionConfig): Promise<void> {
  const tools = collectTools(config);
  const authTools = getAuthTools(config.identity);

  const server = new Server(
    { name: "google-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // List tools — return service tools + auth tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      ...authTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    ],
  }));

  // Call tool — route to the correct handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Check auth tools first
    const authTool = authTools.find((t) => t.name === name);
    if (authTool) {
      try {
        const content = await authTool.handler(args ?? {});
        return { content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }

    const tool = tools.find((t) => t.name === name);

    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(args ?? {});
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
