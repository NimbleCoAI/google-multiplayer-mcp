import { describe, it, expect, vi } from "vitest";
import { loadPermissionConfig } from "../src/permissions.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock auth to avoid needing real tokens
vi.mock("../src/auth.js", () => ({
  createAuthClient: vi.fn(() => ({})),
}));

// Mock googleapis to avoid real API calls
vi.mock("googleapis", () => ({
  google: {
    drive: () => ({
      files: {
        list: vi.fn().mockResolvedValue({ data: { files: [] } }),
        get: vi.fn().mockResolvedValue({ data: {} }),
      },
      permissions: { create: vi.fn() },
    }),
    calendar: () => ({
      events: {
        list: vi.fn().mockResolvedValue({ data: { items: [] } }),
        get: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      calendarList: { list: vi.fn().mockResolvedValue({ data: { items: [] } }) },
    }),
    gmail: () => ({
      users: {
        messages: {
          list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
          get: vi.fn(),
          send: vi.fn(),
          delete: vi.fn(),
        },
        drafts: { create: vi.fn() },
      },
    }),
    docs: () => ({
      documents: {
        get: vi.fn().mockResolvedValue({ data: {} }),
        create: vi.fn().mockResolvedValue({ data: {} }),
        batchUpdate: vi.fn(),
      },
    }),
    sheets: () => ({
      spreadsheets: {
        get: vi.fn().mockResolvedValue({ data: { sheets: [] } }),
        create: vi.fn().mockResolvedValue({ data: {} }),
        values: {
          get: vi.fn().mockResolvedValue({ data: {} }),
          update: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    }),
  },
}));

const { collectTools } = await import("../src/server.js");

describe("integration: example configs produce correct tool sets", () => {
  it("personal config exposes write tools but not admin", () => {
    const yaml = readFileSync(join(__dirname, "../examples/personal.yaml"), "utf-8");
    const config = loadPermissionConfig(yaml);
    const tools = collectTools(config);

    const names = tools.map((t) => t.name);

    // Should have write tools
    expect(names).toContain("drive_upload");
    expect(names).toContain("calendar_create_event");
    expect(names).toContain("docs_create");

    // Should NOT have admin tools
    expect(names).not.toContain("drive_delete");
    expect(names).not.toContain("drive_share");
    expect(names).not.toContain("calendar_delete_event");

    // Gmail should be read-only
    expect(names).toContain("gmail_list");
    expect(names).not.toContain("gmail_send");
  });

  it("osint config exposes only read tools for drive and docs", () => {
    const yaml = readFileSync(join(__dirname, "../examples/osint.yaml"), "utf-8");
    const config = loadPermissionConfig(yaml);
    const tools = collectTools(config);

    const names = tools.map((t) => t.name);

    expect(names).toContain("drive_list");
    expect(names).toContain("drive_get");
    expect(names).toContain("docs_get");
    expect(names).toContain("sheets_get");

    // No write tools
    expect(names).not.toContain("drive_upload");
    expect(names).not.toContain("docs_create");

    // No calendar or gmail
    expect(names).not.toContain("calendar_list_events");
    expect(names).not.toContain("gmail_list");
  });
});
