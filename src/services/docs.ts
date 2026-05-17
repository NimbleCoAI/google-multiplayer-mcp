/** Docs service — tools for Google Docs access with folder filtering. */

import { google } from "googleapis";
import type { PermissionConfig, ToolDef } from "../types.js";
import { hasAccess } from "../types.js";
import { getAllowedFolders, checkFolderAccess } from "../permissions.js";

type AuthClient = InstanceType<typeof google.auth.OAuth2>;

/**
 * Walk the document body content and extract plain text.
 */
function extractDocText(doc: Record<string, any>): string {
  const content: string[] = [];
  const bodyContent: any[] = doc.body?.content ?? [];

  for (const element of bodyContent) {
    const paragraph = element.paragraph;
    if (!paragraph) continue;
    for (const el of paragraph.elements ?? []) {
      const text = el.textRun?.content;
      if (text) content.push(text);
    }
  }

  return content.join("");
}

/**
 * Returns an array of ToolDef objects for Google Docs, filtered by access level.
 */
export function getDocsTools(
  config: PermissionConfig,
  auth: AuthClient,
): ToolDef[] {
  const docsAccess = config.permissions.docs?.access ?? "none";

  if (docsAccess === "none") return [];

  const docs = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });
  const allowedFolders = getAllowedFolders(config, "docs");

  const tools: ToolDef[] = [];

  // ── Read tools ──────────────────────────────────────────────────────────

  tools.push({
    name: "docs_get",
    description: "Get the content of a Google Doc as plain text.",
    service: "docs",
    requiredAccess: "read",
    inputSchema: {
      type: "object",
      required: ["documentId"],
      properties: {
        documentId: {
          type: "string",
          description: "The ID of the Google Doc to retrieve.",
        },
      },
    },
    handler: async (args) => {
      const documentId = args.documentId as string;

      // Check folder access via Drive API (Docs API doesn't expose parents)
      const meta = await drive.files.get({
        fileId: documentId,
        fields: "id, name, parents",
        supportsAllDrives: true,
      });

      checkFolderAccess(meta.data.parents ?? [], allowedFolders);

      const res = await docs.documents.get({ documentId });
      const doc = res.data as Record<string, any>;
      const text = extractDocText(doc);

      return {
        documentId: doc.documentId,
        title: doc.title,
        text,
      };
    },
  });

  // ── Write tools ─────────────────────────────────────────────────────────

  if (hasAccess(docsAccess, "write")) {
    tools.push({
      name: "docs_create",
      description: "Create a new Google Doc, optionally with content and in a specific folder.",
      service: "docs",
      requiredAccess: "write",
      inputSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: {
            type: "string",
            description: "Title of the new Google Doc.",
          },
          content: {
            type: "string",
            description: "Initial text content to insert into the document.",
          },
          folderId: {
            type: "string",
            description: "Drive folder ID to place the document in.",
          },
        },
      },
      handler: async (args) => {
        const title = args.title as string;
        const content = args.content as string | undefined;
        const folderId = args.folderId as string | undefined;

        if (folderId && allowedFolders.length > 0 && !allowedFolders.includes(folderId)) {
          throw new Error(`Folder ${folderId} is not in allowed folders`);
        }

        // Create the document
        const createRes = await docs.documents.create({
          requestBody: { title },
        });

        const documentId = createRes.data.documentId!;

        // Move to folder via Drive API — use specified folder or first allowed folder
        const targetFolder = folderId ?? (allowedFolders.length > 0 ? allowedFolders[0] : null);
        if (targetFolder) {
          const fileMeta = await drive.files.get({
            fileId: documentId,
            fields: "parents",
            supportsAllDrives: true,
          });
          const previousParents = (fileMeta.data.parents ?? []).join(",");

          await drive.files.update({
            fileId: documentId,
            addParents: targetFolder,
            removeParents: previousParents || undefined,
            fields: "id, parents",
            supportsAllDrives: true,
          });
        }

        // Insert content if provided
        if (content) {
          await docs.documents.batchUpdate({
            documentId,
            requestBody: {
              requests: [
                {
                  insertText: {
                    location: { index: 1 },
                    text: content,
                  },
                },
              ],
            },
          });
        }

        return {
          documentId,
          title,
          folderId: folderId ?? null,
        };
      },
    });

    tools.push({
      name: "docs_update",
      description: "Append text to an existing Google Doc.",
      service: "docs",
      requiredAccess: "write",
      inputSchema: {
        type: "object",
        required: ["documentId", "text"],
        properties: {
          documentId: {
            type: "string",
            description: "The ID of the Google Doc to update.",
          },
          text: {
            type: "string",
            description: "Text to append to the document.",
          },
        },
      },
      handler: async (args) => {
        const documentId = args.documentId as string;
        const text = args.text as string;

        // Check folder access via Drive API
        const meta = await drive.files.get({
          fileId: documentId,
          fields: "id, name, parents",
          supportsAllDrives: true,
        });

        checkFolderAccess(meta.data.parents ?? [], allowedFolders);

        // Get current document to find end index
        const docRes = await docs.documents.get({ documentId });
        const doc = docRes.data as Record<string, any>;
        const bodyContent: any[] = doc.body?.content ?? [];

        // The last element in body.content has the end index
        let endIndex = 1;
        if (bodyContent.length > 0) {
          const last = bodyContent[bodyContent.length - 1];
          endIndex = (last.endIndex ?? 1) - 1;
        }

        await docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: endIndex },
                  text,
                },
              },
            ],
          },
        });

        return { documentId, appended: text.length };
      },
    });
  }

  // ── Admin tools ──────────────────────────────────────────────────────────

  if (hasAccess(docsAccess, "admin")) {
    tools.push({
      name: "docs_delete",
      description: "Move a Google Doc to trash.",
      service: "docs",
      requiredAccess: "admin",
      inputSchema: {
        type: "object",
        required: ["documentId"],
        properties: {
          documentId: {
            type: "string",
            description: "The ID of the Google Doc to delete (move to trash).",
          },
        },
      },
      handler: async (args) => {
        const documentId = args.documentId as string;

        // Check folder access via Drive API
        const meta = await drive.files.get({
          fileId: documentId,
          fields: "id, name, parents",
          supportsAllDrives: true,
        });

        checkFolderAccess(meta.data.parents ?? [], allowedFolders);

        await drive.files.update({
          fileId: documentId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });

        return { success: true, documentId };
      },
    });
  }

  return tools;
}
