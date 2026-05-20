#!/usr/bin/env node

/** Entry point — auth CLI or MCP server mode. */

import { readFileSync } from "fs";
import { runAuthFlow, runHeadlessAuthFlow, printAuthStatus } from "./auth.js";
import { loadPermissionConfig } from "./permissions.js";
import { startServer } from "./server.js";

async function main() {
  const args = process.argv.slice(2);

  // Auth subcommand: google-mcp auth <identity>
  if (args[0] === "auth") {
    if (args[1] === "status" || args.length === 1) {
      await printAuthStatus();
    } else {
      await runAuthFlow(args[1]);
    }
    return;
  }

  // Headless auth — no browser open, prints URL for machine parsing
  if (args[0] === "auth-headless") {
    if (!args[1]) {
      console.error("Usage: google-mcp auth-headless <identity>");
      process.exit(1);
    }
    await runHeadlessAuthFlow(args[1]);
    return;
  }

  // Server mode: google-mcp --config <path>
  const configIndex = args.indexOf("--config");
  if (configIndex === -1 || !args[configIndex + 1]) {
    console.error("Usage:");
    console.error("  google-mcp auth <identity>           Run OAuth flow (opens browser)");
    console.error("  google-mcp auth-headless <identity>  Run OAuth flow (prints URL, no browser)");
    console.error("  google-mcp auth status               Show auth status for all identities");
    console.error("  google-mcp --config <path>           Start MCP server with permission config");
    process.exit(1);
  }

  const configPath = args[configIndex + 1];
  const yamlContent = readFileSync(configPath, "utf-8");
  const config = loadPermissionConfig(yamlContent);

  // Log to stderr (stdout is MCP protocol)
  console.error(`google-mcp: starting with identity "${config.identity}"`);
  const services = Object.entries(config.permissions)
    .filter(([, v]) => v?.access !== "none")
    .map(([k]) => k);
  console.error(`google-mcp: enabled services: ${services.join(", ")}`);

  await startServer(config);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
