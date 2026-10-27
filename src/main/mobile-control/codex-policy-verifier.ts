import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  deriveAgentTransport,
  type AgentRuntimeDefinition,
} from "../../shared/agent-runtimes";
import { getActiveProfileNameSync, agentsOneProfileHome } from "../utils";
import { resolveAuthorizedWorkspaceId } from "../workspace-authority";
import { isAgentsOneRestoreWriteLocked } from "../restore-write-lock";
import type { DesktopConversationRepository } from "./desktop-conversations";
import { desktopRuntimePolicyFingerprint } from "./desktop-execution";
import {
  mobileProjectCapabilityHash,
  type OwnerPolicyEvidence,
  type OwnerPolicySelection,
} from "./execution-policy-store";
import {
  captureCodexInspectionIdentity,
  assertCodexInspectionIdentity,
  assertReviewedCodexInspectionNative,
} from "./codex-invocation-identity";
import { readCodexMobileConfiguration } from "./codex-effective-config";
import { readCodexMobileCatalogBinding } from "./codex-mobile-context";
import { probeCodexReadOnlyFilesystem } from "./codex-sandbox-probe";
import { CODEX_INSPECT_DISABLED_FEATURES } from "./codex-inspect-boundary";
import { probeCodexProjectWriteFilesystem } from "./codex-project-write-probe";
import { assertCodexProjectWriteStorageBoundary } from "./codex-project-write-context";
import {
  readCodexProjectWriteBinding,
  probeCodexProjectWriteWorker,
} from "./codex-project-write-worker-proof";

const TTL = 300_000;
const MAX_BINDINGS = 64;
interface Binding {
  evidence: OwnerPolicyEvidence;
  current(): void;
}
const bindings = new Map<string, Binding>();
const pending = new Map<string, Promise<void>>();
function denied(): never {
  throw Object.assign(Error("unverified_policy"), {
    code: "unverified_policy",
  });
}
function key(
  profile: string,
  home: string,
  selection: OwnerPolicySelection,
): string {
  return JSON.stringify([
    profile,
    home,
    selection.runtimeId,
    selection.projectId ?? null,
    selection.mode,
    selection.unattendedApproved,
  ]);
}
function owner(
  profile: string,
  home: string,
  repository: DesktopConversationRepository,
): void {
  if (
    getActiveProfileNameSync() !== profile ||
    agentsOneProfileHome(profile) !== home ||
    repository.profile !== profile ||
    isAgentsOneRestoreWriteLocked()
  )
    denied();
}
function workspace(
  repository: DesktopConversationRepository,
  projectId?: string,
): string | undefined {
  if (!projectId) return undefined;
  const project = repository.projects().find((value) => value.id === projectId);
  const root = resolveAuthorizedWorkspaceId(projectId);
  if (!project || !root) denied();
  const stat = lstatSync(project.path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) denied();
  const actual = realpathSync(project.path);
  if ((process.platform === "win32" ? actual.toLowerCase() : actual) !== root)
    denied();
  return actual;
}
function privateDirectory(home: string, segments: string[]): string {
  let directory = realpathSync(home);
  for (const segment of segments) {
    const child = join(directory, segment);
    try {
      mkdirSync(child);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(child);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      realpathSync(child) !== child
    )
      denied();
    directory = child;
  }
  return directory;
}

/** Live Main evidence only; saved approvals cannot manufacture a binding. */
export function verifyDesktopCodexPolicy(
  profile: string,
  repository: DesktopConversationRepository,
  selection: OwnerPolicySelection,
  runtime: AgentRuntimeDefinition,
): OwnerPolicyEvidence | undefined {
  try {
    if (!["inspect", "project_write"].includes(selection.mode))
      return undefined;
    const binding = bindings.get(
      key(profile, agentsOneProfileHome(profile), selection),
    );
    if (
      !binding ||
      binding.evidence.expiresAt <= Date.now() ||
      binding.evidence.runtimeConfigurationHash !==
        desktopRuntimePolicyFingerprint(runtime)
    )
      return undefined;
    binding.current();
    owner(profile, agentsOneProfileHome(profile), repository);
    return { ...binding.evidence };
  } catch {
    return undefined;
  }
}

/** Local review prepares actual native/config/model/filesystem evidence, never a model turn. */
export async function prepareDesktopCodexPolicy(
  profile: string,
  repository: DesktopConversationRepository,
  selection: OwnerPolicySelection,
  runtime: AgentRuntimeDefinition,
  force = false,
): Promise<void> {
  selection = { ...selection };
  const home = agentsOneProfileHome(profile);
  const cacheKey = key(profile, home, selection);
  if (
    !force &&
    verifyDesktopCodexPolicy(profile, repository, selection, runtime)
  )
    return;
  const existing = pending.get(cacheKey);
  if (existing) {
    await existing;
    // A desktop approval always obtains its own fresh configuration after a concurrent refresh.
    if (!force) return;
  }
  const promise = prepare();
  pending.set(cacheKey, promise);
  try {
    await promise;
  } finally {
    if (pending.get(cacheKey) === promise) pending.delete(cacheKey);
  }
  async function prepare(): Promise<void> {
    // A still-current binding remains usable while its replacement is checked.
    try {
      owner(profile, home, repository);
      if (
        !["inspect", "project_write"].includes(selection.mode) ||
        (selection.mode === "project_write" && !selection.projectId) ||
        selection.runtimeId !== runtime.id ||
        !runtime.enabled ||
        runtime.configurationIssue ||
        runtime.needsReauthorization ||
        runtime.kind !== "codex" ||
        runtime.location !== "local" ||
        deriveAgentTransport(runtime) !== "local-cli"
      )
        denied();
      const root = workspace(repository, selection.projectId);
      if (selection.mode === "project_write")
        assertCodexProjectWriteStorageBoundary(profile, root!);
      const rootIdentity = root ? lstatSync(root) : undefined;
      const cwd =
        root ?? privateDirectory(home, ["desktop", "runtime-chat", "codex"]);
      const environment = { ...process.env };
      const executable = runtime.config.executablePath?.trim() || "codex";
      const runtimeHash = desktopRuntimePolicyFingerprint(runtime);
      const identity = captureCodexInspectionIdentity(
        executable,
        cwd,
        environment,
      );
      assertReviewedCodexInspectionNative(identity);
      const configuration = await readCodexMobileConfiguration(
        { executablePath: identity.nativePath, model: runtime.config.model },
        cwd,
        environment,
      );
      const catalog = readCodexMobileCatalogBinding(
        environment,
        configuration.model,
      );
      const projectHash = root
        ? mobileProjectCapabilityHash({
            id: selection.projectId!,
            path: process.platform === "win32" ? root.toLowerCase() : root,
          })
        : undefined;
      const probe = await probeCodexReadOnlyFilesystem({
        executablePath: identity.nativePath,
        nodeExecutable: process.execPath,
        privateDirectory: privateDirectory(home, [
          "desktop",
          "mobile-policy-probes",
        ]),
      });
      if (!probe.readonlyFilesystemVerified || probe.error) denied();
      const writeBinding =
        selection.mode === "project_write"
          ? readCodexProjectWriteBinding()
          : undefined;
      if (writeBinding) {
        const directory = privateDirectory(home, [
          "desktop",
          "mobile-policy-probes",
        ]);
        const filesystem = await probeCodexProjectWriteFilesystem({
          executablePath: identity.nativePath,
          nodeExecutable: writeBinding.nodeExecutable,
          privateDirectory: directory,
        });
        if (!filesystem.projectWriteFilesystemVerified || filesystem.error)
          denied();
        const worker = await probeCodexProjectWriteWorker({
          executablePath: identity.nativePath,
          privateDirectory: directory,
          binding: writeBinding,
        });
        if (
          !worker.verified ||
          worker.error ||
          worker.workerSha256 !== writeBinding.workerSha256
        )
          denied();
      }
      const current = (): void => {
        owner(profile, home, repository);
        if (desktopRuntimePolicyFingerprint(runtime) !== runtimeHash) denied();
        writeBinding?.assertCurrent();
        if (workspace(repository, selection.projectId) !== root) denied();
        if (root && rootIdentity) {
          const actual = lstatSync(root);
          if (
            actual.isSymbolicLink() ||
            actual.dev !== rootIdentity.dev ||
            actual.ino !== rootIdentity.ino ||
            actual.birthtimeMs !== rootIdentity.birthtimeMs
          )
            denied();
        }
        assertCodexInspectionIdentity(identity, executable, cwd, {
          ...process.env,
        });
        const actualCatalog = readCodexMobileCatalogBinding(
          { ...process.env },
          configuration.model,
        );
        if (
          actualCatalog.originalMetadataHash !== catalog.originalMetadataHash ||
          actualCatalog.projectedCatalogHash !== catalog.projectedCatalogHash
        )
          denied();
      };
      current();
      const evidence: OwnerPolicyEvidence = {
        enforcementId: writeBinding
          ? selection.unattendedApproved
            ? "codex-01593-main-controlled-write-schedule-v1"
            : "codex-01593-main-controlled-write-v1"
          : selection.unattendedApproved
            ? "codex-01593-main-inspect-schedule-v1"
            : "codex-01593-main-inspect-v1",
        enforcementFingerprint: createHash("sha256")
          .update(
            JSON.stringify([
              identity.fingerprint,
              runtimeHash,
              configuration.configurationHash,
              catalog.originalMetadataHash,
              catalog.projectedCatalogHash,
              projectHash ?? null,
              CODEX_INSPECT_DISABLED_FEATURES,
              "main-project-read-list-v1",
              ...(writeBinding
                ? [
                    "main-fixed-run-controlled-write-v1",
                    "native-single-write-tool-approve-v1",
                    writeBinding.fingerprint,
                    writeBinding.workerSha256,
                  ]
                : []),
              ...(selection.unattendedApproved
                ? [
                    "original-schedule-admission-final-checkpoint-v1",
                    ...(writeBinding
                      ? ["original-schedule-controlled-write-v1"]
                      : []),
                  ]
                : []),
            ]),
          )
          .digest("hex"),
        runtimeConfigurationHash: runtimeHash,
        codexConfigurationHash: configuration.configurationHash,
        ...(writeBinding
          ? { codexProjectWriteWorkerHash: writeBinding.workerSha256 }
          : {}),
        projectCapabilityHash: projectHash,
        mode: selection.mode,
        verified: true,
        unattendedSupported: selection.unattendedApproved,
        expiresAt: Date.now() + TTL,
      };
      for (const [id, binding] of bindings)
        if (binding.evidence.expiresAt <= Date.now()) bindings.delete(id);
      if (!bindings.has(cacheKey) && bindings.size >= MAX_BINDINGS) denied();
      bindings.set(cacheKey, { evidence, current });
    } catch {
      bindings.delete(cacheKey);
      denied();
    }
  }
}
