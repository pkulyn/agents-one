import type * as Fs from "node:fs";
import type * as Path from "node:path";
type FileChecks = Pick<typeof Fs, "statSync" | "lstatSync" | "realpathSync">;
type PathChecks = Pick<
  typeof Path,
  "resolve" | "relative" | "isAbsolute" | "dirname" | "sep"
>;

/** Self-contained: serialized into the Main-owned native Pi extension. */
export function createPiWriteBoundary(
  root: unknown,
  fs: FileChecks,
  path: PathChecks,
  protectedPaths: string[] = [],
): (value: unknown, actualCwd: unknown) => string | undefined {
  const denied =
    "[Agents One 权限不足] 自动写入仅限本轮工作目录中的普通文件；越界、链接、歧义路径或运行配置修改未执行，请使用明确路径，必要时切换为完全访问。 / Automatic writes require an ordinary file inside the current task directory; outside, linked, ambiguous or control paths require full access.";
  const unavailable =
    "[Agents One 权限不足] 自动写入目录无法验证，或与当前执行器安装目录重叠；请选择其他工作目录，必要时切换为完全访问。 / Automatic write scope is unverifiable or overlaps the running CLI; choose another directory or full access.";
  const protectedNames = new Set([
    ".git",
    ".agents-one",
    ".pi",
    ".codex",
    ".claude",
    ".opencode",
    ".vscode",
    ".idea",
  ]);
  const same = (a: string, b: string): boolean => path.relative(a, b) === "";
  const inside = (base: string, target: string): boolean => {
    const relative = path.relative(base, target);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(".." + path.sep) &&
        !path.isAbsolute(relative))
    );
  };
  const blocked = protectedPaths
    .filter((value) => typeof value === "string" && path.isAbsolute(value))
    .map((value) => {
      const lexical = path.resolve(value);
      try {
        return { lexical, physical: fs.realpathSync(lexical) };
      } catch {
        return { lexical, physical: lexical };
      }
    });
  const binding = (() => {
    try {
      if (typeof root !== "string" || !root || !path.isAbsolute(root))
        return null;
      const lexical = path.resolve(root);
      const physical = fs.realpathSync(lexical);
      const stat = fs.statSync(lexical, { bigint: true });
      if (
        !stat.isDirectory() ||
        stat.ino <= 0n ||
        protectedNames.has(lexical.split(/[\\/]/).at(-1)!.toLowerCase()) ||
        protectedNames.has(physical.split(/[\\/]/).at(-1)!.toLowerCase())
      )
        return null;
      if (
        blocked.some(
          (value) =>
            inside(lexical, value.lexical) ||
            inside(value.lexical, lexical) ||
            inside(physical, value.physical) ||
            inside(value.physical, physical),
        )
      )
        return null;
      return {
        lexical,
        physical,
        identity: String(stat.dev) + ":" + String(stat.ino),
      };
    } catch {
      return null;
    }
  })();
  return (value, actualCwd) => {
    if (!binding) return unavailable;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 4096 ||
      [...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/.test(value)
    )
      return denied;
    // Pi expands these spellings differently from plain path.resolve().
    if (/^(?:~|@|file:)/i.test(value)) return denied;
    const components = value.split(/[\\/]/);
    if (components.some((part) => protectedNames.has(part.toLowerCase())))
      return denied;
    if (path.sep === "\\") {
      if (
        /^\/(?:mnt\/|cygdrive\/)?[a-z](?:\/|$)/i.test(value) ||
        /^[a-z]:(?![\\/])/i.test(value) ||
        /^(?:\\\\|\/\/)[?.][\\/]/.test(value)
      )
        return denied;
      const withoutDrive = value.replace(/^[a-z]:[\\/]/i, "");
      if (/[<>:"|?*]/.test(withoutDrive)) return denied;
      if (
        components.some(
          (part) =>
            part !== "." &&
            part !== ".." &&
            (/[. ]$/.test(part) ||
              /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(
                part,
              )),
        )
      )
        return denied;
    }
    try {
      if (
        typeof actualCwd !== "string" ||
        !same(binding.lexical, path.resolve(actualCwd))
      )
        return denied;
      const current = fs.statSync(binding.lexical, { bigint: true });
      if (
        !current.isDirectory() ||
        String(current.dev) + ":" + String(current.ino) !== binding.identity ||
        !same(binding.physical, fs.realpathSync(binding.lexical))
      )
        return denied;
      const target = path.resolve(binding.lexical, value);
      if (same(target, binding.lexical) || !inside(binding.lexical, target))
        return denied;
      if (blocked.some((value) => inside(value.lexical, target))) return denied;
      let cursor = target;
      while (!same(cursor, binding.lexical)) {
        try {
          const entry = fs.lstatSync(cursor, { bigint: true });
          if (
            entry.isSymbolicLink() ||
            (!entry.isFile() && !entry.isDirectory()) ||
            (entry.isFile() && entry.nlink !== 1n)
          )
            return denied;
          if (same(cursor, target) ? !entry.isFile() : !entry.isDirectory())
            return denied;
          const physical = fs.realpathSync(cursor);
          if (
            !inside(binding.physical, physical) ||
            blocked.some((value) => inside(value.physical, physical))
          )
            return denied;
          if (
            path
              .relative(binding.physical, physical)
              .split(/[\\/]/)
              .some((part) => protectedNames.has(part.toLowerCase()))
          )
            return denied;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return denied;
        }
        const parent = path.dirname(cursor);
        if (same(parent, cursor)) return denied;
        cursor = parent;
      }
      return undefined;
    } catch {
      return denied;
    }
  };
}
