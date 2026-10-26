import { existsSync } from "node:fs";
import { logApplicationDiagnostic } from "../agents-one-logs";
import {
  isMobileConnectionChanging,
  mobileOwnerBinding,
  onMobileConnectionChanged,
} from "../mobile-connection";
import { getActiveProfileNameSync, agentsOneProfileHome } from "../utils";
import { isAgentsOneRestoreWriteLocked } from "../restore-write-lock";
import { DesktopConversationRepository } from "./desktop-conversations";
import { MobileOwnerLedgerClient } from "./owner-ledger-client";
import { MobileConversationController } from "./conversation-controller";
import { isTaskScheduleRunnerOnline } from "../task-schedules";
import { DesktopMobileScheduleReadRepository } from "./schedule-read";
import {
  createDesktopExecutionStore,
  createDesktopMobileCatalog,
} from "./desktop-execution";
import { MobileOwnerTunnelProcess } from "./owner-tunnel-process";
import { MobileOwnerLifecycle } from "./owner-lifecycle";
import { DesktopMobileScheduleControl } from "./schedule-control";
import {
  createDesktopExecutionPolicyStore,
  refreshDesktopExecutionApprovals,
} from "./desktop-policy-authority";
import { MobileExecutionCoordinator } from "./execution-coordinator";
import { DesktopConversationCreation } from "./conversation-creation";
import { desktopMobileScheduleAuthority } from "./schedule-execution";
import { createDesktopMobileArtifacts } from "./desktop-artifacts";
import {
  createDesktopMobileRunReader,
  createDesktopMobileRunControl,
} from "./desktop-runs";
import {
  readMobileDataGeneration,
  mobileOwnerLedgerPath,
} from "./data-generation";
import { createDesktopTaskAccess } from "./desktop-task-selection";

/** Registers only implemented capabilities; an unverified policy cannot dispatch. */
export function startDesktopMobileOwner(
  onUnavailable?: () => void,
): () => void {
  const executions = new Set<MobileExecutionCoordinator>();
  const ledgers = new Set<MobileOwnerLedgerClient>();
  let refreshing = false;
  // Recheck accepted Run authority independently of a phone or relay connection.
  const policyRefresh = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void (async () => {
      if (isAgentsOneRestoreWriteLocked() || isMobileConnectionChanging())
        return;
      const profile = getActiveProfileNameSync();
      await refreshDesktopExecutionApprovals(
        profile,
        new DesktopConversationRepository(profile),
        60_000,
      );
    })()
      .catch(() => {
        /* Fail closed without approving or redispatching. */
      })
      .finally(() => {
        refreshing = false;
      });
  }, 60_000);
  policyRefresh.unref();
  const lifecycle = new MobileOwnerLifecycle({
    scope: () => {
      const profile = getActiveProfileNameSync();
      const home = agentsOneProfileHome(profile);
      return { profile, home, dataGeneration: readMobileDataGeneration(home) };
    },
    locked: () =>
      isAgentsOneRestoreWriteLocked() || isMobileConnectionChanging(),
    binding: (scope) => mobileOwnerBinding(scope.profile),
    handler: async (scope, binding) => {
      const repository = new DesktopConversationRepository(scope.profile);
      if (repository.home !== scope.home) throw Error("profile_inactive");
      const ledger = new MobileOwnerLedgerClient(
        mobileOwnerLedgerPath(
          scope.home,
          binding.ownerId,
          binding.spaceId,
          scope.dataGeneration!,
        ),
        binding.ownerId,
        binding.spaceId,
      );
      ledgers.add(ledger);
      try {
        await ledger.whenReady();
        await ledger.executionEntries();
      } catch (error) {
        ledgers.delete(ledger);
        await ledger.close().catch(() => undefined);
        throw error;
      }
      // Main's combined verifier binds the reviewed native/config/model/project boundary.
      const legacyPolicies = createDesktopExecutionPolicyStore(
        scope.profile,
        repository,
      );
      const { policies, backend } = createDesktopTaskAccess(
        scope.profile,
        repository,
        legacyPolicies,
      );
      const sourceGuard = (): void => {
        if (
          !existsSync(scope.home) ||
          getActiveProfileNameSync() !== scope.profile ||
          agentsOneProfileHome(scope.profile) !== scope.home ||
          readMobileDataGeneration(scope.home) !== scope.dataGeneration ||
          isAgentsOneRestoreWriteLocked() ||
          isMobileConnectionChanging()
        )
          throw Object.assign(Error("owner_unavailable"), {
            code: "owner_unavailable",
            status: 503,
          });
      };
      const artifacts = createDesktopMobileArtifacts(
        repository,
        ledger,
        sourceGuard,
      );
      const execution = new MobileExecutionCoordinator(
        createDesktopExecutionStore(scope.profile),
        backend,
        ledger,
        undefined,
        undefined,
        artifacts,
      );
      executions.add(execution);
      try {
        await execution.retryPendingFinals();
      } catch {
        // Retain proven checkpoints for Owner recovery; never redispatch.
        onUnavailable?.();
      }
      const catalog = createDesktopMobileCatalog(
        scope.profile,
        repository,
        policies,
        backend,
      );
      const originalRuns = createDesktopMobileRunReader(
        scope.profile,
        ledger,
        artifacts,
        sourceGuard,
      );
      const controller = new MobileConversationController(
        repository,
        ledger,
        "Agents One",
        Date.now,
        execution,
        new DesktopConversationCreation(scope.profile, backend),
        catalog,
        new DesktopMobileScheduleReadRepository(scope.profile),
        new DesktopMobileScheduleControl(
          scope.profile,
          ledger,
          desktopMobileScheduleAuthority(policies, backend),
        ),
        sourceGuard,
        () =>
          catalog
            .snapshot()
            .policies.some((policy) => policy.enforced === true),
        () => isTaskScheduleRunnerOnline(scope.profile),
        artifacts,
        originalRuns,
        createDesktopMobileRunControl(
          scope.profile,
          originalRuns,
          ledger,
          sourceGuard,
        ),
      );
      return {
        status: async () => {
          await refreshDesktopExecutionApprovals(scope.profile, repository);
          return controller.status();
        },
        handle: async (request) => {
          await refreshDesktopExecutionApprovals(scope.profile, repository);
          return controller.handle(request);
        },
        dispose: () => {
          ledgers.delete(ledger);
          return ledger.close();
        },
      };
    },
    transport: (binding, handler) =>
      new MobileOwnerTunnelProcess(binding, handler, (value) =>
        logApplicationDiagnostic("mobile.owner.transport", value),
      ),
    onUnavailable,
  });
  const unsubscribe = onMobileConnectionChanged(() => lifecycle.invalidate());
  lifecycle.start();
  return () => {
    clearInterval(policyRefresh);
    unsubscribe();
    lifecycle.stop();
    for (const execution of executions) execution.dispose();
    executions.clear();
    for (const ledger of ledgers) void ledger.close().catch(() => undefined);
    ledgers.clear();
  };
}
