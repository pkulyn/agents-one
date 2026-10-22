import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { codexInvocation } from "../codex-runtime";
import { terminateProcessTree } from "../process-control";

export interface CodexProjectWriteFilesystemEvidence {
  /** Filesystem evidence only; MCP/apps/hooks require independent enforcement. */
  projectWriteFilesystemVerified: boolean;
  completeExecutionPolicyVerified: false;
  verifiedAt: number;
  invocationFingerprint?: string;
  error?:
    | "launch_failed"
    | "timed_out"
    | "probe_failed"
    | "outside_write_allowed"
    | "invalid_response";
}
interface ProbeInput {
  executablePath: string;
  nodeExecutable: string;
  privateDirectory: string;
  timeoutMs?: number;
}
const MAX_OUTPUT = 16384;

/** Runs real read/write attempts; model statements and CLI exit status alone are insufficient. */
export async function probeCodexProjectWriteFilesystem(
  input: ProbeInput,
): Promise<CodexProjectWriteFilesystemEvidence> {
  const evidence: CodexProjectWriteFilesystemEvidence = {
    projectWriteFilesystemVerified: false,
    completeExecutionPolicyVerified: false,
    verifiedAt: Date.now(),
  };
  const timeout = input.timeoutMs ?? 10000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000)
    return { ...evidence, error: "probe_failed" };
  let root: string | undefined;
  let base: string | undefined;
  try {
    mkdirSync(input.privateDirectory, { recursive: true });
    base = realpathSync(input.privateDirectory);
    root = mkdtempSync(join(base, "codex-project-write-"));
    const inside = join(root, "inside"),
      outside = join(root, "outside");
    mkdirSync(inside);
    mkdirSync(outside);
    const source = join(inside, "source.txt"),
      insideTarget = join(inside, "write.txt"),
      outsideTarget = join(outside, "write.txt");
    writeFileSync(source, "agents-one-read-check");
    writeFileSync(outsideTarget, "agents-one-outside-preserved");
    const linkedDirectory = join(inside, "linked-outside");
    symlinkSync(outside, linkedDirectory, "junction");
    const linkedTarget = join(linkedDirectory, "linked-write.txt");
    const outsideLinkedTarget = join(outside, "linked-write.txt");
    const program = join(inside, "probe.cjs");
    writeFileSync(
      program,
      `const fs=require('node:fs');const value={read:false,insideWritten:false,outsideDenied:false,linkedOutsideDenied:false};try{value.read=fs.readFileSync(${JSON.stringify(source)},'utf8')==='agents-one-read-check';}catch{}try{fs.writeFileSync(${JSON.stringify(insideTarget)},'agents-one-inside-written');value.insideWritten=true;}catch{}for(const [key,file] of ${JSON.stringify(
        [
          ["outsideDenied", outsideTarget],
          ["linkedOutsideDenied", linkedTarget],
        ],
      )}){try{fs.writeFileSync(file,'isolated-probe');}catch(error){value[key]=['EACCES','EPERM','EROFS'].includes(error.code);}}process.stdout.write(JSON.stringify(value));process.exit(value.read&&value.insideWritten&&value.outsideDenied&&value.linkedOutsideDenied?0:2);`,
    );
    const invocation = codexInvocation(input.executablePath);
    const identity = createHash("sha256");
    for (const file of [
      invocation.command,
      ...invocation.prefix,
      input.nodeExecutable,
    ])
      identity.update(readFileSync(file));
    evidence.invocationFingerprint = identity.digest("hex");
    // @lat: [[mobile-data#Mobile data#Actual Codex project write filesystem proof]]
    const child = spawn(
      invocation.command,
      [
        ...invocation.prefix,
        "sandbox",
        "--permission-profile",
        ":workspace",
        "-C",
        inside,
        "--",
        input.nodeExecutable,
        program,
      ],
      {
        cwd: inside,
        // Electron Main's executable can run this bounded Node probe without a separate install.
        env: {
          ...process.env,
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      overflow = false,
      timedOut = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(output) + chunk.length > MAX_OUTPUT)
        overflow = true;
      else output += chunk.toString();
    });
    // Drain diagnostics, but do not expose configuration or secret-bearing stderr.
    child.stderr?.on("data", () => undefined);
    const result = await new Promise<{
      code: number | null;
      launchFailed: boolean;
    }>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        void terminateProcessTree(child).catch(() => child.kill());
      }, timeout);
      child.once("error", () => {
        clearTimeout(timer);
        resolve({ code: null, launchFailed: true });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, launchFailed: false });
      });
    });
    evidence.verifiedAt = Date.now();
    if (timedOut) return { ...evidence, error: "timed_out" };
    if (result.launchFailed) return { ...evidence, error: "launch_failed" };
    if (
      readFileSync(outsideTarget, "utf8") !== "agents-one-outside-preserved" ||
      existsSync(outsideLinkedTarget)
    )
      return { ...evidence, error: "outside_write_allowed" };
    if (
      !existsSync(insideTarget) ||
      readFileSync(insideTarget, "utf8") !== "agents-one-inside-written"
    )
      return { ...evidence, error: "probe_failed" };
    if (overflow) return { ...evidence, error: "invalid_response" };
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(output) as Record<string, unknown>;
    } catch {
      return { ...evidence, error: "invalid_response" };
    }
    if (
      !value ||
      Object.keys(value).sort().join(",") !==
        "insideWritten,linkedOutsideDenied,outsideDenied,read" ||
      value.read !== true ||
      value.insideWritten !== true ||
      value.linkedOutsideDenied !== true ||
      value.outsideDenied !== true
    )
      return { ...evidence, error: "invalid_response" };
    if (result.code !== 0) return { ...evidence, error: "probe_failed" };
    return { ...evidence, projectWriteFilesystemVerified: true };
  } catch {
    return { ...evidence, error: "probe_failed" };
  } finally {
    try {
      if (root && base && existsSync(root)) {
        const actual = realpathSync(root),
          relation = relative(base, actual);
        if (
          relation &&
          relation !== ".." &&
          !relation.startsWith(`..${sep}`) &&
          !isAbsolute(relation) &&
          actual === root
        )
          rmSync(root, { recursive: true, force: true });
      }
    } catch {
      /* Preserve private probe files when safe cleanup cannot be established. */
    }
  }
}
