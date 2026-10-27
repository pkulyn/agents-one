import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startProjectInspectionMcp } from "../src/main/mobile-control/project-inspection-mcp";
import type {
  ProjectWriteRunner,
  ProjectWriteCommand,
} from "../src/main/mobile-control/project-write-runner";
const roots: string[] = [],
  servers: Awaited<ReturnType<typeof startProjectInspectionMcp>>[] = [];
async function fixture(
  write: (command: ProjectWriteCommand) => Promise<unknown>,
  authorize: () => void = () => undefined,
): Promise<Awaited<ReturnType<typeof startProjectInspectionMcp>>> {
  const root = mkdtempSync(join(tmpdir(), "agents-one-write-mcp-"));
  roots.push(root);
  writeFileSync(join(root, "file.txt"), "original");
  const writer = {
    projectRoot: () => root,
    write,
  } as unknown as ProjectWriteRunner;
  const server = await startProjectInspectionMcp(root, authorize, writer);
  servers.push(server);
  return server;
}
async function call(
  server: Awaited<ReturnType<typeof startProjectInspectionMcp>>,
  method: string,
  params: unknown = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(server.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${server.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return await response.json();
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith("agents-one-write-mcp-")
    )
      throw Error("unsafe_cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
const args = {
  path: "file.txt",
  text: "replacement",
  expectedSha256: null,
  writeId: "change-one",
};

it("exposes an explicit write tool only with a same-root Main runner and strips private receipt fields", async () => {
  const write = vi.fn(async () => ({
    path: "file.txt",
    previousSha256: null,
    sha256: "a".repeat(64),
    bytes: 11,
    previousText: "private-original",
    root: "D:/private-root",
  }));
  const server = await fixture(write);
  const catalog = await call(server, "tools/list");
  expect(JSON.stringify(catalog)).toContain("write_project_text");
  const result = await call(server, "tools/call", {
    name: "write_project_text",
    arguments: args,
  });
  expect(write).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      key: "change-one",
      path: "file.txt",
      text: "replacement",
      expectedSha256: null,
      signal: expect.any(AbortSignal),
    }),
  );
  expect(JSON.stringify(result)).not.toMatch(/private-original|private-root/);
  await expect(
    startProjectInspectionMcp(roots[0], () => undefined, {
      projectRoot: () => join(roots[0], "foreign"),
    } as unknown as ProjectWriteRunner),
  ).rejects.toThrow("binding unavailable");
});

it("rejects token failure, extended or malformed arguments and revoked catalogs before writing", async () => {
  const write = vi.fn();
  let revoked = false;
  const server = await fixture(write, () => {
    if (revoked) throw Error("private-token-root");
  });
  const response = await fetch(server.url, { method: "POST", body: "{}" });
  expect(response.status).toBe(401);
  for (const argumentsValue of [
    { ...args, root: "foreign" },
    { ...args, writeId: "../escape" },
    { ...args, expectedSha256: "invalid" },
    { ...args, text: null },
    { ...args, writeId: undefined },
  ]) {
    const result = await call(server, "tools/call", {
      name: "write_project_text",
      arguments: argumentsValue,
    });
    expect(result.error).toMatchObject({ code: -32602 });
  }
  revoked = true;
  const result = await call(server, "tools/list");
  expect(JSON.stringify(result)).not.toContain("private-token-root");
  expect(result.error).toMatchObject({ message: "Request unavailable" });
  expect(write).not.toHaveBeenCalled();
});

it("aborts and waits for accepted local writes when closing the task transport and accepts bounded text over read-only transport limits", async () => {
  let entered: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let cancelled = false;
  const server = await fixture(
    (command) =>
      new Promise((_resolve, reject) => {
        expect(command.text.length).toBe(17000);
        entered!();
        command.signal.addEventListener(
          "abort",
          () => {
            cancelled = true;
            reject(Error("private-worker-error"));
          },
          { once: true },
        );
      }),
  );
  const pending = call(server, "tools/call", {
    name: "write_project_text",
    arguments: { ...args, text: "a".repeat(17000) },
  }).catch(() => ({}));
  await ready;
  await server.close();
  await pending;
  expect(cancelled).toBe(true);
  const other = await fixture(async () => ({}));
  const over = await fetch(other.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${other.token}` },
    body: "a".repeat(2 * 1024 * 1024 + 1),
  });
  expect(over.status).toBe(413);
});

it("every concurrent close waits for the same accepted worker completion", async () => {
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const server = await fixture(
    (command) =>
      new Promise((_resolve, reject) => {
        entered();
        finish = () => reject(Error("closed"));
        command.signal.addEventListener("abort", () => undefined, {
          once: true,
        });
      }),
  );
  const request = call(server, "tools/call", {
    name: "write_project_text",
    arguments: args,
  }).catch(() => ({}));
  await ready;
  const first = server.close(),
    second = server.close();
  let completed = false;
  void second.then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(first).toBe(second);
  finish();
  await Promise.all([first, second, request]);
  expect(completed).toBe(true);
});
