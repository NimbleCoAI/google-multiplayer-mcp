/** Shared types for google-mcp server. */

export type ServiceName = "drive" | "calendar" | "gmail" | "docs" | "sheets";

export type AccessLevel = "none" | "read" | "write" | "admin";

/** Numeric access levels for comparison. */
const ACCESS_RANK: Record<AccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

/** Returns true if granted level meets or exceeds required level. */
export function hasAccess(granted: AccessLevel, required: AccessLevel): boolean {
  return ACCESS_RANK[granted] >= ACCESS_RANK[required];
}

export interface ServicePermission {
  access: AccessLevel;
  /** Allowed folder IDs (Drive/Docs/Sheets) or calendar IDs (Calendar). Empty = all. */
  folders?: string[];
}

export interface PermissionConfig {
  identity: string;
  permissions: Partial<Record<ServiceName, ServicePermission>>;
}

/** Root shape of the YAML config file. */
export interface ConfigFile {
  google: PermissionConfig;
}

/** Shape of ~/.nimbleco-google/config.json */
export interface GlobalConfig {
  clientId: string;
  clientSecret: string;
}

/** Shape of a token file (googleapis OAuth2 tokens). */
export interface TokenSet {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

/** MCP tool definition with required access level. */
export interface ToolDef {
  name: string;
  description: string;
  service: ServiceName;
  requiredAccess: AccessLevel;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
