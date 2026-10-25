import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createPiQueryContext,
  enterPiQueryContext,
} from "../src/main/pi-query-context";
let container: string,
  project: string,
  parent: string,
  agent: string,
  trusted: string;
beforeEach(async () => {
  container = fs.mkdtempSync(path.join(tmpdir(), "pi-query-context-"));
  project = path.join(container, "project");
  parent = path.join(container, "control");
  agent = path.join(container, "agent");
  trusted = path.join(container, "tools");
  for (const directory of [project, agent, trusted]) fs.mkdirSync(directory);
});
afterEach(async () => {
  if (
    !path.resolve(container).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(container).startsWith("pi-query-context-")
  )
    throw Error("Unsafe fixture cleanup");
  fs.rmSync(container, { recursive: true, force: true });
});
async function context(
  source: NodeJS.ProcessEnv = {},
): Promise<Awaited<ReturnType<typeof createPiQueryContext>>> {
  return createPiQueryContext(parent, project, agent, source);
}
// @lat: [[runtime-chat#Pi query process context]]
it("retains only existing absolute helper directories outside the selected project", async () => {
  const nested = path.join(project, "bin");
  fs.mkdirSync(nested);
  const file = path.join(container, "not-directory");
  fs.writeFileSync(file, "fixture");
  const source = {
    Path: [
      trusted,
      project,
      nested,
      ".",
      "relative",
      "",
      file,
      path.join(container, "missing"),
      trusted,
    ].join(path.delimiter),
    TOKEN: "synthetic-key",
    HTTPS_PROXY: "fixture-proxy",
    Pi_Coding_Agent_Dir: "relative-native",
  };
  const before = { ...source },
    result = await context(source);
  expect(result.environment).toEqual({
    PATH: fs.realpathSync(trusted),
    PI_CODING_AGENT_DIR: agent,
    TOKEN: "synthetic-key",
    HTTPS_PROXY: "fixture-proxy",
  });
  expect(source).toEqual(before);
});
it("rejects a PATH alias into the project but canonicalizes an outside alias", async () => {
  const unsafe = path.join(container, "unsafe-alias"),
    safe = path.join(container, "safe-alias");
  fs.symlinkSync(project, unsafe, "junction");
  fs.symlinkSync(trusted, safe, "junction");
  expect(
    (await context({ PATH: [unsafe, safe].join(path.delimiter) })).environment
      .PATH,
  ).toBe(fs.realpathSync(trusted));
});
it("reuses a verified empty control directory without changing Main cwd", async () => {
  const cwd = process.cwd(),
    first = await context(),
    second = await context();
  expect(first.binding).toEqual(second.binding);
  expect(fs.readdirSync(first.binding.directory)).toEqual([]);
  expect(process.cwd()).toBe(cwd);
  expect(first.binding.directory).not.toBe(project);
});
it("keeps a literal empty PATH instead of inheriting the default search path", async () => {
  expect((await context({ PATH: "relative" })).environment.PATH).toBe("");
});
it("does not clean or trust unknown files in the control directory", async () => {
  const state = await context();
  const file = path.join(state.binding.directory, "rg.exe");
  fs.writeFileSync(file, "original");
  await expect(context()).rejects.toThrow("本轮任务未发送");
  expect(fs.readFileSync(file, "utf8")).toBe("original");
});
it("rechecks neutral identity and content before changing a native process cwd", async () => {
  const state = await context(),
    chdir = vi.fn();
  enterPiQueryContext(state.binding, fs, { chdir });
  expect(chdir).toHaveBeenCalledWith(state.binding.directory);
  fs.writeFileSync(
    path.join(state.binding.directory, "untrusted.exe"),
    "fixture",
  );
  chdir.mockClear();
  expect(() => enterPiQueryContext(state.binding, fs, { chdir })).toThrow(
    "工具未执行",
  );
  expect(chdir).not.toHaveBeenCalled();
});
it.each(["replacement", "junction"])(
  "refuses a %s control directory after binding",
  async (kind) => {
    const state = await context(),
      chdir = vi.fn();
    fs.renameSync(
      state.binding.directory,
      state.binding.directory + "-original",
    );
    if (kind === "replacement") fs.mkdirSync(state.binding.directory);
    else fs.symlinkSync(trusted, state.binding.directory, "junction");
    expect(() => enterPiQueryContext(state.binding, fs, { chdir })).toThrow();
    expect(chdir).not.toHaveBeenCalled();
  },
);
it("does not use a managed native query-bin namespace inside the selected project", async () => {
  await expect(
    createPiQueryContext(parent, project, path.join(project, "native"), {}),
  ).rejects.toThrow("本轮任务未发送");
});
it("detects a managed native config alias back into the project even when bin is absent", async () => {
  const alias = path.join(container, "native-alias");
  fs.symlinkSync(project, alias, "junction");
  await expect(
    createPiQueryContext(parent, project, path.join(alias, "native"), {}),
  ).rejects.toThrow("本轮任务未发送");
});

it("keeps relative certificate and credential data paths bound to the selected task directory", async () => {
  const source = {
    NODE_EXTRA_CA_CERTS: "certs/ca.pem",
    GOOGLE_APPLICATION_CREDENTIALS: "credentials/google.json",
    AWS_CONFIG_FILE: "credentials/aws",
    OPENAI_API_KEY: "synthetic",
  };
  const result = await context(source);
  expect(result.environment.NODE_EXTRA_CA_CERTS).toBe(
    path.join(project, "certs/ca.pem"),
  );
  expect(result.environment.GOOGLE_APPLICATION_CREDENTIALS).toBe(
    path.join(project, "credentials/google.json"),
  );
  expect(result.environment.AWS_CONFIG_FILE).toBe(
    path.join(project, "credentials/aws"),
  );
  expect(result.environment.OPENAI_API_KEY).toBe("synthetic");
  expect(source.NODE_EXTRA_CA_CERTS).toBe("certs/ca.pem");
});
