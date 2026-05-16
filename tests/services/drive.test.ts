import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PermissionConfig } from "../../src/types.js";

// Mock googleapis before importing drive module
vi.mock("googleapis", () => {
  const listFn = vi.fn();
  const getFn = vi.fn();
  const createFn = vi.fn();
  const updateFn = vi.fn();
  const deleteFn = vi.fn();

  return {
    google: {
      drive: () => ({
        files: {
          list: listFn,
          get: getFn,
          create: createFn,
          update: updateFn,
          delete: deleteFn,
        },
        permissions: {
          create: vi.fn(),
        },
      }),
    },
    _mocks: { listFn, getFn, createFn, updateFn, deleteFn },
  };
});

// Import after mock setup
const { _mocks } = await import("googleapis") as any;
const { getDriveTools } = await import("../../src/services/drive.js");

const readConfig: PermissionConfig = {
  identity: "test",
  permissions: {
    drive: { access: "read", folders: ["folder-a"] },
  },
};

const writeConfig: PermissionConfig = {
  identity: "test",
  permissions: {
    drive: { access: "write", folders: [] },
  },
};

describe("getDriveTools", () => {
  it("returns read tools for read access", () => {
    const tools = getDriveTools(readConfig, {} as any);
    const names = tools.map((t) => t.name);
    expect(names).toContain("drive_list");
    expect(names).toContain("drive_get");
    expect(names).toContain("drive_search");
    expect(names).not.toContain("drive_upload");
    expect(names).not.toContain("drive_delete");
  });

  it("returns write tools for write access", () => {
    const tools = getDriveTools(writeConfig, {} as any);
    const names = tools.map((t) => t.name);
    expect(names).toContain("drive_upload");
    expect(names).toContain("drive_create_folder");
    expect(names).not.toContain("drive_delete");
  });
});

describe("drive_list handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters results to allowed folders", async () => {
    _mocks.listFn.mockResolvedValue({
      data: {
        files: [
          { id: "1", name: "a.txt", mimeType: "text/plain", parents: ["folder-a"] },
          { id: "2", name: "b.txt", mimeType: "text/plain", parents: ["folder-b"] },
        ],
      },
    });

    const tools = getDriveTools(readConfig, {} as any);
    const listTool = tools.find((t) => t.name === "drive_list")!;
    const result = (await listTool.handler({})) as any;

    expect(result.files).toHaveLength(1);
    expect(result.files[0].id).toBe("1");
  });

  it("returns all files when no folder restriction", async () => {
    _mocks.listFn.mockResolvedValue({
      data: {
        files: [
          { id: "1", name: "a.txt", mimeType: "text/plain", parents: ["any"] },
          { id: "2", name: "b.txt", mimeType: "text/plain", parents: ["other"] },
        ],
      },
    });

    const tools = getDriveTools(writeConfig, {} as any);
    const listTool = tools.find((t) => t.name === "drive_list")!;
    const result = (await listTool.handler({})) as any;

    expect(result.files).toHaveLength(2);
  });
});
