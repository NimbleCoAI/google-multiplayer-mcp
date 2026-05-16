/** Sheets service — tools for Google Sheets access with folder filtering. */

import { google } from "googleapis";
import type { PermissionConfig, ToolDef } from "../types.js";
import { hasAccess } from "../types.js";
import { getAllowedFolders, checkFolderAccess } from "../permissions.js";

type AuthClient = InstanceType<typeof google.auth.OAuth2>;

/**
 * Returns an array of ToolDef objects for Google Sheets, filtered by access level.
 */
export function getSheetsTools(
  config: PermissionConfig,
  auth: AuthClient,
): ToolDef[] {
  const sheetsAccess = config.permissions.sheets?.access ?? "none";

  if (sheetsAccess === "none") return [];

  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });
  const allowedFolders = getAllowedFolders(config, "sheets");

  const tools: ToolDef[] = [];

  // ── Read tools ──────────────────────────────────────────────────────────

  tools.push({
    name: "sheets_get",
    description:
      "Get data from a Google Spreadsheet. If a range is specified, returns cell values; otherwise returns sheet metadata.",
    service: "sheets",
    requiredAccess: "read",
    inputSchema: {
      type: "object",
      required: ["spreadsheetId"],
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The ID of the spreadsheet.",
        },
        range: {
          type: "string",
          description: "A1 notation range to read (e.g. 'Sheet1!A1:D10'). Omit to get sheet list.",
        },
      },
    },
    handler: async (args) => {
      const spreadsheetId = args.spreadsheetId as string;
      const range = args.range as string | undefined;

      // Check folder access via Drive API
      const meta = await drive.files.get({
        fileId: spreadsheetId,
        fields: "id, name, parents",
      });

      checkFolderAccess(meta.data.parents ?? [], allowedFolders);

      if (range) {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });

        return {
          spreadsheetId,
          range: res.data.range,
          values: res.data.values ?? [],
        };
      }

      // No range — return sheet list with metadata
      const res = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "spreadsheetId,properties.title,sheets.properties",
      });

      const sheetList = (res.data.sheets ?? []).map((s: any) => ({
        title: s.properties?.title,
        sheetId: s.properties?.sheetId,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      }));

      return {
        spreadsheetId: res.data.spreadsheetId,
        title: res.data.properties?.title,
        sheets: sheetList,
      };
    },
  });

  // ── Write tools ─────────────────────────────────────────────────────────

  if (hasAccess(sheetsAccess, "write")) {
    tools.push({
      name: "sheets_create",
      description: "Create a new Google Spreadsheet, optionally with headers and in a specific folder.",
      service: "sheets",
      requiredAccess: "write",
      inputSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: {
            type: "string",
            description: "Title of the new spreadsheet.",
          },
          headers: {
            type: "array",
            items: { type: "string" },
            description: "Column headers to write into row 1 of Sheet1.",
          },
          folderId: {
            type: "string",
            description: "Drive folder ID to place the spreadsheet in.",
          },
        },
      },
      handler: async (args) => {
        const title = args.title as string;
        const headers = args.headers as string[] | undefined;
        const folderId = args.folderId as string | undefined;

        if (folderId && allowedFolders.length > 0 && !allowedFolders.includes(folderId)) {
          throw new Error(`Folder ${folderId} is not in allowed folders`);
        }

        // Create the spreadsheet
        const createRes = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title },
          },
        });

        const spreadsheetId = createRes.data.spreadsheetId!;

        // Move to folder via Drive API — use specified folder or first allowed folder
        const targetFolder = folderId ?? (allowedFolders.length > 0 ? allowedFolders[0] : null);
        if (targetFolder) {
          const fileMeta = await drive.files.get({
            fileId: spreadsheetId,
            fields: "parents",
          });
          const previousParents = (fileMeta.data.parents ?? []).join(",");

          await drive.files.update({
            fileId: spreadsheetId,
            addParents: targetFolder,
            removeParents: previousParents || undefined,
            fields: "id, parents",
          });
        }

        // Write headers if provided
        if (headers && headers.length > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: "Sheet1!A1",
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [headers],
            },
          });
        }

        return {
          spreadsheetId,
          title,
          folderId: folderId ?? null,
        };
      },
    });

    tools.push({
      name: "sheets_update",
      description: "Update cells in a Google Spreadsheet.",
      service: "sheets",
      requiredAccess: "write",
      inputSchema: {
        type: "object",
        required: ["spreadsheetId", "range", "values"],
        properties: {
          spreadsheetId: {
            type: "string",
            description: "The ID of the spreadsheet.",
          },
          range: {
            type: "string",
            description: "A1 notation range to update (e.g. 'Sheet1!A1:C3').",
          },
          values: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
            },
            description: "2D array of values to write (rows × columns).",
          },
        },
      },
      handler: async (args) => {
        const spreadsheetId = args.spreadsheetId as string;
        const range = args.range as string;
        const values = args.values as string[][];

        // Check folder access via Drive API
        const meta = await drive.files.get({
          fileId: spreadsheetId,
          fields: "id, name, parents",
        });

        checkFolderAccess(meta.data.parents ?? [], allowedFolders);

        const res = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        });

        return {
          spreadsheetId,
          updatedRange: res.data.updatedRange,
          updatedRows: res.data.updatedRows,
          updatedColumns: res.data.updatedColumns,
          updatedCells: res.data.updatedCells,
        };
      },
    });
  }

  // ── Admin tools ──────────────────────────────────────────────────────────

  if (hasAccess(sheetsAccess, "admin")) {
    tools.push({
      name: "sheets_delete",
      description: "Move a Google Spreadsheet to trash.",
      service: "sheets",
      requiredAccess: "admin",
      inputSchema: {
        type: "object",
        required: ["spreadsheetId"],
        properties: {
          spreadsheetId: {
            type: "string",
            description: "The ID of the spreadsheet to delete (move to trash).",
          },
        },
      },
      handler: async (args) => {
        const spreadsheetId = args.spreadsheetId as string;

        // Check folder access via Drive API
        const meta = await drive.files.get({
          fileId: spreadsheetId,
          fields: "id, name, parents",
        });

        checkFolderAccess(meta.data.parents ?? [], allowedFolders);

        await drive.files.update({
          fileId: spreadsheetId,
          requestBody: { trashed: true },
        });

        return { success: true, spreadsheetId };
      },
    });
  }

  return tools;
}
