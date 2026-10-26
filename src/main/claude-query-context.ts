import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
const unavailable =
  "[Agents One 权限不足] 无法可靠核验 Claude 查询程序的搜索路径，本轮任务未发送。请检查项目与执行器环境。 / Claude helper lookup could not be safely verified; the task was not sent. Check the project and executor environment.";
const cancelled = "Claude Code task was cancelled before process launch.";
function within(root: string, directory: string): boolean {
  const path = relative(root, directory);
  return (
    path === "" ||
    (path !== ".." &&
      !path.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) &&
      !isAbsolute(path))
  );
}
// @lat: [[runtime-chat#Claude canonical helper lookup]]
export async function prepareClaudeQueryEnvironment(
  environment: NodeJS.ProcessEnv,
  cwd: string,
  canStart: () => boolean = () => true,
): Promise<NodeJS.ProcessEnv> {
  let expired = false,
    stopped = false;
  const check = (): void => {
    if (!canStart()) {
      stopped = true;
      throw Error(cancelled);
    }
    if (expired) throw Error(unavailable);
  };
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(Error(unavailable));
    }, 5000);
  });
  const inspect = async (): Promise<NodeJS.ProcessEnv> => {
    check();
    if (!isAbsolute(cwd)) throw Error(unavailable);
    const logicalRoot = resolve(cwd),
      root = await realpath(logicalRoot);
    check();
    if (!(await stat(root)).isDirectory()) throw Error(unavailable);
    check();
    const sources = Object.entries(environment)
      .filter(([key]) => key.toUpperCase() === "PATH")
      .map(([, value]) => value)
      .filter((value): value is string => value !== undefined);
    if (new Set(sources).size !== 1) throw Error(unavailable);
    const directories: string[] = [],
      seen = new Set<string>();
    for (const item of sources[0].split(delimiter)) {
      check();
      const entry = item.trim().replace(/^"(.*)"$/, "$1");
      if (!entry || !isAbsolute(entry) || within(logicalRoot, resolve(entry)))
        continue;
      try {
        const directory = await realpath(entry);
        check();
        if (within(root, directory) || !(await stat(directory)).isDirectory())
          continue;
        check();
        const key =
          process.platform === "win32" ? directory.toLowerCase() : directory;
        if (!seen.has(key)) {
          seen.add(key);
          directories.push(directory);
        }
      } catch {
        check(); /* Unverifiable entries cannot participate in helper lookup. */
      }
    }
    check();
    if (!directories.length) throw Error(unavailable);
    return {
      ...Object.fromEntries(
        Object.entries(environment).filter(
          ([key]) => key.toUpperCase() !== "PATH",
        ),
      ),
      PATH: directories.join(delimiter),
    };
  };
  try {
    return await Promise.race([inspect(), deadline]);
  } catch {
    throw Error(stopped ? cancelled : unavailable);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
