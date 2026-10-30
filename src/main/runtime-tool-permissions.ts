import { BrowserWindow, dialog } from "electron";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { redactSensitiveText } from "../shared/redaction";
import { isToolDeletion } from "../shared/runtime-permissions";

export type AuthorizeRuntimeTool = (
  name: string,
  input: Record<string, unknown>,
) => Promise<boolean>;
export interface RuntimePermissionBridge {
  environment: Record<string, string>;
  authorize: AuthorizeRuntimeTool;
  isActive?(): boolean;
  dispose(): void;
}

/** Recheck live Run authority after every native confirmation; never persist approval. */
export async function promptRuntimeDeletion(
  runtimeName: string,
  name: string,
  input: Record<string, unknown>,
): Promise<boolean> {
  const window =
    BrowserWindow.getFocusedWindow?.() ?? BrowserWindow.getAllWindows?.()[0];
  const detail = redactSensitiveText(JSON.stringify(input)).slice(0, 4000);
  const options = {
    type: "warning" as const,
    title: "确认本次删除",
    message: runtimeName + " 请求删除文件或文档",
    detail:
      name +
      "\n" +
      detail +
      "\n\n仅授权本次操作；拒绝后智能体仍可继续其他工作。",
    buttons: ["允许本次删除", "拒绝"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

/** Loopback bridge for native tool hooks; each capability belongs to exactly one Run. */
export async function createRuntimePermissionBridge(
  authorize: AuthorizeRuntimeTool,
): Promise<RuntimePermissionBridge> {
  const token = randomBytes(32).toString("hex");
  let closed = false;
  const replies = new Set<import("node:http").ServerResponse>();
  const server = createServer(async (request, response) => {
    if (
      closed ||
      request.method !== "POST" ||
      request.url !== "/authorize" ||
      request.headers.authorization !== "Bearer " + token ||
      request.headers.origin
    ) {
      response.writeHead(403).end();
      return;
    }
    replies.add(response);
    response.once("close", () => replies.delete(response));
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 256 * 1024) {
          response.writeHead(413).end();
          return;
        }
      }
      const input = JSON.parse(body);
      if (
        typeof input.name !== "string" ||
        !input.input ||
        typeof input.input !== "object" ||
        Array.isArray(input.input)
      ) {
        response.writeHead(400).end();
        return;
      }
      const allowed = !closed && (await authorize(input.name, input.input));
      if (!response.writableEnded)
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ allowed: !closed && allowed }));
    } catch {
      if (!response.writableEnded) response.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Permission bridge unavailable");
  return {
    environment: {
      AGENTS_ONE_PERMISSION_URL:
        "http://127.0.0.1:" + address.port + "/authorize",
      AGENTS_ONE_PERMISSION_TOKEN: token,
    },
    authorize: async (name, input) =>
      !closed && (await authorize(name, input)) && !closed,
    isActive: () => !closed,
    dispose() {
      if (closed) return;
      closed = true;
      for (const response of replies)
        if (!response.writableEnded)
          response
            .writeHead(200, { "Content-Type": "application/json" })
            .end('{"allowed":false}');
      server.close();
      server.closeIdleConnections();
    },
  };
}

export function requiresDeletionConfirmation(
  name: string,
  input: Record<string, unknown>,
): boolean {
  return isToolDeletion(name, input);
}
