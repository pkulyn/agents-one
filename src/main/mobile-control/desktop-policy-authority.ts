import { realpathSync } from "node:fs";
import { join } from "node:path";
import { listAgentRuntimes } from "../agent-runtimes";
import { getActiveProfileNameSync, agentsOneProfileHome } from "../utils";
import { resolveAuthorizedWorkspaceId } from "../workspace-authority";
import { assertAgentsOneWritesAllowed } from "../restore-write-lock";
import type { DesktopConversationRepository } from "./desktop-conversations";
import {
  prepareDesktopCodexPolicy,
  verifyDesktopCodexPolicy,
} from "./codex-policy-verifier";
import {
  MobileExecutionPolicyStore,
  mobileProjectCapabilityHash,
  type OwnerPolicyAuthority,
} from "./execution-policy-store";

/** Fixed-profile production storage; only the verifier can claim enforced capability. */
export function createDesktopExecutionPolicyStore(
  profile: string,
  repository: DesktopConversationRepository,
  verify: OwnerPolicyAuthority["verify"] = (selection, runtime) =>
    verifyDesktopCodexPolicy(profile, repository, selection, runtime),
): MobileExecutionPolicyStore {
  const assertOwner = (): void => {
    if (
      getActiveProfileNameSync() !== profile ||
      repository.profile !== profile
    )
      throw Object.assign(Error("profile_inactive"), {
        code: "profile_inactive",
        status: 403,
      });
  };
  return new MobileExecutionPolicyStore(
    join(
      agentsOneProfileHome(profile),
      "desktop",
      "mobile-execution-policies.json",
    ),
    {
      runtime: (id) => {
        assertOwner();
        return listAgentRuntimes().find((runtime) => runtime.id === id);
      },
      project: (id) => {
        assertOwner();
        const project = repository.projects().find((value) => value.id === id);
        if (!project) return undefined;
        const root = resolveAuthorizedWorkspaceId(id);
        if (!root) return undefined;
        let path: string;
        try {
          path = realpathSync(project.path);
        } catch {
          return undefined;
        }
        if (process.platform === "win32") path = path.toLowerCase();
        if (root !== path) return undefined;
        return {
          capabilityHash: mobileProjectCapabilityHash({ id, path: root }),
        };
      },
      verify: (selection, runtime) => {
        assertOwner();
        return verify(selection, runtime);
      },
      assertWritesAllowed: () => {
        assertOwner();
        assertAgentsOneWritesAllowed();
      },
    },
  );
}

/** Rebuild current evidence for existing Owner intent; never adds or approves policies. */
export async function refreshDesktopExecutionApprovals(
  profile: string,
  repository: DesktopConversationRepository,
  refreshBeforeMs = 0,
): Promise<void> {
  const store = createDesktopExecutionPolicyStore(profile, repository);
  for (const selection of store.approvalSelections()) {
    const runtime = listAgentRuntimes().find(
      (value) => value.id === selection.runtimeId,
    );
    if (!runtime) continue;
    try {
      const current = verifyDesktopCodexPolicy(
        profile,
        repository,
        selection,
        runtime,
      );
      await prepareDesktopCodexPolicy(
        profile,
        repository,
        selection,
        runtime,
        Boolean(current && current.expiresAt <= Date.now() + refreshBeforeMs),
      );
    } catch {
      /* Keep the original approval restricted; never rewrite or redispatch. */
    }
  }
}
