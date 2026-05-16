/** Permission config parsing, access checks, and folder filtering. */

import { readFileSync } from "fs";
import yaml from "js-yaml";
import type {
  PermissionConfig,
  ConfigFile,
  ServiceName,
  AccessLevel,
  ServicePermission,
} from "./types.js";
import { hasAccess } from "./types.js";

/**
 * Parse YAML string into a PermissionConfig.
 * Defaults access to "read" when a service is declared without an access level.
 */
export function loadPermissionConfig(yamlStr: string): PermissionConfig {
  const raw = yaml.load(yamlStr) as ConfigFile;

  if (!raw?.google?.identity) {
    throw new Error("Permission config must specify google.identity");
  }

  const perms = raw.google.permissions ?? {};

  // Normalize: default access to "read" for declared services
  const normalized: Partial<Record<ServiceName, ServicePermission>> = {};
  for (const [key, value] of Object.entries(perms)) {
    const svc = key as ServiceName;
    const raw_perm = value as Partial<ServicePermission> | null;
    normalized[svc] = {
      access: raw_perm?.access ?? "read",
      folders: raw_perm?.folders ?? [],
    };
  }

  return {
    identity: raw.google.identity,
    permissions: normalized,
  };
}

/**
 * Load permission config from a YAML file path.
 */
export function loadPermissionConfigFromFile(filePath: string): PermissionConfig {
  const content = readFileSync(filePath, "utf-8");
  return loadPermissionConfig(content);
}

/** Get the access level for a service. Returns "none" if not declared. */
export function getServiceAccess(
  config: PermissionConfig,
  service: ServiceName,
): AccessLevel {
  return config.permissions[service]?.access ?? "none";
}

/** Get allowed folder IDs for a service. Empty array = no restriction. */
export function getAllowedFolders(
  config: PermissionConfig,
  service: ServiceName,
): string[] {
  return config.permissions[service]?.folders ?? [];
}

/**
 * Check that the agent has sufficient access for an operation.
 * Throws if access is insufficient.
 */
export function checkAccess(
  config: PermissionConfig,
  service: ServiceName,
  required: AccessLevel,
): void {
  const granted = getServiceAccess(config, service);
  if (!hasAccess(granted, required)) {
    throw new Error(
      `Insufficient permissions: ${service} requires ${required} access, agent has ${granted}`,
    );
  }
}

/**
 * Check that a target item's direct parents are within allowed folders.
 * Throws if no direct parent is in the allowed list.
 * No-op if allowedFolders is empty (no restriction).
 *
 * NOTE: This only checks direct parents — it does NOT walk the full ancestor
 * chain. For deep folder tree checks (files inside subfolders of allowed
 * folders), use `isWithinAllowedFolders` in `src/services/drive.ts`, which
 * recursively walks parents via the Drive API. This function is used only for
 * list-result filtering where items are already direct children of queried
 * folders.
 */
export function checkFolderAccess(
  itemParents: string[] | undefined,
  allowedFolders: string[],
): void {
  if (allowedFolders.length === 0) return;
  if (!itemParents || itemParents.length === 0) {
    throw new Error("Item has no parent folder — cannot verify folder access");
  }
  const allowed = itemParents.some((p) => allowedFolders.includes(p));
  if (!allowed) {
    throw new Error("Item is outside allowed folders");
  }
}

/**
 * Filter a list of items to only those whose direct parents are in allowed folders.
 * Returns all items if allowedFolders is empty.
 *
 * NOTE: This checks direct parents only. When using Drive API's `q` parameter
 * with `'folderId' in parents`, items returned are already direct children of
 * the queried folder, so this filter is correct for list results. For access
 * checks on arbitrary files (which may be in nested subfolders), use
 * `isWithinAllowedFolders` in `src/services/drive.ts` instead.
 */
export function filterByFolders<T extends { parents?: string[] }>(
  items: T[],
  allowedFolders: string[],
): T[] {
  if (allowedFolders.length === 0) return items;
  return items.filter(
    (item) => item.parents?.some((p) => allowedFolders.includes(p)) ?? false,
  );
}
