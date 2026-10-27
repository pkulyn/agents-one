vi.mock("../src/main/pi-capabilities", () => ({
  verifyPiStrictCapabilities: async (invocation: {
    command: string;
    prefix: string[];
  }) => ({ invocation, assertUnchanged: (): void => {} }),
}));
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  args: [] as string[],
  cwd: "",
  nativeHome: "",
}));
vi.mock("../src/main/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/utils")>()),
  profileHome: () => fixture.nativeHome,
}));
vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>();
  return {
    ...original,
    spawn: (_command: string, args: string[], options: object) => {
      fixture.args = args;
      fixture.cwd = (options as { cwd: string }).cwd;
      return original.spawn(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify({type:'agent_end',messages:[]}))",
        ],
        options,
      );
    },
  };
});
import { startPiProcess } from "../src/main/pi-runtime";

let container: string;
let desktop: string;
let piConfig: string;
let project: string;
beforeAll(() => {
  container = fs.mkdtempSync(path.join(tmpdir(), "pi-private-roots-"));
  desktop = path.join(container, "desktop");
  fixture.nativeHome = path.join(container, "native");
  piConfig = path.join(container, "pi-config");
  project = path.join(container, "project");
  for (const dir of [
    desktop,
    fixture.nativeHome,
    piConfig,
    project,
    path.join(desktop, "data/profiles/other"),
    path.join(fixture.nativeHome, "profiles/other"),
  ])
    fs.mkdirSync(dir, { recursive: true });
  vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", desktop);
  vi.stubEnv("PI_CODING_AGENT_DIR", piConfig);
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (
    !path.resolve(container).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(container).startsWith("pi-private-roots-")
  )
    throw Error("Unsafe fixture cleanup");
  fs.rmSync(container, { recursive: true, force: true });
});
async function guard(
  workspace?: string,
  mode: "safe_write" | "full_access" = "safe_write",
): Promise<((target: string) => unknown) | undefined> {
  const started = await startPiProcess(
    { executablePath: process.execPath },
    { prompt: "fixture", mode, ...(workspace ? { workspace } : {}) },
    () => {},
  );
  await started.completion;
  if (mode === "full_access") return undefined;
  const index = fixture.args.indexOf("--extension");
  expect(index).toBeGreaterThanOrEqual(0);
  const source = fs.readFileSync(fixture.args[index + 1], "utf8");
  let check!: (event: unknown, ctx: { cwd: string }) => unknown;
  const install = new Function(
    "fs",
    "path",
    "process",
    source
      .replace(/^import .*;\r?$/gm, "")
      .replace(
        "export default function agentsOneReadOnly",
        "return function agentsOneReadOnly",
      ),
  )(fs, path, { chdir: (): void => {} });
  install({
    on: (_event: string, handler: typeof check) => {
      check = handler;
    },
  });
  return (target: string) =>
    check({ toolName: "write", input: { path: target } }, { cwd: fixture.cwd });
}

// @lat: [[runtime-chat#Pi automatic write scope]]
it.each([
  "desktop",
  "data",
  "desktop-profile",
  "native",
  "native-profile",
  "pi",
  "parent",
  "alias",
])(
  "refuses explicit automatic workspace overlapping %s private authority",
  async (kind) => {
    let workspace = (
      {
        desktop,
        data: path.join(desktop, "data"),
        "desktop-profile": path.join(desktop, "data/profiles/other"),
        native: fixture.nativeHome,
        "native-profile": path.join(fixture.nativeHome, "profiles/other"),
        pi: piConfig,
        parent: container,
      } as Record<string, string>
    )[kind];
    if (kind === "alias") {
      workspace = path.join(container, "alias");
      fs.symlinkSync(desktop, workspace, "junction");
    }
    if (kind === "pi" || kind === "parent") {
      await expect(guard(workspace)).rejects.toThrow("本轮任务未发送");
      return;
    }
    const check = (await guard(workspace))!;
    expect(check("ordinary.txt")).toMatchObject({ block: true });
  },
);
it.each(["file-url", "relative", "shell-drive"])(
  "protects Pi config configured with %s spelling",
  async (kind) => {
    const configured =
      kind === "file-url"
        ? pathToFileURL(piConfig).href
        : kind === "relative"
          ? path.relative(piConfig, piConfig) || "."
          : process.platform === "win32"
            ? "/" +
              piConfig[0].toLowerCase() +
              piConfig.slice(2).replaceAll("\\", "/")
            : piConfig;
    vi.stubEnv("PI_CODING_AGENT_DIR", configured);
    try {
      await expect(guard(piConfig)).rejects.toThrow("本轮任务未发送");
    } finally {
      vi.stubEnv("PI_CODING_AGENT_DIR", piConfig);
    }
  },
);
it("retains ordinary unrelated project writes", async () => {
  expect((await guard(project))!("draft.txt")).toBeUndefined();
});
it("retains only implicit projectless fallback writes", async () => {
  const check = (await guard())!;
  expect(check("draft.txt")).toBeUndefined();
  expect(check(path.join(desktop, "preferences.json"))).toMatchObject({
    block: true,
  });
  const fallback = fixture.cwd;
  expect((await guard(fallback))!("draft.txt")).toMatchObject({ block: true });
});
it("retains explicit full access without the restricted extension", async () => {
  await guard(desktop, "full_access");
  expect(fixture.args).not.toContain("--extension");
});

it("protects a not-yet-created Pi config directory beneath a junction alias", async () => {
  const alias = path.join(container, "project-alias");
  fs.symlinkSync(project, alias, "junction");
  vi.stubEnv("PI_CODING_AGENT_DIR", path.join(alias, "future-config"));
  try {
    await expect(guard(project)).rejects.toThrow("本轮任务未发送");
  } finally {
    vi.stubEnv("PI_CODING_AGENT_DIR", piConfig);
  }
});
it("fails closed for a malformed native file URL without changing the target", async () => {
  vi.stubEnv("PI_CODING_AGENT_DIR", "file://%invalid");
  try {
    await expect(guard(project)).rejects.toThrow("本轮任务未发送");
  } finally {
    vi.stubEnv("PI_CODING_AGENT_DIR", piConfig);
  }
});

it("protects Hermes roots configured relative to the Main process", async () => {
  const absolute = fixture.nativeHome;
  fixture.nativeHome = path.relative(process.cwd(), absolute);
  try {
    expect((await guard(absolute))!("draft.txt")).toMatchObject({
      block: true,
    });
  } finally {
    fixture.nativeHome = absolute;
  }
});

it("does not grant an implicit fallback authority over a relative native config subtree", async () => {
  vi.stubEnv("PI_CODING_AGENT_DIR", "nested-native-config");
  try {
    await expect(guard()).rejects.toThrow("本轮任务未发送");
  } finally {
    vi.stubEnv("PI_CODING_AGENT_DIR", piConfig);
  }
});
