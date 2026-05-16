/** MCP server — dynamic tool registration and call routing. */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { PermissionConfig, ToolDef } from "./types.js";
import { createAuthClient } from "./auth.js";
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

/** Start the MCP server over stdio. */
export async function startServer(config: PermissionConfig): Promise<void> {
  const tools = collectTools(config);

  const server = new Server(
    { name: "google-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // List tools — return only the tools this agent has access to
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // Call tool — route to the correct handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
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
