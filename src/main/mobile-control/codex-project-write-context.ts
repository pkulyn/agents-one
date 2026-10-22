import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { getActiveProfileNameSync, agentsOneProfileHome } from "../utils";
import { resolveAuthorizedWorkspaceId } from "../workspace-authority";
import { registerRetainedProjectWrite } from "./project-write-recovery";
import { persistClosedProjectWrite } from "./closed-project-write";
import { readMobileDataGeneration } from "./data-generation";
import { ProjectWriteRunner } from "./project-write-runner";

function unavailable(): never {
  throw Error("Mobile project write context is unavailable.");
}
function outside(root: string, directory: string): void {
  const relation = relative(root, directory);
  if (
    !relation ||
    (!isAbsolute(relation) &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`))
  )
    unavailable();
}
function directory(home: string, segments: string[]): string {
  let base = realpathSync(home);
  if (lstatSync(home).isSymbolicLink() || !lstatSync(base).isDirectory())
    unavailable();
  for (const segment of segments) {
    const child = join(base, segment);
    if (!existsSync(child)) mkdirSync(child);
    const stat = lstatSync(child);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      realpathSync(child) !== child
    )
      unavailable();
    base = child;
  }
  return base;
}

/** Fixed Main Run only; no path or namespace is accepted from model/phone arguments. */
export function assertCodexProjectWriteStorageBoundary(
  profile: string | undefined,
  workspace: string,
): void {
  const root = realpathSync(workspace),
    homePath = agentsOneProfileHome(profile),
    sharedHomePath = agentsOneProfileHome();
  if (
    lstatSync(workspace).isSymbolicLink() ||
    !lstatSync(root).isDirectory() ||
    lstatSync(homePath).isSymbolicLink() ||
    lstatSync(sharedHomePath).isSymbolicLink()
  )
    unavailable();
  outside(root, realpathSync(homePath));
  outside(root, realpathSync(sharedHomePath));
}

/** Fixed Main Run only; no path or namespace is accepted from model/phone arguments. */
export function createCodexProjectWriteRunner(input: {
  profile?: string;
  runId: string;
  projectId?: string;
  workspace: string;
  executablePath: string;
  workerPath: string;
  workerSha256?: string;
  authorize(): void;
  assertWritesAllowed(): void;
}): ProjectWriteRunner {
  // @lat: [[mobile-data#Mobile data#Codex fixed Run writer private storage]]
  if (
    !/^run-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      input.runId,
    )
  )
    unavailable();
  assertCodexProjectWriteStorageBoundary(input.profile, input.workspace);
  const root = realpathSync(input.workspace);
  const homePath = agentsOneProfileHome(input.profile),
    sharedHomePath = agentsOneProfileHome();
  if (
    lstatSync(input.workspace).isSymbolicLink() ||
    !lstatSync(root).isDirectory() ||
    lstatSync(homePath).isSymbolicLink() ||
    lstatSync(sharedHomePath).isSymbolicLink()
  )
    unavailable();
  const home = realpathSync(homePath);
  const sharedHome = realpathSync(sharedHomePath);
  outside(root, home);
  outside(root, sharedHome);
  input.assertWritesAllowed();
  const profile = input.profile || getActiveProfileNameSync();
  const homeIdentity = lstatSync(homePath);
  let generation: string;
  try {
    generation = readMobileDataGeneration(homePath);
  } catch {
    return unavailable();
  }
  const runner = new ProjectWriteRunner({
    root: input.workspace,
    directory: directory(homePath, [
      "desktop",
      "mobile-control",
      "project-writes",
    ]),
    coordinationDirectory: directory(sharedHomePath, [
      "desktop",
      "mobile-control",
      "project-write-locks",
    ]),
    namespace: JSON.stringify([home, input.runId]),
    executablePath: input.executablePath,
    workerPath: input.workerPath,
    expectedWorkerSha256: input.workerSha256,
    authorize: input.authorize,
    assertWritesAllowed: input.assertWritesAllowed,
    ...(input.projectId
      ? {
          authorizeRecovery: () => {
            const currentHome = lstatSync(homePath);
            const currentWorkspace = resolveAuthorizedWorkspaceId(
              input.projectId!,
            );
            if (
              getActiveProfileNameSync() !== profile ||
              realpathSync(homePath) !== home ||
              currentHome.isSymbolicLink() ||
              currentHome.dev !== homeIdentity.dev ||
              currentHome.ino !== homeIdentity.ino ||
              currentHome.birthtimeMs !== homeIdentity.birthtimeMs ||
              !currentWorkspace ||
              (process.platform === "win32"
                ? realpathSync(currentWorkspace).toLowerCase() !==
                  root.toLowerCase()
                : realpathSync(currentWorkspace) !== root)
            )
              unavailable();
            input.assertWritesAllowed();
          },
          onRetained: (localId: string, path: string, evidence) => {
            registerRetainedProjectWrite({
              profile,
              runId: input.runId,
              projectId: input.projectId!,
              localId,
              path,
              runner,
            });
            if (evidence) {
              input.assertWritesAllowed();
              persistClosedProjectWrite({
                profile,
                runId: input.runId,
                projectId: input.projectId!,
                localId,
                generation,
                homeIdentity: {
                  dev: homeIdentity.dev,
                  ino: homeIdentity.ino,
                  birthtimeMs: homeIdentity.birthtimeMs,
                },
                evidence,
              });
            }
          },
        }
      : {}),
  });
  return runner;
}
