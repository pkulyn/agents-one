import { join } from "node:path";
import { mkdirSync, lstatSync, realpathSync } from "node:fs";
import {
  getAgentRuntimeRun,
  resolveAgentRuntimeArtifactPath,
} from "../agent-runtimes";
import type { DesktopConversationRepository } from "./desktop-conversations";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";
import { MobileArtifactRepository } from "./artifact-repository";
import { originalRunReferences } from "./run-read";

/** Bind Main artifact capabilities to accepted original Run/conversation identities in this Owner. */
export function createDesktopMobileArtifacts(
  repository: DesktopConversationRepository,
  ledger: MobileOwnerLedgerPort,
  guard: () => void,
): MobileArtifactRepository {
  guard();
  for (const directory of [
    repository.home,
    join(repository.home, "desktop"),
    join(repository.home, "desktop", "mobile-control"),
  ]) {
    mkdirSync(directory, { recursive: true });
    if (
      lstatSync(directory).isSymbolicLink() ||
      realpathSync(directory).toLowerCase() !== directory.toLowerCase()
    )
      throw Object.assign(Error("requires_owner_action"), {
        code: "requires_owner_action",
        status: 409,
      });
  }
  return new MobileArtifactRepository(
    join(repository.home, "desktop", "mobile-control"),
    ledger.ownerId,
    ledger.spaceId,
    ledger.dataEpoch,
    {
      guard,
      getRun: (id) => getAgentRuntimeRun(id),
      resolvePath: (runId, artifactId) =>
        resolveAgentRuntimeArtifactPath(runId, artifactId),
      knownRuns: async () => {
        guard();
        const originals = new Map(
          repository.list().map((row) => [row.id, row]),
        );
        const accepted = (await ledger.executionEntries()).flatMap((entry) => {
          const source = originals.get(String(entry.run.conversationId));
          return source?.sourceKind === "runtime_conversation" &&
            source.runtimeId === entry.run.runtimeId &&
            (source.activeRunIds.includes(String(entry.run.runId)) ||
              source.messages.some(
                (message) => message.runId === entry.run.runId,
              ))
            ? [
                {
                  runId: String(entry.run.runId),
                  runtimeId: String(entry.run.runtimeId),
                  conversationId: source.id,
                },
              ]
            : [];
        });
        const acceptedIds = new Set(accepted.map((row) => row.runId));
        return [
          ...accepted,
          ...originalRunReferences([...originals.values()]).filter(
            (row) => !acceptedIds.has(row.runId),
          ),
        ];
      },
    },
  );
}
