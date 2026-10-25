import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  calls: [] as Array<{
    args: string[];
    options: { env: NodeJS.ProcessEnv; cwd: string };
  }>,
  frames: [] as Record<string, unknown>[],
  verify: vi.fn(),
}));
vi.mock("../src/main/pi-capabilities", () => ({
  verifyPiStrictCapabilities: fixture.verify,
}));
vi.mock("../src/main/process-control", () => ({
  terminateProcessTree: async (): Promise<void> => {},
}));
vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  spawn: (
    _command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; cwd: string },
  ) => {
    fixture.calls.push({ args, options });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: {
        end: (): void => {},
        write: (text: string): void => {
          const frame = JSON.parse(text);
          fixture.frames.push(frame);
          queueMicrotask(() =>
            child.stdout.emit(
              "data",
              Buffer.from(
                JSON.stringify({
                  type: "response",
                  id: frame.id,
                  success: true,
                  data: { fixture: true },
                }) + String.fromCharCode(10),
              ),
            ),
          );
        },
      },
    });
    return child;
  },
}));
import {
  executePiRpcCommand,
  executePiRpcPrompt,
} from "../src/main/pi-runtime";
const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-rpc-startup-"));
const native = path.join(directory, "native");
fs.mkdirSync(native);
beforeEach(() => {
  fixture.calls.length = 0;
  fixture.frames.length = 0;
  fixture.verify.mockReset().mockImplementation(async (invocation) => ({
    invocation,
    assertUnchanged: (): void => {},
  }));
  vi.stubEnv("HERMES_HOME", path.join(directory, "hermes"));
  vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", path.join(directory, "desktop"));
  vi.stubEnv("PI_CODING_AGENT_DIR", native);
  vi.stubEnv("NODE_OPTIONS", "--require=fixture-never-evaluate");
  fs.writeFileSync(path.join(native, "models.json"), "{}");
  fs.writeFileSync(path.join(native, "auth.json"), "{}");
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-rpc-startup-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
it("boots metadata without executable resources or inherited loader controls", async () => {
  const response = await executePiRpcCommand(
    { executablePath: process.execPath },
    { type: "get_commands" },
  );
  expect(response.data).toEqual({ fixture: true });
  expect(fixture.calls[0].args).toEqual(
    expect.arrayContaining([
      "--no-extensions",
      "--no-mcp",
      "--no-tools",
      "--exclude-tools",
      "*",
    ]),
  );
  expect(fixture.calls[0].options.env.NODE_OPTIONS).toBeUndefined();
  expect(process.env.NODE_OPTIONS).toBe("--require=fixture-never-evaluate");
  expect(fixture.verify).toHaveBeenCalledOnce();
});
it("keeps the command envelope immutable against generic parameter overrides", async () => {
  await executePiRpcCommand(
    { executablePath: process.execPath },
    {
      type: "get_state",
      params: { type: "prompt", id: "forged", message: "private prompt" },
    },
  );
  expect(fixture.frames[0].type).toBe("get_state");
  expect(fixture.frames[0].id).not.toBe("forged");
});
it("rejects methods outside the reviewed metadata/control contract", async () => {
  await expect(
    executePiRpcCommand(
      { executablePath: process.execPath },
      { type: "prompt" as "get_state" },
    ),
  ).rejects.toThrow("RPC");
  expect(fixture.calls).toHaveLength(0);
});
it("refuses native command credentials before metadata startup", async () => {
  fs.writeFileSync(
    path.join(native, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "!fixture-must-not-run" },
    }),
  );
  await expect(
    executePiRpcCommand(
      { executablePath: process.execPath },
      { type: "get_state" },
    ),
  ).rejects.toThrow("本轮任务未发送");
  expect(fixture.calls).toHaveLength(0);
});
it("refuses unsupported native versions before metadata dispatch", async () => {
  fixture.verify.mockRejectedValueOnce(Error("unsupported-fixture-version"));
  await expect(
    executePiRpcCommand(
      { executablePath: process.execPath },
      { type: "get_state" },
    ),
  ).rejects.toThrow("unsupported-fixture-version");
  expect(fixture.calls).toHaveLength(0);
});
it("refuses opaque native prompts without Main authority", async () => {
  await expect(
    executePiRpcPrompt(
      { executablePath: process.execPath },
      { sessionId: "fixture", message: "/fixture" },
    ),
  ).rejects.toThrow("完全访问");
  expect(fixture.calls).toHaveLength(0);
});

it("retains explicitly authorized native resources in their Main-selected project", async () => {
  const assertCurrent = vi.fn();
  const nativeContext = { profile: "default", cwd: directory, assertCurrent };
  await executePiRpcCommand(
    { executablePath: process.execPath },
    { type: "get_commands", profile: "default", nativeContext },
  );
  expect(assertCurrent).toHaveBeenCalledTimes(2);
  expect(fixture.verify).not.toHaveBeenCalled();
  expect(fixture.calls[0].args).not.toContain("--no-extensions");
  expect(fixture.calls[0].options.env.NODE_OPTIONS).toBe(
    process.env.NODE_OPTIONS,
  );
  expect(fixture.calls[0].options.cwd).toBe(directory);
});
it("rechecks native authority immediately before spawning", async () => {
  const assertCurrent = vi
    .fn()
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw Error("revoked-fixture");
    });
  await expect(
    executePiRpcPrompt(
      { executablePath: process.execPath },
      {
        sessionId: "fixture",
        message: "/fixture",
        nativeContext: { profile: "default", cwd: directory, assertCurrent },
      },
    ),
  ).rejects.toThrow("revoked-fixture");
  expect(fixture.calls).toHaveLength(0);
});
it("retains an authorized native slash command and its original session", async () => {
  await expect(
    executePiRpcPrompt(
      { executablePath: process.execPath },
      {
        sessionId: "fixture-session",
        message: "/fixture",
        waitForAgentSettled: false,
        nativeContext: {
          profile: "default",
          cwd: directory,
          assertCurrent: (): void => {},
        },
      },
    ),
  ).resolves.toEqual({});
  expect(fixture.calls[0].args).toEqual(
    expect.arrayContaining(["--session-id", "fixture-session"]),
  );
  expect(fixture.frames[0].type).toBe("prompt");
});

it("captures the selected profile before asynchronous capability checks", async () => {
  const data = path.join(directory, "desktop", "data");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "active_profile"), "named");
  try {
    await executePiRpcCommand(
      { executablePath: process.execPath },
      { type: "get_state" },
    );
    expect(fixture.calls[0].options.cwd).toContain(
      path.join("profiles", "named"),
    );
    expect(fixture.calls[0].args).toContain(
      path.join(data, "profiles", "named", "desktop", "pi-sessions"),
    );
  } finally {
    fs.rmSync(path.join(data, "active_profile"), { force: true });
  }
});
it("refuses a profile switch during asynchronous native capability checks", async () => {
  const data = path.join(directory, "desktop", "data");
  fs.mkdirSync(data, { recursive: true });
  fixture.verify.mockImplementationOnce(async (invocation) => {
    fs.writeFileSync(path.join(data, "active_profile"), "other");
    return { invocation, assertUnchanged: (): void => {} };
  });
  try {
    await expect(
      executePiRpcCommand(
        { executablePath: process.execPath },
        { type: "get_state" },
      ),
    ).rejects.toThrow("profile changed");
    expect(fixture.calls).toHaveLength(0);
  } finally {
    fs.rmSync(path.join(data, "active_profile"), { force: true });
  }
});
