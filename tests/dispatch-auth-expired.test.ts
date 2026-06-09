import { describe, it, expect, vi } from "vitest";
import type { ToolDef } from "../src/types.js";

// The dispatcher must not pull in real auth/googleapis when we import server.
vi.mock("../src/auth.js", () => ({
  createAuthClient: vi.fn(() => ({})),
}));

const { dispatchToolCall } = await import("../src/server.js");

function makeTool(name: string, handler: ToolDef["handler"]): ToolDef {
  return {
    name,
    description: "test",
    service: "drive",
    requiredAccess: "read",
    inputSchema: {},
    handler,
  };
}

describe("dispatchToolCall — structured auth_expired errors", () => {
  it("wraps an invalid_grant failure into a structured auth_expired payload", async () => {
    const tool = makeTool("drive_list", async () => {
      throw new Error("invalid_grant");
    });

    const res = await dispatchToolCall("drive_list", {}, [tool], []);

    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.status).toBe("auth_expired");
    expect(payload.action).toContain("google_auth_url");
    expect(payload.message.toLowerCase()).toContain("dm");
  });

  it("wraps a 401 GaxiosError into auth_expired", async () => {
    const tool = makeTool("drive_get", async () => {
      const err: any = new Error("Invalid Credentials");
      err.response = { status: 401 };
      throw err;
    });

    const res = await dispatchToolCall("drive_get", {}, [tool], []);
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.status).toBe("auth_expired");
  });

  it("returns a generic structured error for non-auth failures", async () => {
    const tool = makeTool("drive_get", async () => {
      throw new Error("Item is outside allowed folders");
    });

    const res = await dispatchToolCall("drive_get", {}, [tool], []);
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.status).toBe("error");
    expect(payload.message).toContain("Item is outside allowed folders");
  });

  it("returns the successful result unchanged on success", async () => {
    const tool = makeTool("drive_list", async () => ({ files: ["a"] }));

    const res = await dispatchToolCall("drive_list", {}, [tool], []);
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.files).toEqual(["a"]);
  });

  it("reports unknown tools", async () => {
    const res = await dispatchToolCall("nope", {}, [], []);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown tool");
  });
});
