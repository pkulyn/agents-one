# Runtime Chat Rendering

Runtime conversations reuse the native chat message union so every agent gets the same reasoning, tool, attachment, and media presentation without exposing control-plane noise as conversation content.

## Event presentation boundary

The renderer adapts durable runtime events without changing their stored records or main-process contracts.

OpenCode ACP thought chunks are provider deltas rather than cumulative snapshots. [[src/main/runtime-adapters/builtin/opencode-acp.ts]] accumulates each contiguous `agent_thought_chunk` sequence into a bounded snapshot and supplies it as both summary and detail, so the existing Runtime progress upsert and renderer produce one readable thought row instead of one row per fragment. `session/new.configOptions` is the source of the actual selected OpenCode model, while `usage_update` and `session/prompt` usage are retained on `AgentRuntimeRun` and its durable execution record. Reported model metadata takes precedence over a requested/configured model in [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]], preventing an invalid or unavailable model request from being displayed as if it were used.

OpenCode is an agent client identity, not the identity of the underlying model. Its ACP prompt receives a fixed product identity constraint; model output is otherwise kept intact. This corrects model defaults that answer identity questions as Claude Code or another client without rewriting ordinary business content.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeEventMessages]] keeps reasoning, tool calls, tool results, and cancellation feedback visible. Error and timeout events may still mark a matching tool call as failed, but they do not create standalone system cards; artifact-publication events also do not create notice cards. Workspace Grant creation/absence messages are platform lifecycle state rather than model reasoning, so current and already-persisted copies are filtered from the visible thought rows. Diagnostics and artifact metadata remain available to their other consumers.

OpenCode's ACP tool trace is structured rather than a plain text progress line. The adapter maps `tool_call`/`tool_call_update` to the canonical tool evidence shape, including stable call id, tool name, bounded relative-path arguments, output content, and failure detail. Repeated snapshots are merged by call id in the renderer, which keeps the live and durable transcript to one tool row plus its result row. OpenCode 1.x does not currently advertise a thinking-level option through ACP; the input toolbar consequently shows `思考 自动` as a read-only provider status with an explanatory tooltip, instead of presenting levels that cannot be applied. Pi's verified native thinking picker remains unchanged.

The live typing bubble keeps only the neutral three-dot activity animation. [[src/renderer/src/screens/Chat/MessageList.tsx#MessageList]] no longer adds a separate rotating Agents One logo because that mark did not identify the responding Runtime or expose actionable state.

## Pi model transport failures

Pi may emit assistant messages with `stopReason=error` and still exit with status code `0`. [[src/main/pi-runtime.ts#piOutputError]] makes a terminal structured model error fail the Runtime Run instead of producing an empty-success fallback in chat.

A later successful text response clears an earlier retry error, so Pi's built-in transient retries do not create false failures.

[[src/main/pi-runtime.ts#piChildEnvironment]] keeps the Pi subprocess environment bounded to desktop/runtime essentials and supported provider variables, but also passes the standard case-insensitive `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` variables. This preserves the network behavior of a working terminal invocation in corporate environments without copying unrelated Electron environment secrets.

## Local CLI context occupancy

Local Runtime context gauges use current prompt occupancy rather than total billed tokens. [[src/main/agent-runtimes.ts#normalizeLocalRuntimeUsage]] produces the canonical `contextUsedTokens` value.

Pi contributes `input/cacheRead/cacheWrite`; Claude Code contributes `input_tokens/cache_read_input_tokens/cache_creation_input_tokens`. Output tokens are excluded.

[[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] restores the latest persisted usage when reopening a Runtime conversation. It prefers a provider-reported context window, then asynchronously resolves the selected local Runtime model through the main process; the shared model-family lookup is only the final fallback. The gauge stays hidden while an authoritative lookup is pending instead of briefly displaying a misleading heuristic. Remote Runtime `inputTokens` alone remain insufficient evidence and do not create a guessed occupancy gauge.

## Runtime model context window

Local Runtime model limits are resolved against the catalogue that owns the selected model, not a fixed desktop constant.

[[src/main/pi-runtime.ts#getPiModelContextWindow]] reads Pi's `models.json` custom-provider definitions and `models-store.json` refreshed provider catalogue without invoking a slow CLI subprocess or exposing stored credentials. [[src/main/ipc/register.ts]] then falls through to an exact Agents One model-library override and the native provider/config discovery path. A provider-reported Run value remains highest priority, and the renderer heuristic is used only when every authoritative source returns no value.

## Quick chat locale boundary

Lightweight conversations use the active application locale for controls, progress fallbacks, and the bounded context protocol passed to a Runtime while preserving provider-authored event summaries verbatim.

[[src/renderer/src/screens/Layout/QuickChatPanel.tsx]] translates both visible controls and platform-authored prompt scaffolding. Persisted untitled conversations from either supported locale remain recognizable, so switching languages does not prevent the first real user message from replacing a legacy `New chat`/`新聊天` title. [[src/renderer/src/screens/Layout/QuickChatPanel.test.tsx]] protects the English surface and English context handoff.

## Localized chat entry points

The main conversation's empty-state actions and compact context controls use the active locale for both visible labels and platform-authored prompts.

[[src/renderer/src/screens/Chat/ChatEmptyState.tsx]] forwards the localized suggestion prompt selected by the user rather than a fixed source-language string. [[src/renderer/src/screens/Chat/ContextGauge.tsx]] and [[src/renderer/src/screens/Chat/ChatInput.tsx]] also localize accessible context and attachment-capability descriptions without changing their actions or Runtime contracts.

[[src/renderer/src/screens/Chat/MessageRow.tsx]] formats timestamps, elapsed time, avatar dialogue actions, and branch controls in the active locale. Provider-authored message content and errors remain unchanged.

## Collaboration proposal control turn

An explicit multi-agent request must produce a platform-validated assignment before any implementation role performs workspace work, without making startup depend on a manual configuration dialog or a model completing hidden control syntax.

[[src/shared/task-collaboration-proposals.ts#createExplicitTaskCollaborationProposal]] recognizes an explicit collaboration/coordination request only when at least two registered runtimes have `负责`/`承担` responsibilities and resolves names and aliases against the enabled Runtime catalog. [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] persists the validated assignment against the existing task, normalizes local/remote workspace access, and guarantees that the current task Runtime is the project lead. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] then reuses the single user message and starts the lead as a normal visible agent turn instead of opening the setup dialog or submitting the brief twice.

Only requests accepted by [[src/shared/task-collaboration-proposals.ts#hasExplicitTaskCollaborationIntent]] may receive [[src/shared/task-collaboration-proposals.ts#taskCollaborationProposalProtocol]] or auto-start a model proposal. “Start executing”, task complexity, or an agent's preference for extra roles is not consent; unrequested control blocks are stripped and remain inert. An explicit but incomplete collaboration request may still let the lead return a validated proposal, whose visible planning turn is reused as its handoff.

[[src/shared/task-collaboration-proposals.ts#hasValidTaskCollaborationProposal]] validates every assignment against the enabled runtime allow-list. A valid proposal counts as a control-plane outcome in [[src/main/agent-runtimes.ts#hasRemoteWorkspaceOutcome]], so the Gateway may finish that planning turn without a Workspace audit entry or artifact; invalid and partial proposals do not bypass the existing evidence guard.

[[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] writes each assigned Runtime's reasoning/tool event execution and final output back into the same transcript with that Runtime's name, avatar, color, role, and assignment id. The active live rows use the currently executing Runtime identity. A modifying role cannot hand off until it publishes a Runtime-verified file or adapter-produced diff. If a review returns `不通过`, the platform removes stale evidence, injects the review conclusion into the implementation retry, and reruns implementation and review up to a bounded three total attempts; the lead's final evidence-based acceptance is the only successful terminal state. Manual pause, intervention, and reassignment remain recovery paths.

The parent conversation appearance never follows whichever child Runtime was most recently started. Live child traces and durable handoffs carry their own identity, while identity-free parent history continues to use the addressed Runtime's name, avatar, and colour. Automatic collaboration startup links the persisted task record to the Runtime conversation after the conversation id exists; history recovery prefers that link and can recover older unlinked records through the unique Runtime run ids shared by role runs and message execution traces.

The collaboration poll loop merges every observed snapshot into the active run and updates the transcript before terminal completion. This keeps Pi, Claude Code, and Gateway/Hers reasoning and tool events progressive while preserving earlier events when a later provider snapshot is thinner. A reasoning-first or tool-only trace displays the producing Runtime's avatar and name once at the start of that role turn.

Remote execution has two distinct filesystem boundaries. Native tools and paths belong to the Runtime's own device; an Agents One desktop project is reachable only through an explicit Workspace Grant, remote mapping, or evidence bundle. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx#collaborationWorkspacePreflight]] therefore treats a remote role with no attached project as native-runtime work instead of demanding a local folder, while explicit project access retains its existing safety checks.

## Directed role dialogue

Human intervention is a multi-turn role conversation inside the shared transcript, with downstream work held until the user explicitly resumes it.

[[src/renderer/src/components/TaskCollaborationRolePanel.tsx#TaskCollaborationRolePanel]] makes each configured role avatar a dialogue entry point. Runtime-owned avatars in [[src/renderer/src/screens/Chat/MessageList.tsx#MessageList]] carry the stable collaboration assignment id to the same entry point, so clicking either the role roster or a visible reply targets the producing role rather than merely its Runtime kind.

[[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] cancels the currently active dependency-chain run when directed dialogue opens. Each sent instruction is persisted in the main conversation and reruns only the target assignment; its native reasoning, tools, artifacts, and final reply use the ordinary message renderer. A successful guided turn marks that role complete but keeps later roles blocked in `paused` state. `继续后续任务` resumes from the following assignment, while another message reruns the same role for an additional turn.

[[src/shared/task-collaboration.ts#TaskCollaborationIntervention]] stores a bounded user instruction and optional role response. `shared` turns are injected into subsequent role prompts as both sides of the exchange; `role` turns remain visible only to the target role. [[src/shared/task-collaboration.ts#TaskCollaborationRoleRun]] also retains an optional provider session id so repeated guided turns continue the same underlying agent conversation when the Runtime supports sessions. Rerunning a role invalidates its and downstream roles' stale artifact evidence before review resumes.

## Artifact rendering

Real artifacts are rendered from execution metadata rather than from publication notices.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeConversationMessage]] converts image artifacts into local `MEDIA` tokens and non-image files into attachments. Local file artifacts are openable links rather than download-only chips: hover exposes the complete path, click opens the file, and the native context menu supports opening, copying the path, copying bounded document content, and revealing the file in the system explorer. Remote URLs and data payloads retain save/download behavior. Hiding artifact-publication cards therefore does not hide images or files.

## Ordered delivery and per-agent identity

Collaboration execution must follow dependency order, preserve platform-verified delivery facts, and render each handoff under the Runtime that produced it.

### Explicit DAG scheduling

Explicit collaboration dependencies are validated and scheduled as deterministic topological waves.

[[src/shared/task-collaboration-graph.ts#buildTaskCollaborationGraph]] is the authoritative graph boundary. It validates stable assignment ids, unknown/self dependencies and cycles, then emits topological layers, downstream edges and sink nodes. A record where no assignment declares `dependsOn` remains the legacy serial list; once any assignment declares the field, empty/omitted dependencies are graph roots and every role in the same ready layer is dispatched concurrently.

[[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] runs explicit graphs by topological wave. A join starts only after every direct dependency has platform-owned `succeeded` state. A failed branch marks only its descendants blocked, so unrelated branches can finish; Runtime artifact, permission, workspace and acceptance gates still apply to every node. The synthetic coordinator final review depends on every base-graph sink, preventing it from racing any terminal branch. `activeAssignmentIds` persists the current parallel wave without replacing the legacy singular active id used by serial records and directed recovery.

Live DAG rendering is also wave-shaped rather than singular. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx#ActiveCollaborationRun]] keeps one observed Runtime Run per active assignment, so sibling branches retain separate identities, reasoning summaries and tool rows while they overlap. Stopping the task cancels every active branch instead of only the most recently observed run.

[[src/renderer/src/screens/Layout/TaskCollaborationDialog.tsx]] exposes multi-select predecessor roles and rejects invalid graphs before dispatch. Proposal JSON may also carry stable `id` and `dependsOn` fields. Removing a role removes its id from remaining predecessor lists.

New dialog defaults for role, responsibility, and shared context are created in the active application locale. Existing draft assignments remain authoritative and are copied without translation or rewriting when the dialog opens.

[[src/renderer/src/screens/Layout/TaskCollaborationWorkspace.tsx]] presents the saved assignment and startup progress in the active locale while preserving Runtime names, project names, role assignments, and collaboration state as stored data.

[[src/shared/task-collaboration-proposals.ts#anchorTaskCollaborationCoordinator]] anchors project-lead, planning/orchestration and acceptance assignments to the Runtime that owns the conversation. A proposal can still select other Runtimes for implementation and independent review, but it cannot silently replace the user's addressed lead with another agent. If the lead owns an explicit terminal acceptance node, that node is the final review and no duplicate synthetic lead pass is appended.

[[src/shared/task-collaboration-proposals.ts#orderTaskCollaborationAssignments]] keeps coordinator roles before implementation and review roles even when the Runtime catalog is alphabetized or registered in another order. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx#collaborationRolePrompt]] instructs remote final reviewers to use the desktop's verified artifact evidence instead of probing a different filesystem. The user-facing completion marker is `[交付物]`; [[src/main/runtime-delivery.ts#verifyLocalDeliveryArtifacts]] still accepts the legacy `[交付契约]` marker for existing conversations. [[src/main/task-collaboration-store.ts#artifacts]] and [[src/main/task-collaboration-store.ts#timeline]] preserve delivery facts, retry metadata, and the audit trail across reloads. [[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#identityForMessage]] and [[src/renderer/src/screens/Chat/MessageList.tsx#messageIdentity]] carry the producing Runtime's name, avatar, colour, and role into durable and live message rows.

Durable collaboration traces are provider evidence, not fabricated chain-of-thought. [[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeConversationToChatMessages]] removes a remote `reasoning.summary` that merely mirrors the final answer. When a provider supplies tools but no reasoning summary, or only lifecycle/final events, the transcript adds a Runtime-owned “思考记录未上报” row that states exactly what is missing while retaining every event that was actually received. A non-avatar system card cannot consume the following answer's avatar slot. Claude Code `thinking` content blocks are promoted to real progress rows when the CLI provides them; their absence remains explicit rather than synthesized.

The collaboration overview is a compact bottom-right dashboard rather than three full-width rows before the first user message. It uses the settings/chat typography scale, remains collapsed by default, and preserves the role-avatar intervention entry points, artifact recovery actions and audit timeline. Its close control replaces the dashboard with a compact “协作看板” trigger at the same edge, so the user can hide and restore the whole overlay without losing execution state.

OpenCode tool rows are provider evidence, not generic activity placeholders. ACP `tool_call` snapshots are correlated by `callId` and retain the stable tool name, redacted relative-path arguments, output, and failure detail; repeated snapshots are merged at both the main-process archive boundary and the Renderer message boundary. OpenCode output chunks bypass the Hermes fallback event. Generic records already archived before this fix remain unchanged because their ACP fields were never persisted; rerun the task after launching the current Agents One build to obtain the structured trace.

## Regression coverage

Adapter tests protect both the quiet transcript and the actual artifact output path.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.test.ts]] verifies that error, artifact, and workspace-authorization lifecycle notices are omitted while genuine reasoning and hydrated image artifacts remain. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx]] protects progressive collaboration events, terminal snapshot merging, avatar-triggered pause, repeated target-only guided turns, shared response context, session reuse, explicit downstream resume, collaboration consent, remote-native workspace semantics, and model-label continuity; MessageList and file-component tests protect per-agent identity, avatar routing, quiet typing state, and local artifact actions.

The DAG regression holds two sibling Runtime runs open, asserts both Runtime identities and running states are simultaneously visible, and confirms the join is not dispatched until both siblings succeed. Shared graph tests additionally protect coordinator anchoring, legacy serial compatibility, parallel layers, multi-input joins, descendants, missing dependencies and cycle rejection.
