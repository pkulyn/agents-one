import * as fs from "node:fs";
import * as path from "node:path";
export interface PiQueryBinding {
  directory: string;
  identity: string;
}
export interface PiQueryContext {
  binding: PiQueryBinding;
  environment: NodeJS.ProcessEnv;
}
function inside(root: string, target: string): boolean {
  const value = path.relative(root, target);
  return (
    value === "" ||
    (value !== ".." &&
      !value.startsWith(".." + path.sep) &&
      !path.isAbsolute(value))
  );
}
async function physicalPath(value: string, check: () => void): Promise<string> {
  let current = path.resolve(value);
  const missing: string[] = [];
  while (true) {
    try {
      check();
      const real = await fs.promises.realpath(current);
      check();
      return path.resolve(real, ...missing);
    } catch (error) {
      const parent = path.dirname(current);
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        parent === current
      )
        throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}
async function sharesRootAncestor(
  directory: string,
  rootIdentity: string,
  check: () => void,
): Promise<boolean> {
  let current = directory;
  while (true) {
    try {
      check();
      const stat = await fs.promises.stat(current, { bigint: true });
      check();
      if (!stat.isDirectory() || stat.ino <= 0n)
        throw Error("Unverifiable directory");
      if (String(stat.dev) + ":" + String(stat.ino) === rootIdentity)
        return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
const unavailable =
  "[Agents One 权限不足] Pi 查询执行目录不安全或无法核验，本轮任务未发送；请更换工作目录或检查 Pi 工具安装。 / Pi query context is unsafe or unverifiable; the task was not sent. Choose another working directory or check the Pi tool installation.";

/** Self-contained: serialized into the trusted native extension. */
export function enterPiQueryContext(
  binding: PiQueryBinding,
  files: Pick<
    typeof fs,
    "statSync" | "realpathSync" | "lstatSync" | "readdirSync"
  >,
  processApi: Pick<typeof process, "chdir">,
): void {
  const denied =
    "[Agents One 权限不足] Pi 查询进程目录无法验证，本轮工具未执行。 / Pi query process context could not be verified; the tool was not executed.";
  try {
    const stat = files.statSync(binding.directory, { bigint: true });
    if (
      !stat.isDirectory() ||
      files.lstatSync(binding.directory).isSymbolicLink() ||
      files.realpathSync(binding.directory) !== binding.directory ||
      String(stat.dev) + ":" + String(stat.ino) !== binding.identity ||
      files.readdirSync(binding.directory).length
    )
      throw Error(denied);
    processApi.chdir(binding.directory);
  } catch {
    throw Error(denied);
  }
}

// @lat: [[runtime-chat#Pi query process context]]
export async function createPiQueryContext(
  privateParent: string,
  taskCwd: string,
  nativeConfigRoot: string,
  source: NodeJS.ProcessEnv,
): Promise<PiQueryContext> {
  let active = true;
  let timer: NodeJS.Timeout | undefined;
  const check = (): void => {
    if (!active) throw Error(unavailable);
  };
  const build = async (): Promise<PiQueryContext> => {
    try {
      const lexicalRoot = path.resolve(taskCwd),
        physicalRoot = await fs.promises.realpath(lexicalRoot);
      check();
      if (
        !(await fs.promises.stat(physicalRoot)).isDirectory() ||
        !path.isAbsolute(privateParent) ||
        !path.isAbsolute(nativeConfigRoot)
      )
        throw Error(unavailable);
      check();
      const rootStat = await fs.promises.stat(physicalRoot, { bigint: true });
      check();
      if (rootStat.ino <= 0n) throw Error(unavailable);
      const rootIdentity = String(rootStat.dev) + ":" + String(rootStat.ino);
      const managedBin = await physicalPath(
        path.join(nativeConfigRoot, "bin"),
        check,
      );
      if (
        inside(lexicalRoot, path.join(nativeConfigRoot, "bin")) ||
        inside(physicalRoot, managedBin) ||
        (await sharesRootAncestor(managedBin, rootIdentity, check))
      )
        throw Error(unavailable);
      const paths =
        Object.entries(source).find(
          ([key]) => key.toUpperCase() === "PATH",
        )?.[1] || "";
      const trusted: string[] = [];
      for (const entry of paths.split(path.delimiter)) {
        check();
        if (!entry || !path.isAbsolute(entry)) continue;
        try {
          const lexical = path.resolve(entry),
            physical = await fs.promises.realpath(lexical);
          check();
          if (
            inside(lexicalRoot, lexical) ||
            inside(physicalRoot, physical) ||
            (await sharesRootAncestor(physical, rootIdentity, check)) ||
            !(await fs.promises.stat(physical)).isDirectory()
          )
            continue;
          if (!trusted.includes(physical)) trusted.push(physical);
        } catch {
          /* Unverifiable entries never grant helper lookup. */
        }
      }
      const environment = Object.fromEntries(
        Object.entries(source).filter(
          ([key]) =>
            !["PATH", "PI_CODING_AGENT_DIR"].includes(key.toUpperCase()),
        ),
      );
      const fileDataKeys = new Set([
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "AWS_CONFIG_FILE",
        "AWS_SHARED_CREDENTIALS_FILE",
      ]);
      for (const [key, value] of Object.entries(environment)) {
        if (
          value &&
          fileDataKeys.has(key.toUpperCase()) &&
          !path.isAbsolute(value)
        )
          environment[key] = path.resolve(lexicalRoot, value);
      }
      for (const [key, value] of Object.entries(environment)) {
        if (value && key.toUpperCase() === "SSL_CERT_DIR")
          environment[key] = value
            .split(path.delimiter)
            .map((entry) =>
              entry && !path.isAbsolute(entry)
                ? path.resolve(lexicalRoot, entry)
                : entry,
            )
            .join(path.delimiter);
      }
      environment.PATH = trusted.join(path.delimiter);
      environment.PI_CODING_AGENT_DIR = nativeConfigRoot;
      // One persistent empty control directory per profile; no per-turn cache or cleanup race.
      check();
      await fs.promises.mkdir(privateParent, { recursive: true });
      check();
      const parent = await fs.promises.realpath(privateParent),
        directory = path.join(parent, "neutral");
      check();
      await fs.promises.mkdir(directory, { recursive: true });
      check();
      const stat = await fs.promises.stat(directory, { bigint: true });
      check();
      const binding = {
        directory,
        identity: String(stat.dev) + ":" + String(stat.ino),
      };
      if (stat.ino <= 0n || !inside(parent, directory))
        throw Error(unavailable);
      const [entry, real, contents] = await Promise.all([
        fs.promises.lstat(directory),
        fs.promises.realpath(directory),
        fs.promises.readdir(directory),
      ]);
      check();
      if (entry.isSymbolicLink() || real !== directory || contents.length)
        throw Error(unavailable);
      return { binding, environment };
    } catch {
      throw Error(unavailable);
    }
  };
  try {
    return await Promise.race([
      build(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          active = false;
          reject(Error(unavailable));
        }, 5_000);
      }),
    ]);
  } finally {
    active = false;
    if (timer) clearTimeout(timer);
  }
}
