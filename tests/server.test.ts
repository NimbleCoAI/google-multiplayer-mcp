import { describe, it, expect, vi } from "vitest";
import type { PermissionConfig } from "../src/types.js";

// Mock auth module
vi.mock("../src/auth.js", () => ({
  createAuthClient: vi.fn(() => ({})),
}));

// Mock all service modules to return known tool sets
vi.mock("../src/services/drive.js", () => ({
  getDriveTools: vi.fn(() => [
    { name: "drive_list", description: "List files", service: "drive", requiredAccess: "read", inputSchema: {}, handler: async () => ({}) },
  ]),
}));

vi.mock("../src/services/calendar.js", () => ({
  getCalendarTools: vi.fn(() => []),
}));

vi.mock("../src/services/gmail.js", () => ({
  getGmailTools: vi.fn(() => []),
}));

vi.mock("../src/services/docs.js", () => ({
  getDocsTools: vi.fn(() => []),
}));

vi.mock("../src/services/sheets.js", () => ({
  getSheetsTools: vi.fn(() => []),
}));

const { collectTools } = await import("../src/server.js");

describe("collectTools", () => {
  it("aggregates tools from all services", () => {
    const config: PermissionConfig = {
      identity: "test",
      permissions: {
        drive: { access: "read" },
      },
    };

    const tools = collectTools(config);
    expect(tools.length).toBeGreaterThanOrEqual(1);
    expect(tools.find((t) => t.name === "drive_list")).toBeDefined();
  });
});
