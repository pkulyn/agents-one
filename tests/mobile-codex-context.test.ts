import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  prepareCodexMobileContext,
  type CodexMobileContext,
} from "../src/main/mobile-control/codex-mobile-context";
import type {
  ProjectWriteRunner,
  ProjectWriteCommand,
} from "../src/main/mobile-control/project-write-runner";

const mock = vi.hoisted(() => ({ home: "" }));
vi.mock("../src/main/utils", () => {
  const mocked = { profileHome: () => mock.home };
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
const roots: string[] = [],
  contexts: CodexMobileContext[] = [];
function fixture(): {
  home: string;
  workspace: string;
  cache: string;
  environment: NodeJS.ProcessEnv;
} {
  const base = mkdtempSync(join(tmpdir(), "agents-one-mobile-context-"));
  roots.push(base);
  const home = join(base, "profile"),
    auth = join(base, "auth"),
    workspace = join(base, "workspace");
  mkdirSync(home);
  mkdirSync(auth);
  mkdirSync(workspace);
  mock.home = home;
  const cache = join(auth, "models_cache.json");
  writeFileSync(
    cache,
    JSON.stringify({
      models: [
        {
          slug: "gpt-6-sol",
          tool_mode: "code_mode_only",
          shell_type: "unified_exec",
          node_repl_disabled: false,
          multi_agent_version: "v2",
        },
      ],
    }),
  );
  writeFileSync(join(workspace, "readme.md"), "fixture project");
  return {
    home,
    workspace,
    cache,
    environment: {
      CODEX_HOME: auth,
      ORIGINAL_ENV: "preserved",
      AGENTS_ONE_PROJECT_MCP_TOKEN: "parent-token",
    },
  };
}
function catalog(context: CodexMobileContext): string {
  const value = context.args.find((arg) =>
    arg.startsWith("model_catalog_json="),
  );
  return JSON.parse(value!.slice("model_catalog_json=".length)) as string;
}
async function call(
  context: CodexMobileContext,
  method: string,
  params = {},
): Promise<unknown> {
  const definition = context.args.find((arg) =>
    arg.startsWith("mcp_servers.agents_one_project="),
  )!;
  const url = JSON.parse(definition.match(/url=("[^"]+")/)![1]) as string;
  return (
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.environment.AGENTS_ONE_PROJECT_MCP_TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  ).json();
}
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.dispose();
  for (const root of roots.splice(0))
    if (
      dirname(resolve(root)) === resolve(tmpdir()) &&
      basename(root).startsWith("agents-one-mobile-context-")
    )
      rmSync(root, { recursive: true, force: true });
});

describe("Main Codex invocation context", () => {
  // @lat: [[mobile-data#Mobile data#Codex writer requires fixed project authority]]
  it("rejects missing or foreign writer bindings before creating private invocation files", async () => {
    const f = fixture();
    const writer = { projectRoot: () => f.workspace } as ProjectWriteRunner;
    for (const input of [
      { projectWriter: writer },
      { workspace: f.workspace, projectWriter: writer },
      {
        workspace: f.workspace,
        projectGuard: () => undefined,
        projectWriter: { projectRoot: () => f.home } as ProjectWriteRunner,
      },
    ])
      await expect(
        prepareCodexMobileContext({
          model: "gpt-6-sol",
          environment: f.environment,
          ...input,
        }),
      ).rejects.toThrow("context is unavailable");
    expect(existsSync(join(f.home, "desktop"))).toBe(false);
  });

  // @lat: [[mobile-data#Mobile data#Codex context rejects changed catalogs before write admission]]
  it("exposes explicit writer tools and denies HTTP admission after catalog replacement", async () => {
    const f = fixture();
    const write = vi.fn(async () => ({
      path: "file.txt",
      previousSha256: null,
      sha256: "a".repeat(64),
      bytes: 4,
    }));
    const context = await prepareCodexMobileContext({
      model: "gpt-6-sol",
      environment: f.environment,
      workspace: f.workspace,
      projectGuard: () => undefined,
      projectWriter: {
        projectRoot: () => f.workspace,
        write,
      } as unknown as ProjectWriteRunner,
    });
    contexts.push(context);
    expect(
      context.args.find((arg) => arg.startsWith("mcp_servers.")),
    ).toContain('"write_project_text"');
    expect(
      context.args.find((arg) => arg.startsWith("mcp_servers.")),
    ).toContain('tools={write_project_text={approval_mode="approve"}}');
    expect(JSON.stringify(await call(context, "tools/list"))).toContain(
      "write_project_text",
    );
    const params = {
      name: "write_project_text",
      arguments: {
        path: "file.txt",
        text: "text",
        expectedSha256: null,
        writeId: "actual-context-one",
      },
    };
    expect(
      JSON.stringify(await call(context, "tools/call", params)),
    ).not.toContain('"isError":true');
    expect(write).toHaveBeenCalledOnce();
    writeFileSync(f.cache, "changed-model-catalog");
    expect(
      JSON.stringify(await call(context, "tools/call", params)),
    ).not.toContain('"sha256"');
    expect(write).toHaveBeenCalledOnce();
    writeFileSync(catalog(context), "unknown-private-bytes");
    await context.dispose();
    expect(readFileSync(catalog(context), "utf8")).toBe(
      "unknown-private-bytes",
    );
  });

  // @lat: [[mobile-data#Mobile data#Concurrent Codex disposal waits for write shutdown]]
  it("shares disposal completion until an aborted in-flight writer actually finishes", async () => {
    const f = fixture();
    let entered!: () => void, finish!: () => void, signal!: AbortSignal;
    let nested: Promise<void> | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const write = async (command: ProjectWriteCommand): Promise<never> => {
      signal = command.signal;
      signal.addEventListener(
        "abort",
        () => {
          nested = context.dispose();
        },
        { once: true },
      );
      entered();
      await finished;
      throw Error("worker closed");
    };
    const context = await prepareCodexMobileContext({
      model: "gpt-6-sol",
      environment: f.environment,
      workspace: f.workspace,
      projectGuard: () => undefined,
      projectWriter: {
        projectRoot: () => f.workspace,
        write,
      } as unknown as ProjectWriteRunner,
    });
    contexts.push(context);
    const request = call(context, "tools/call", {
      name: "write_project_text",
      arguments: {
        path: "file.txt",
        text: "text",
        expectedSha256: null,
        writeId: "pending-context",
      },
    }).catch(() => undefined);
    await started;
    const first = context.dispose(),
      second = context.dispose();
    expect(second).toBe(first);
    expect(nested).toBe(first);
    expect(signal.aborted).toBe(true);
    expect(() => context.assertCurrent()).toThrow("context is unavailable");
    let disposed = false;
    void second.then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(existsSync(catalog(context))).toBe(true);
    finish();
    await Promise.all([first, second, request]);
    expect(disposed).toBe(true);
    expect(existsSync(catalog(context))).toBe(false);
  });
  // @lat: [[mobile-data#Mobile data#Codex invocation directory cannot redirect private writes]]
  it("rejects private directory junctions and withholds deletion after directory replacement", async () => {
    const f = fixture();
    symlinkSync(f.workspace, join(f.home, "desktop"), "junction");
    await expect(
      prepareCodexMobileContext({
        model: "gpt-6-sol",
        environment: f.environment,
      }),
    ).rejects.toThrow("context is unavailable");
    expect(readdirSync(f.workspace)).toEqual(["readme.md"]);
    rmSync(join(f.home, "desktop"));
    const context = await prepareCodexMobileContext({
      model: "gpt-6-sol",
      environment: f.environment,
    });
    contexts.push(context);
    const file = catalog(context),
      directory = dirname(file);
    const contents = readFileSync(file);
    renameSync(directory, `${directory}-old`);
    mkdirSync(directory);
    writeFileSync(file, contents);
    expect(() => context.assertCurrent()).toThrow("context is unavailable");
    await context.dispose();
    expect(readFileSync(file)).toEqual(contents);
  });
  // @lat: [[mobile-data#Mobile data#Codex private invocation catalog lifecycle]]
  it("removes model-selected agents, keeps no-project host disabled and disposes only its own catalog", async () => {
    const f = fixture();
    const context = await prepareCodexMobileContext({
      model: "gpt-6-sol",
      environment: f.environment,
    });
    contexts.push(context);
    expect(context.args[context.args.indexOf("code_mode_host") - 1]).toBe(
      "--disable",
    );
    expect(context.environment.ORIGINAL_ENV).toBe("preserved");
    expect(context.environment.AGENTS_ONE_PROJECT_MCP_TOKEN).toBeUndefined();
    expect(f.environment.AGENTS_ONE_PROJECT_MCP_TOKEN).toBe("parent-token");
    const file = catalog(context);
    expect(
      JSON.parse(readFileSync(file, "utf8")).models[0].multi_agent_version,
    ).toBeNull();
    context.assertCurrent();
    await context.dispose();
    await context.dispose();
    expect(existsSync(file)).toBe(false);
    expect(() => context.assertCurrent()).toThrow("context is unavailable");
  });

  // @lat: [[mobile-data#Mobile data#Codex project tool authority remains live]]
  it("requires Main project authority and rechecks revocation on actual MCP requests", async () => {
    const f = fixture();
    let revoked = false;
    const guard = vi.fn(() => {
      if (revoked) throw Error("private-policy-error");
    });
    const context = await prepareCodexMobileContext({
      model: "gpt-6-sol",
      environment: f.environment,
      workspace: f.workspace,
      projectGuard: guard,
    });
    contexts.push(context);
    expect(context.args[context.args.indexOf("code_mode_host") - 1]).toBe(
      "--enable",
    );
    expect(context.args).toContain("--skip-git-repo-check");
    const definition = context.args.find((arg) =>
      arg.startsWith("mcp_servers.agents_one_project="),
    )!;
    expect(definition).not.toContain("write_project_text");
    expect(definition).not.toContain("approval_mode");
    expect(JSON.stringify(await call(context, "tools/list"))).not.toContain(
      "write_project_text",
    );
    const url = JSON.parse(definition.match(/url=("[^"]+")/)![1]) as string;
    const token = context.environment.AGENTS_ONE_PROJECT_MCP_TOKEN!;
    expect(definition).not.toContain(token);
    expect(token).not.toBe("parent-token");
    const request = async (): Promise<string> =>
      (
        await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "read_project_text",
              arguments: { path: "readme.md" },
            },
          }),
        })
      ).text();
    expect(await request()).toContain("fixture project");
    revoked = true;
    expect(await request()).not.toContain("fixture project");
    expect(() => context.assertCurrent()).toThrow("context is unavailable");
    expect(guard.mock.calls.length).toBeGreaterThan(3);
  });

  // @lat: [[mobile-data#Mobile data#Codex catalog replacement invalidates dispatch]]
  it("rejects source or private catalog changes and preserves unknown replacement bytes", async () => {
    const f = fixture();
    const context = await prepareCodexMobileContext({
      model: "gpt-6-sol",
      environment: f.environment,
    });
    contexts.push(context);
    writeFileSync(f.cache, "changed source");
    expect(() => context.assertCurrent()).toThrow("context is unavailable");
    writeFileSync(catalog(context), "replacement-private-data");
    expect(() => context.assertCurrent()).toThrow("context is unavailable");
    await context.dispose();
    expect(readFileSync(catalog(context), "utf8")).toBe(
      "replacement-private-data",
    );
  });

  // @lat: [[mobile-data#Mobile data#Codex missing project authority prevents preparation]]
  it("rejects a missing guard or unsupported model before opening a transport or creating catalog files", async () => {
    const f = fixture();
    await expect(
      prepareCodexMobileContext({
        model: "gpt-6-sol",
        environment: f.environment,
        workspace: f.workspace,
      }),
    ).rejects.toThrow("context is unavailable");
    await expect(
      prepareCodexMobileContext({
        model: "unknown-model",
        environment: f.environment,
      }),
    ).rejects.toThrow("context is unavailable");
    await expect(
      prepareCodexMobileContext({
        model: "gpt-6-sol",
        environment: f.environment,
        workspace: f.workspace,
        projectGuard: async () => undefined,
      }),
    ).rejects.toThrow("context is unavailable");
    expect(existsSync(join(f.home, "desktop"))).toBe(false);
  });

  // @lat: [[mobile-data#Mobile data#Codex failed project context closes prepared resources]]
  it("cleans its catalog when authority is revoked during context preparation", async () => {
    const f = fixture();
    let checks = 0;
    await expect(
      prepareCodexMobileContext({
        model: "gpt-6-sol",
        environment: f.environment,
        workspace: f.workspace,
        projectGuard: () => {
          if (++checks > 1) throw Error("revoked");
        },
      }),
    ).rejects.toThrow("context is unavailable");
    expect(
      readdirSync(join(f.home, "desktop", "mobile-codex-invocations")),
    ).toEqual([]);
  });
});
