/**
 * Nested folder access tests.
 *
 * An agent granted a root folder must be able to discover and write into
 * SUBFOLDERS of that root — not just its direct children. These tests model a
 * tree:
 *
 *   folder-a (allowed root)
 *     └── folder-sub
 *           └── file-nested.txt
 *           └── doc-nested  (Google Doc)
 *           └── sheet-nested (Google Sheet)
 *
 * The shared `files.list` mock distinguishes folder-tree BFS queries (which
 * contain the folder mimeType) from content-listing queries, and the
 * `files.get` mock returns the parent chain so the recursive ancestor walk
 * resolves correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PermissionConfig } from "../../src/types.js";

vi.mock("googleapis", () => {
  const listFn = vi.fn();
  const getFn = vi.fn();
  const createFn = vi.fn();
  const updateFn = vi.fn();
  const deleteFn = vi.fn();
  const docsCreateFn = vi.fn();
  const docsGetFn = vi.fn();
  const docsBatchUpdateFn = vi.fn();
  const sheetsValuesUpdateFn = vi.fn();
  const sheetsGetFn = vi.fn();

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
        permissions: { create: vi.fn() },
      }),
      docs: () => ({
        documents: {
          get: docsGetFn,
          create: docsCreateFn,
          batchUpdate: docsBatchUpdateFn,
        },
      }),
      sheets: () => ({
        spreadsheets: {
          get: sheetsGetFn,
          create: vi.fn(),
          batchUpdate: vi.fn(),
          values: {
            get: vi.fn(),
            update: sheetsValuesUpdateFn,
          },
        },
      }),
    },
    _mocks: {
      listFn,
      getFn,
      createFn,
      updateFn,
      deleteFn,
      docsCreateFn,
      docsGetFn,
      docsBatchUpdateFn,
      sheetsValuesUpdateFn,
      sheetsGetFn,
    },
  };
});

const { _mocks } = (await import("googleapis")) as any;
const { getDriveTools } = await import("../../src/services/drive.js");
const { getDocsTools } = await import("../../src/services/docs.js");
const { getSheetsTools } = await import("../../src/services/sheets.js");

// ── Folder tree model ───────────────────────────────────────────────────────
// child folder id -> its direct child folder ids
const FOLDER_CHILDREN: Record<string, string[]> = {
  "folder-a": ["folder-sub"],
  "folder-sub": [],
};
// file/folder id -> parents
const PARENTS: Record<string, string[]> = {
  "folder-sub": ["folder-a"],
  "file-nested": ["folder-sub"],
  "doc-nested": ["folder-sub"],
  "sheet-nested": ["folder-sub"],
  "file-outside": ["folder-x"],
};

/** Install mock implementations for a tree-aware Drive client. */
function installTreeMocks() {
  // files.list: serve BOTH the BFS folder-tree queries and content queries.
  _mocks.listFn.mockImplementation(async (params: any) => {
    const q: string = params?.q ?? "";

    // BFS folder-tree query: "'<id>' in parents and mimeType='...folder' ..."
    const folderQ = q.match(/'([^']+)' in parents/);
    if (q.includes("mimeType='application/vnd.google-apps.folder'") && folderQ) {
      const parentId = folderQ[1];
      const children = FOLDER_CHILDREN[parentId] ?? [];
      return {
        data: {
          files: children.map((id) => ({ id, mimeType: "application/vnd.google-apps.folder" })),
        },
      };
    }

    // Content query (drive_list / drive_search): return the nested file. Its
    // parent is folder-sub (a SUBfolder of allowed root folder-a), plus an
    // out-of-scope file that must always be excluded.
    return {
      data: {
        files: [
          { id: "file-nested", name: "nested.txt", mimeType: "text/plain", parents: ["folder-sub"] },
          { id: "file-outside", name: "outside.txt", mimeType: "text/plain", parents: ["folder-x"] },
        ],
      },
    };
  });

  // files.get: return parents so the recursive ancestor walk resolves.
  _mocks.getFn.mockImplementation(async (params: any) => {
    const id = params.fileId as string;
    return {
      data: {
        id,
        name: `${id}.txt`,
        mimeType: "text/plain",
        parents: PARENTS[id] ?? [],
      },
    };
  });

  _mocks.createFn.mockResolvedValue({
    data: { id: "new-id", name: "created", parents: ["folder-sub"] },
  });
  _mocks.updateFn.mockResolvedValue({ data: { id: "doc-nested", parents: ["folder-sub"] } });
  _mocks.docsGetFn.mockResolvedValue({
    data: { documentId: "doc-nested", title: "Nested Doc", body: { content: [] } },
  });
  _mocks.docsCreateFn.mockResolvedValue({ data: { documentId: "doc-nested" } });
  _mocks.docsBatchUpdateFn.mockResolvedValue({ data: { replies: [] } });
  _mocks.sheetsValuesUpdateFn.mockResolvedValue({ data: { updatedCells: 1 } });
  _mocks.sheetsGetFn.mockResolvedValue({
    data: { spreadsheetId: "sheet-nested", properties: { title: "Nested Sheet" }, sheets: [] },
  });
}

const driveAdminConfig: PermissionConfig = {
  identity: "test",
  permissions: { drive: { access: "admin", folders: ["folder-a"] } },
};
const docsWriteConfig: PermissionConfig = {
  identity: "test",
  permissions: { docs: { access: "write", folders: ["folder-a"] } },
};
const sheetsWriteConfig: PermissionConfig = {
  identity: "test",
  permissions: { sheets: { access: "write", folders: ["folder-a"] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  installTreeMocks();
});

describe("drive_list: nested folder discovery", () => {
  it("lists files inside a subfolder of an allowed root", async () => {
    const tools = getDriveTools(driveAdminConfig, {} as any);
    const listTool = tools.find((t) => t.name === "drive_list")!;
    const result = (await listTool.handler({})) as any;

    const ids = result.files.map((f: any) => f.id);
    expect(ids).toContain("file-nested"); // in folder-sub ⊂ folder-a
    expect(ids).not.toContain("file-outside"); // in folder-x, out of scope
  });

  it("allows listing a subfolder directly by id", async () => {
    const tools = getDriveTools(driveAdminConfig, {} as any);
    const listTool = tools.find((t) => t.name === "drive_list")!;
    const result = (await listTool.handler({ folderId: "folder-sub" })) as any;
    const ids = result.files.map((f: any) => f.id);
    expect(ids).toContain("file-nested");
  });

  it("still rejects a folder entirely outside the allowed tree", async () => {
    const tools = getDriveTools(driveAdminConfig, {} as any);
    const listTool = tools.find((t) => t.name === "drive_list")!;
    await expect(listTool.handler({ folderId: "folder-x" })).rejects.toThrow(
      /not in allowed folders/,
    );
  });
});

describe("drive_search: nested folder discovery", () => {
  it("returns files inside a subfolder of an allowed root", async () => {
    const tools = getDriveTools(driveAdminConfig, {} as any);
    const searchTool = tools.find((t) => t.name === "drive_search")!;
    const result = (await searchTool.handler({ query: "nested" })) as any;
    const ids = result.files.map((f: any) => f.id);
    expect(ids).toContain("file-nested");
    expect(ids).not.toContain("file-outside");
  });
});

describe("drive_upload / drive_create_folder: writing into subfolders", () => {
  it("uploads into a subfolder of an allowed root", async () => {
    const tools = getDriveTools(driveAdminConfig, {} as any);
    const uploadTool = tools.find((t) => t.name === "drive_upload")!;
    await expect(
      uploadTool.handler({ name: "x.txt", content: "hi", folderId: "folder-sub" }),
    ).resolves.toBeDefined();
  });

  it("rejects upload into a folder outside the allowed tree", async () => {
    const tools = getDriveTools(driveAdminConfig, {} as any);
    const uploadTool = tools.find((t) => t.name === "drive_upload")!;
    await expect(
      uploadTool.handler({ name: "x.txt", content: "hi", folderId: "folder-x" }),
    ).rejects.toThrow(/not in allowed folders/);
  });

  it("creates a folder inside a subfolder of an allowed root", async () => {
    const tools = getDriveTools(driveAdminConfig, {} as any);
    const createTool = tools.find((t) => t.name === "drive_create_folder")!;
    await expect(
      createTool.handler({ name: "child", parentId: "folder-sub" }),
    ).resolves.toBeDefined();
  });
});

describe("docs_*: nested doc access", () => {
  it("reads a doc inside a subfolder of an allowed root", async () => {
    const tools = getDocsTools(docsWriteConfig, {} as any);
    const getTool = tools.find((t) => t.name === "docs_get")!;
    await expect(getTool.handler({ documentId: "doc-nested" })).resolves.toBeDefined();
  });

  it("rejects a doc outside the allowed tree", async () => {
    const tools = getDocsTools(docsWriteConfig, {} as any);
    const getTool = tools.find((t) => t.name === "docs_get")!;
    await expect(getTool.handler({ documentId: "file-outside" })).rejects.toThrow(
      /outside allowed folders/,
    );
  });
});

describe("sheets_*: nested sheet access", () => {
  it("reads a sheet inside a subfolder of an allowed root", async () => {
    const tools = getSheetsTools(sheetsWriteConfig, {} as any);
    const getTool = tools.find((t) => t.name === "sheets_get")!;
    await expect(getTool.handler({ spreadsheetId: "sheet-nested" })).resolves.toBeDefined();
  });

  it("rejects a sheet outside the allowed tree", async () => {
    const tools = getSheetsTools(sheetsWriteConfig, {} as any);
    const getTool = tools.find((t) => t.name === "sheets_get")!;
    await expect(getTool.handler({ spreadsheetId: "file-outside" })).rejects.toThrow(
      /outside allowed folders/,
    );
  });
});
