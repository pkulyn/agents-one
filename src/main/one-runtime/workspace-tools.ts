import { randomUUID } from "node:crypto";
import {
  confirmRemoteWorkspaceDelete,
  createRemoteWorkspaceGrant,
  executeRemoteWorkspaceRequest,
  type RemoteWorkspaceOperation,
} from "../remote-workspace-gateway";
import type { OneWorkerTool } from "./protocol";

const pathProperty = {
  type: "string",
  description: "Path relative to the selected workspace; use . for the root.",
};
const hashProperty = {
  type: "string",
  description: "SHA-256 returned by workspace_read; required for deletion.",
};
function schema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

/** Host-side tools scoped to an already-authorized workspace and task. */
export function createOneWorkspaceTools(options: {
  workspace: string;
  runtimeId: string;
  taskId: string;
  expiresAt: number;
  permission: "read" | "write";
  /** Called only after an in-scope delete has been requested. */
  confirmDelete?: (path: string) => Promise<boolean>;
}): {
  tools: OneWorkerTool[];
  executeTool: (
    name: string,
    parameters: unknown,
    signal: AbortSignal,
  ) => Promise<string>;
} {
  const writable = options.permission === "write";
  const operations: RemoteWorkspaceOperation[] = writable
    ? [
        "list",
        "read",
        "write",
        ...(options.confirmDelete ? ["delete" as const] : []),
      ]
    : ["list", "read"];
  const grant = createRemoteWorkspaceGrant({
    rootPath: options.workspace,
    runtimeId: options.runtimeId,
    taskId: options.taskId,
    permission: options.permission,
    operations,
    expiresAt: options.expiresAt,
    maxOperationBytes: 256 * 1024,
  });
  const tools: OneWorkerTool[] = [
    {
      name: "workspace_list",
      label: "List workspace",
      description: "List a directory within the selected workspace.",
      parameters: schema({ path: pathProperty }, ["path"]),
    },
    {
      name: "workspace_read",
      label: "Read workspace file",
      description:
        "Read a UTF-8 file and its SHA-256 within the selected workspace.",
      parameters: schema({ path: pathProperty }, ["path"]),
    },
    {
      name: "workspace_search",
      label: "Search workspace",
      description:
        "Search for literal text in files within the selected workspace. Results are bounded.",
      parameters: schema({ path: pathProperty, query: { type: "string" } }, [
        "path",
        "query",
      ]),
    },
  ];
  if (writable)
    tools.push({
      name: "workspace_write",
      label: "Write workspace file",
      description:
        "Create or replace a UTF-8 file. Supply expectedSha256 when replacing a file read earlier.",
      parameters: schema(
        {
          path: pathProperty,
          content: { type: "string" },
          expectedSha256: hashProperty,
        },
        ["path", "content"],
      ),
    });
  if (writable && options.confirmDelete)
    tools.push({
      name: "workspace_delete",
      label: "Delete workspace file",
      description:
        "Delete a file after local confirmation; read it first to obtain its SHA-256.",
      parameters: schema({ path: pathProperty, expectedSha256: hashProperty }, [
        "path",
        "expectedSha256",
      ]),
    });
  async function executeTool(
    name: string,
    parameters: unknown,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) throw new Error("Task was cancelled");
    if (name === "workspace_search") {
      if (
        !parameters ||
        typeof parameters !== "object" ||
        Array.isArray(parameters)
      )
        throw new Error("Workspace search request is invalid");
      const args = parameters as Record<string, unknown>;
      if (
        typeof args.path !== "string" ||
        typeof args.query !== "string" ||
        !args.query.trim() ||
        args.query.length > 256
      )
        throw new Error("Workspace search query is invalid");
      const queue = [{ path: args.path, depth: 0 }];
      const matches: Array<{ path: string; line: number; text: string }> = [];
      let files = 0;
      let searchedFiles = 0;
      let skippedFiles = 0;
      let directories = 0;
      let truncated = false;
      const needle = args.query.toLocaleLowerCase();
      while (
        queue.length &&
        directories < 100 &&
        files < 200 &&
        matches.length < 50
      ) {
        directories++;
        if (signal.aborted) throw new Error("Task was cancelled");
        const current = queue.shift()!;
        const listed = executeRemoteWorkspaceRequest(grant, {
          id: randomUUID(),
          operation: "list",
          path: current.path,
        });
        if (listed.status !== "succeeded") {
          if (current.depth === 0) throw new Error(listed.summary);
          truncated = true;
          continue;
        }
        for (const entry of listed.data?.entries || []) {
          if (entry.type === "directory") {
            if (
              current.depth < 5 &&
              queue.length < 200 &&
              ![".git", "node_modules"].includes(
                entry.path.split("/").pop() || "",
              )
            )
              queue.push({ path: entry.path, depth: current.depth + 1 });
            else truncated = true;
            continue;
          }
          if (++files > 200 || matches.length >= 50) {
            truncated = true;
            break;
          }
          if ((entry.size || 0) > 256 * 1024) {
            skippedFiles++;
            truncated = true;
            continue;
          }
          const read = executeRemoteWorkspaceRequest(grant, {
            id: randomUUID(),
            operation: "read",
            path: entry.path,
          });
          const content = read.data?.content;
          if (
            read.status !== "succeeded" ||
            typeof content !== "string" ||
            content.includes("\0")
          ) {
            skippedFiles++;
            truncated = true;
            continue;
          }
          searchedFiles++;
          content.split(/\r?\n/).forEach((line, index) => {
            if (
              matches.length < 50 &&
              line.toLocaleLowerCase().includes(needle)
            )
              matches.push({
                path: entry.path,
                line: index + 1,
                text: line.slice(0, 300),
              });
          });
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (
        queue.length ||
        directories >= 100 ||
        files >= 200 ||
        matches.length >= 50
      )
        truncated = true;
      return JSON.stringify({
        matches,
        truncated,
        searchedFiles,
        skippedFiles,
      });
    }
    const operation = (
      {
        workspace_list: "list",
        workspace_read: "read",
        workspace_write: "write",
        workspace_delete: "delete",
      } as Record<string, RemoteWorkspaceOperation>
    )[name];
    if (
      !operation ||
      !operations.includes(operation) ||
      !parameters ||
      typeof parameters !== "object" ||
      Array.isArray(parameters)
    )
      throw new Error("Workspace tool request is invalid");
    const args = parameters as Record<string, unknown>;
    if (typeof args.path !== "string")
      throw new Error("Workspace path is required");
    if (operation === "write" && typeof args.content !== "string")
      throw new Error("Workspace content is required");
    if (
      args.expectedSha256 !== undefined &&
      (typeof args.expectedSha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(args.expectedSha256))
    )
      throw new Error("Workspace checksum is invalid");
    if (operation === "delete" && typeof args.expectedSha256 !== "string")
      throw new Error("Read the file and provide its checksum before deletion");
    const request = {
      id: randomUUID(),
      operation,
      path: args.path,
      ...(typeof args.content === "string" ? { content: args.content } : {}),
      ...(typeof args.expectedSha256 === "string"
        ? { expectedSha256: args.expectedSha256 }
        : {}),
    };
    let result = executeRemoteWorkspaceRequest(grant, request, {
      requireExpectedForExisting: true,
    });
    if (result.status === "confirmation_required") {
      const approved = await options.confirmDelete?.(args.path);
      if (!approved || signal.aborted)
        throw new Error("Workspace deletion was not approved");
      result = confirmRemoteWorkspaceDelete(grant, request);
    }
    if (result.status !== "succeeded") throw new Error(result.summary);
    return JSON.stringify(result.data ?? {});
  }
  return { tools, executeTool };
}
