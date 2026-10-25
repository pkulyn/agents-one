# Runtime Chat Rendering

Runtime conversations reuse the native chat message union so every agent gets the same reasoning, tool, attachment, and media presentation without exposing control-plane noise as conversation content.

Only the built-in **local** Hermes Runtime may enter the legacy profile-chat renderer. Every remote Runtime, including a Hermes definition carrying an old built-in marker, stays on `RuntimeChat` and dispatches through its registered Gateway v1 runtime ID; it must never be blocked by local model readiness validation.

## Event presentation boundary

The renderer adapts durable runtime events without changing their stored records or main-process contracts.

OpenCode ACP thought chunks are provider deltas rather than cumulative snapshots. [[src/main/runtime-adapters/builtin/opencode-acp.ts]] accumulates each contiguous `agent_thought_chunk` sequence into a bounded snapshot and supplies it as both summary and detail, so the existing Runtime progress upsert and renderer produce one readable thought row instead of one row per fragment. `session/new.configOptions` is the source of the actual selected OpenCode model, while `usage_update` and `session/prompt` usage are retained on `AgentRuntimeRun` and its durable execution record. Reported model metadata takes precedence over a requested/configured model in [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]], preventing an invalid or unavailable model request from being displayed as if it were used.

OpenCode is an agent client identity, not the identity of the underlying model. Its ACP prompt receives a fixed product identity constraint; model output is otherwise kept intact. This corrects model defaults that answer identity questions as Claude Code or another client without rewriting ordinary business content.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeEventMessages]] keeps reasoning, tool calls, tool results, and cancellation feedback visible. Error and timeout events may still mark a matching tool call as failed, but they do not create standalone system cards; artifact-publication events also do not create notice cards. Workspace Grant creation/absence messages are platform lifecycle state rather than model reasoning, so current and already-persisted copies are filtered from the visible thought rows. Diagnostics and artifact metadata remain available to their other consumers.

OpenCode's ACP tool trace is structured rather than a plain text progress line. The adapter maps `tool_call`/`tool_call_update` to the canonical tool evidence shape, including stable call id, tool name, bounded relative-path arguments, output content, and failure detail. Repeated snapshots are merged by call id in the renderer, which keeps the live and durable transcript to one tool row plus its result row. OpenCode 1.x does not currently advertise a thinking-level option through ACP; the input toolbar consequently shows `思考 自动` as a read-only provider status with an explanatory tooltip, instead of presenting levels that cannot be applied. Pi's verified native thinking picker remains unchanged.

The live typing bubble keeps only the neutral three-dot activity animation. [[src/renderer/src/screens/Chat/MessageList.tsx#MessageList]] no longer adds a separate rotating Agents One logo because that mark did not identify the responding Runtime or expose actionable state.

## OpenCode streamed Markdown and trace retention

OpenCode ACP answer and thought deltas preserve every space and newline so headings, lists, paragraphs and code indentation survive token boundaries.

[[src/main/runtime-adapters/builtin/opencode-acp.ts#agentTextDelta]] reads text content without trimming. Answer fragments flow through the output callback and produce only one message status event per turn, preventing a long answer from evicting earlier thought/tool evidence from the existing bounded Runtime and archived execution histories. Tool evidence and provider metadata keep their existing normalization.

[[tests/agent-runtimes.test.ts]] streams more than 200 unique answer deltas, then saves and reloads the execution and checks that reasoning and named tool rows remain alongside the original Markdown. [[tests/opencode-acp.test.ts]] also checks whitespace-only deltas in the live output callback. Existing histories are not rewritten.

## Bounded execution trace retention

Answer-fragment events must not evict reasoning, tools or terminal evidence when a Runtime answer becomes a durable transcript.

[[src/shared/runtime-event-retention.ts#retainRuntimeEvents]] removes older message fragments before applying the existing chronological tail limit. Main uses it for both local and Gateway event appends; conversation storage uses the same policy for execution serialization. The 200-event Run and 80-event archive limits remain bounded, and process-only overflow keeps the previous tail behavior. Stored replies remain the authoritative answer text. The actual installed desktop bundle must carry both this retention policy and the OpenCode delta fix; validating a newer checkout alone does not update a separately packaged candidate.

[[tests/runtime-conversation-store.test.ts]] verifies that a trace followed by 240 answer fragments still renders reasoning and paired tools after save and reload. [[src/shared/runtime-event-retention.test.ts]] protects repeated live truncation and evidence-only overflow ordering.

## Remote reasoning and sent attachments

RuntimeChat keeps remote reasoning text and the files that accompanied each user turn visible in the saved transcript.

[[src/shared/agent-event-stream.ts#agentEventTimelineEntry]] maps the complete Gateway `reasoning.summary` text into a bounded detail field, including older Hers events that carry the thought in `data.text`. [[src/main/agent-runtimes.ts]] retains up to 16,000 characters of event detail, and [[src/main/runtime-conversation-store.ts#cleanRuntimeEvent]] preserves that detail when the conversation is reopened.

[[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] copies only attachment identity, type, name, and size into the user message. [[src/main/runtime-conversation-store.ts#cleanMessageAttachments]] validates and persists those display fields while excluding file contents, image data, and local paths. [[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeConversationMessage]] passes them to the same [[src/renderer/src/components/AttachmentChip.tsx#AttachmentChip]] used by the composer. A fixed 180-by-64-pixel card shows an image thumbnail when available or a type icon otherwise, plus a truncated filename.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.test.ts]] verifies transcript mapping, and [[src/main/runtime-conversation-store.test.ts]] verifies safe metadata persistence and full reasoning-detail round trips.

## OpenCode historical trace recovery

A fixed adapter cannot recreate evidence already evicted from an old execution, but a verified native OpenCode session export can supply the original reasoning and tool records for a targeted repair.

Recovery matches each native assistant turn through its parent user ID, original run time bounds and exact final-answer text after whitespace normalization. Verified native parts pass through [[src/main/runtime-adapters/builtin/opencode-acp.ts#startOpenCodeProcess]] for the existing bounded, redacted event shape. Repeated answer-fragment events are replaced by one status event so restored reasoning and tools fit the persisted execution limit.

Before writing, recovery saves a private backup and uses the existing [[src/main/runtime-conversation-store.ts#saveRuntimeConversation]] revision check. Only the matched reply execution events change; message identities, user/assistant text, model metadata and other conversations remain intact. The desktop must be validated through its actual IPC dispatch and visible original chat, because an isolated adapter check does not prove that a running Main process has loaded a new build.

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

Collaboration permission and workspace preflight failures are user-visible RuntimeChat system messages. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] passes the active UI translator into those preflight helpers and into timeline workspace labels. Their exported fallback behavior remains Chinese for legacy/non-rendered callers; role-name matchers and structured collaboration markers remain bilingual compatibility logic rather than UI copy.

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

Gateway attachment persistence waits for the tested conversation's terminal checkpoint, asserting its unique conversation ID, Runtime, user/agent messages and cleared active Run. Independent asynchronous conversations may save in any order, so the test does not infer persistence from rendered text or a global last-call ordering.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.test.ts]] verifies that error, artifact, and workspace-authorization lifecycle notices are omitted while genuine reasoning and hydrated image artifacts remain. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx]] protects progressive collaboration events, terminal snapshot merging, avatar-triggered pause, repeated target-only guided turns, shared response context, session reuse, explicit downstream resume, collaboration consent, remote-native workspace semantics, and model-label continuity; MessageList and file-component tests protect per-agent identity, avatar routing, quiet typing state, and local artifact actions.

The DAG regression holds two sibling Runtime runs open, asserts both Runtime identities and running states are simultaneously visible, and confirms the join is not dispatched until both siblings succeed. Shared graph tests additionally protect coordinator anchoring, legacy serial compatibility, parallel layers, multi-input joins, descendants, missing dependencies and cycle rejection.

## Pi read-only tool boundary

Pi read-only conversations retain file readers and query tools even without a selected project; a native tool-call hook blocks mutations rather than disabling every tool.

[[src/main/pi-runtime.ts#piExecArgs]] restricts analysis to read, grep, find and ls, adding native write/edit only for automatic runs. Restricted processes disable extension discovery and built-in MCP, exclude terminal/codemode/MCP tools, and explicitly load only the Main-generated permission hook. Full access retains the native resource configuration.

The generated [[src/main/pi-runtime.ts#piReadOnlyExtensionSource]] authorizes exact native tool names and rejects all other direct or nested calls, regardless of a custom tool readOnlyHint. A tools allowlist alone does not disable MCP in Pi. User instructions and skills may still provide context, but cannot grant extra tools. This is native tool capability control, not an operating-system filesystem sandbox; write-path isolation and each other Runtime require independent enforcement and verification.

## Pi strict CLI capability gate

Restricted Pi tasks require a reviewed native CLI version before any task content, attachments or workspace preparation reaches the executor. Unknown versions fail with a fixed diagnostic.

[[src/main/pi-capabilities.ts#verifyPiStrictCapabilities]] resolves and binds the actual command and wrapper entry, queries version in a temporary isolated home/config with minimal OS environment and offline resource-disabled flags, and accepts only Pi 1.4.0 whose native policy was verified. Each task rechecks file identity after metadata and before dispatch without a cached approval. Main checks task cancellation across startup waits so Stop cannot be followed by delayed prompt dispatch. Full access retains its explicit project requirement. Version metadata is compatibility evidence for a trusted user-selected CLI; it cannot sandbox a malicious binary or concurrent same-user filesystem changes.

## Pi restricted task environment

Analysis and automatic task processes omit inherited loader and runtime redirect controls while retaining provider credentials, proxy and certificate data. Explicit full access keeps native environment semantics.

[[src/main/pi-runtime.ts#piChildEnvironment]] filters execution-oriented environment names case-insensitively for restricted task spawns, including Node preloads/search paths, native dynamic loaders, package redirects and interpreter startup controls. It returns a new object and does not rewrite the parent process or saved settings. Metadata probes retain their separately isolated environment; out-of-band native controls retain their existing contract. This prevents inherited preload execution before a tool hook, but does not prove that command-backed native credentials or external search-tool resolution are contained.

## Pi non-executing native credentials

Restricted tasks reject command-backed native credentials and request headers before preparing or sending a prompt. Literal values, environment templates and OAuth credentials remain native data.

[[src/main/pi-config-policy.ts#assertPiNonExecutingConfig]] reads stable regular-file descriptors with an 8 MiB limit per native models/auth file and fixed diagnostics. It follows reviewed Pi 1.4 model line-comment/trailing-comma semantics and rejects commands only in native executable fields: provider keys, provider/model/override headers and stored API keys. Main rechecks before task launch without rewriting credentials or unknown fields. Native config roots stay outside automatic write authority even when relative to an implicit conversation cwd. Live OAuth updates remain native; this gate does not claim OS isolation from external same-user config edits after launch.

## Pi query process context

Restricted native helpers run from a verified empty control directory while Pi retains the selected project context. Executable lookup cannot inherit relative or project-owned PATH directories.

[[src/main/pi-query-context.ts#createPiQueryContext]] asynchronously bounds namespace discovery, canonicalizes outside helper directories and checks directory ancestry identities, pins native config and common certificate/credential paths, and reuses one empty control directory per profile. [[src/main/pi-query-context.ts#enterPiQueryContext]] is embedded in the trusted extension and rechecks that directory before every tool call. Startup refuses overlapping managed query-bin namespaces; unknown control files are preserved and refused. Initial session cwd, native grep/find behavior, staged inputs and write authority stay bound to the original project. Full access keeps its native process context; this is not attestation of installed helper binaries or an OS sandbox.

## Pi automatic write scope

Automatic native write/edit calls bind to the Main-selected directory and its physical identity. Outside, linked, ambiguous and control targets are refused before the native tool runs.

[[src/main/pi-write-boundary.ts#createPiWriteBoundary]] pins directory identity, checks the actual native context cwd, validates every existing ancestor, and rejects hardlinks, junctions, protected configuration directories and the executing CLI files. New nested ordinary files remain writable when the scope does not overlap the running CLI installation. [[src/main/pi-runtime.ts#piReadOnlyExtensionSource]] embeds this self-contained check; Main passes its actual cwd, invocation files and installation directories, including the private fallback directory for projectless conversations. Pi-specific tilde, at-prefix, file-URL and Windows shell-drive aliases are rejected to keep the checked target consistent with native resolution. Readers and staged attachment inputs retain their prior access. This guard is not an OS sandbox against a separate process racing filesystem changes.

Explicit automatic workspaces cannot overlap Electron user data, any desktop or Hermes native profile, Pi config, or the Main/CLI installation. Main resolves native Pi config tilde, shell-drive, file-URL and cwd-relative spellings; missing protected paths resolve through their nearest existing physical ancestor, and inspection failures deny writing. The implicit projectless directory alone retains its bounded temporary writes; selecting that same private path explicitly does not grant authority. Full access keeps its explicit project contract.

## Automatic permission defaults

New full-chat, tray and quick-chat conversations default to automatic permission while existing explicit selections and transport-specific authority remain intact.

[[src/shared/runtime-permissions.ts#automaticRuntimeTaskMode]] resolves automatic to safe_write for native and Gateway runtimes, including unscoped OpenCode conversations; browser agents retain their analysis-only capability. The mode reflects executable capability; a browser agent never gains local filesystem tools. Explicit mobile inspection policies and read-only analysis branches retain their enforced authority.

Mobile desktop-task policies use the same automatic mode at Owner dispatch. [[src/main/mobile-control/execution-coordinator.ts#MobileExecutionCoordinator#checkApproval]] permits a projectless automatic write only for the generated desktop-task policy; legacy project-write approvals stay project-bound. Full access is dispatched only when the current generated policy carries explicit confirmation, including on continued turns.

[[src/main/app/tray-runtime-task.ts#startTrayRuntimeTask]] persists auto instead of the former implicit analysis selection, and quick chat uses the same resolver. Main resolves omitted task modes at dispatch without rewriting saved conversations or provider configuration.

## Permission conflict feedback

Every dispatched task receives its effective permission and instructions to name blocked operations and the permission required before attempting unsupported work.

[[src/shared/runtime-permissions.ts#runtimePermissionInstruction]] distinguishes read-only, automatic safe-write, isolated implementation and full access. Read-only permits queries but no creation or mutation; automatic permits creation/editing but prohibits removing or moving original files. A deletion request under automatic must explain the restriction and request full access, rather than ending with a promise to execute.

Main adds this context for local and Gateway task dispatch. Pi native denial results carry the blocked tool and required permission back to the model, including nested calls. If safe-write restoration catches removed originals, [[src/shared/runtime-permissions.ts#runtimeRemovalBlockedMessage]] makes local adapters report an actionable failure even when the provider exits successfully; restoration text must not disappear behind a structured final answer.

## Pi reasoning preview boundary

Pi reasoning keeps a short progress summary and a separate bounded detail so long thoughts remain readable in live chat and after durable reload.

[[src/main/agent-runtimes.ts#appendOutputEvent]] preserves original whitespace in Pi thinking detail instead of reducing the entire thought to 520 preview characters. Growing snapshots with identical clipped summaries update one progress event, and shorter later snapshots cannot replace longer detail. Existing redaction and event-detail bounds still apply.

[[tests/agent-runtimes.test.ts]] streams snapshots past the preview boundary, verifies a single complete thought, saves/reloads the execution and checks the renderer's reasoning content. Earlier truncated conversation events are not rewritten automatically; their native Pi JSONL remains available for targeted recovery.

## Cross-runtime native permission enforcement

Native adapters carry read-only, automatic and full-access modes through transport-specific controls. Enforcement requires separate verification for each Runtime; deletion recovery is not an execution sandbox.

Codex retains its native read-only or workspace-write sandbox. Claude CLI analysis uses plan mode; conversational Claude SDK analysis explicitly selects plan mode and disables mutation/shell tools. OpenCode applies per-process permission overrides for edit, bash and task so native defaults cannot auto-approve these requests; ACP checks declared read/search/fetch operations in analysis and rejects declared delete/move requests in automatic. These metadata checks do not prove that an opaque command has no destructive side effects. Rejected requests produce visible permission-denied events and actionable terminal errors.

[[src/main/runtime-adapters/builtin/opencode-acp.ts#openCodePermissionEnvironment]] preserves unrelated inherited environment settings without writing provider config. [[src/main/runtime-adapters/builtin/opencode-acp.ts#openCodePermissionDenial]] decides the ACP operation boundary. [[tests/opencode-acp.test.ts]] exercises actual request/response exchanges for read, search, edit, delete and move across modes. Automatic no longer silently downgrades a native or Gateway conversation to read-only just because no desktop project was selected. Browser and remote adapters remain constrained by the capabilities and authority their service actually provides.

## ACP agent request identity preservation

ACP permission and error replies retain the original numeric or string ID, including zero and numeric strings. Coercion can leave permitted tools waiting; permission decisions and session identity stay unchanged.

## ACP turn session and deadline metadata

OpenCode reports its native session ID immediately after creation or restore, before a prompt completes. The task timeout overrides the runtime fallback deadline so both layers enforce the same turn budget.

[[src/main/runtime-adapters/builtin/opencode-acp.ts#startOpenCodeProcess]] publishes session metadata before prompting; [[src/main/agent-runtimes.ts#startAgentRuntimeTask]] records it while running, retaining continuation after cancellation or timeout. The process fixture checks both shorter and longer task deadlines, including servers without model metadata.

## OpenCode Windows system proxy inheritance

OpenCode inherits an enabled Windows manual proxy in its child process when no explicit CLI proxy is set, preventing direct-connection timeouts on systems whose desktop networking already uses a proxy.

[[src/main/runtime-adapters/builtin/opencode-acp.ts#openCodeProxyEnvironment]] preserves explicit proxy and bypass variables and existing permission settings. A bounded read-only HKCU query supplies manual proxy routes for OpenCode probes and tasks; provider files, Windows settings and other runtimes are untouched. Loopback bypass keeps ACP and local model endpoints reachable. Tests cover disabled, invalid, protocol-specific and explicitly overridden settings.

## Pi attachment output retention

Pi input image echoes must never evict a completed assistant answer from the bounded Runtime output.

[[src/main/pi-runtime.ts#piOutputFrame]] removes image payloads from JSONL output and retains assistant messages in the terminal agent_end snapshot. UTF-8 decoding and complete-line framing happen before redaction, buffering and Main callbacks, preserving parseable final messages across process chunks. The original staged input remains intact; binary data is input evidence rather than conversation output. [[tests/pi-attachment-output.test.ts]] reproduces a multi-megabyte terminal echo and split Chinese UTF-8 bytes through a real subprocess and validates the same final-answer summary used by chat.

## OpenCode attachment transport

OpenCode receives each explicitly attached file through ACP content blocks backed by validated per-task copies, on both new and resumed sessions.

[[src/main/runtime-adapters/builtin/opencode-acp.ts#startOpenCodeProcess]] reuses input staging and sends images as image blocks, UTF-8 text as embedded resources, and documents as file resource links. A manifest names only staged copies and the native reader can open those exact files. Main retains input hashes and metadata on the Run without publishing inputs as output artifacts or changing workspace permissions. ACP process fixtures verify contents from staged paths; the Main regression checks dispatch, completion, input evidence and durable reply rendering.

[[src/main/runtime-adapters/builtin/opencode-acp.ts#openCodeWindowsEnvironment]] normalizes launcher-escaped Windows path variables only in the child environment and supplies standard executable suffixes if PATHEXT is absent. Explicit suffixes, proxy settings, permissions and unrelated environment values remain intact; provider and OS configuration are not rewritten.

When OpenCode has no explicit shell override, [[src/main/runtime-adapters/builtin/opencode-acp.ts#openCodeShellEnvironment]] probes the installed Windows shell with a bounded no-profile command. A bundled pwsh that aborts on unsupported CET is skipped in favor of a working Windows PowerShell or Git Bash. The choice is process-local, preserves an explicit SHELL, and leaves tool permission checks intact.

## Claude and Codex attachment regression

Claude Code and Codex preserve explicit attachment copies and complete final answers on both new and continued conversations, including when Chinese output spans process chunks.

Claude attachments use the CLI staged-directory route, including read-only conversations; they never enter the SDK-only text control path. Codex grants the staged directory and passes image paths through native --image arguments, placing resumed images on exec resume. [[tests/claude-codex-attachments.test.ts]] launches process fixtures that read the copied bytes, emit a megabyte tool result and split a Chinese UTF-8 character in the final JSON event, then checks streaming and completed summaries plus the original session continuation.

[[src/main/claude-code-runtime.ts#startClaudeCodeProcess]] and [[src/main/codex-runtime.ts#startCodexProcess]] decode stdout and stderr independently with incremental UTF-8 decoders and flush them on close before terminal summarization. This prevents replacement characters at valid byte boundaries without changing permissions, native arguments, staged content or output limits.

Codex desktop execution additionally uses [[src/main/codex-runtime.ts#codexDesktopEnvironment]] to probe pwsh binaries in its inherited PATH. Only directories whose pwsh reports the known CET incompatibility are excluded in the child environment, letting native shell discovery choose a healthy installed shell. Other probe failures, healthy candidates and all non-shell settings are retained. Mobile inspection and controlled project-write processes keep their existing verified environment and identity unchanged.

## Workspace recovery failures

A safe-write recovery failure preserves the original backup and produces a Runtime error instead of a successful completion or a hanging process result.

[[src/main/workspace-protection.ts#protectWorkspaceFromRemoval]] attempts each missing original independently. Locked paths, replacement directories and symlink parents retain the backup for retry. Only a complete recovery disposes it. Claude Code, Codex, Pi and OpenCode propagate the recovery error in their ordinary completion result; this fallback does not establish operating-system sandboxing.

## ACP task-scoped permission decisions

OpenCode permission replies preserve the original numeric or string RPC ID and approve only an explicit one-time option bound to the current native session. Permanent or ambiguous choices never substitute for one-time authority.

Both local and remote clients reject mismatched or missing sessions, duplicate option IDs, unknown kinds, invalid identifiers and automatic native mode switches. Rejection is reported in task evidence and terminal state. Protocol subprocess regressions verify execution markers, persistent-grant markers, valid edits and response identity; these gates do not establish an operating-system sandbox or certify arbitrary script side effects.
