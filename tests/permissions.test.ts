import { describe, it, expect } from "vitest";
import {
  loadPermissionConfig,
  checkAccess,
  filterByFolders,
  getServiceAccess,
} from "../src/permissions.js";
import { hasAccess } from "../src/types.js";

describe("hasAccess", () => {
  it("read meets read", () => {
    expect(hasAccess("read", "read")).toBe(true);
  });

  it("read does not meet write", () => {
    expect(hasAccess("read", "write")).toBe(false);
  });

  it("admin meets everything", () => {
    expect(hasAccess("admin", "read")).toBe(true);
    expect(hasAccess("admin", "write")).toBe(true);
    expect(hasAccess("admin", "admin")).toBe(true);
  });

  it("none meets nothing", () => {
    expect(hasAccess("none", "read")).toBe(false);
  });
});

describe("loadPermissionConfig", () => {
  it("parses valid YAML config", () => {
    const yaml = `
google:
  identity: frontdoor
  permissions:
    drive:
      access: read
      folders: ["folder-abc"]
    calendar:
      access: none
`;
    const config = loadPermissionConfig(yaml);
    expect(config.identity).toBe("frontdoor");
    expect(config.permissions.drive?.access).toBe("read");
    expect(config.permissions.drive?.folders).toEqual(["folder-abc"]);
    expect(config.permissions.calendar?.access).toBe("none");
  });

  it("defaults access to read when service is declared without level", () => {
    const yaml = `
google:
  identity: personal
  permissions:
    drive: {}
`;
    const config = loadPermissionConfig(yaml);
    expect(config.permissions.drive?.access).toBe("read");
  });

  it("throws on missing identity", () => {
    const yaml = `
google:
  permissions:
    drive:
      access: read
`;
    expect(() => loadPermissionConfig(yaml)).toThrow("identity");
  });
});

describe("getServiceAccess", () => {
  it("returns none for undeclared service", () => {
    const config = loadPermissionConfig(`
google:
  identity: test
  permissions:
    drive:
      access: read
`);
    expect(getServiceAccess(config, "gmail")).toBe("none");
  });
});

describe("checkAccess", () => {
  const config = loadPermissionConfig(`
google:
  identity: test
  permissions:
    drive:
      access: write
    calendar:
      access: read
`);

  it("allows write on drive", () => {
    expect(() => checkAccess(config, "drive", "write")).not.toThrow();
  });

  it("rejects admin on drive", () => {
    expect(() => checkAccess(config, "drive", "admin")).toThrow("admin");
  });

  it("rejects any access on undeclared service", () => {
    expect(() => checkAccess(config, "gmail", "read")).toThrow("none");
  });
});

describe("filterByFolders", () => {
  const items = [
    { id: "1", name: "allowed.txt", parents: ["folder-abc"] },
    { id: "2", name: "denied.txt", parents: ["folder-xyz"] },
    { id: "3", name: "also-allowed.txt", parents: ["folder-abc"] },
    { id: "4", name: "no-parent.txt" },
  ];

  it("returns only items in allowed folders", () => {
    const result = filterByFolders(items, ["folder-abc"]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("returns all items when no folder restriction", () => {
    const result = filterByFolders(items, []);
    expect(result).toHaveLength(4);
  });
});
