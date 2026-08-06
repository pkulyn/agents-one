# Runtime Chat Rendering

Runtime conversations reuse the native chat message union so every agent gets the same reasoning, tool, attachment, and media presentation without exposing control-plane noise as conversation content.

## Event presentation boundary

The renderer adapts durable runtime events without changing their stored records or main-process contracts.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeEventMessages]] keeps reasoning, tool calls, tool results, and cancellation feedback visible. Error and timeout events may still mark a matching tool call as failed, but they do not create standalone system cards; artifact-publication events also do not create notice cards. Workspace Grant creation/absence messages are platform lifecycle state rather than model reasoning, so current and already-persisted copies are filtered from the visible thought rows. Diagnostics and artifact metadata remain available to their other consumers.

## Collaboration proposal control turn

An explicit multi-agent request must produce a platform-validated assignment before any implementation role performs workspace work, without making startup depend on a manual configuration dialog or a model completing hidden control syntax.

[[src/shared/task-collaboration-proposals.ts#createExplicitTaskCollaborationProposal]] recognizes an explicit collaboration/coordination request only when at least two registered runtimes have `负责`/`承担` responsibilities and resolves names and aliases against the enabled Runtime catalog. [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] persists the validated assignment against the existing task, normalizes local/remote workspace access, and guarantees that the current task Runtime is the project lead. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] then reuses the single user message and starts the lead as a normal visible agent turn instead of opening the setup dialog or submitting the brief twice.

Requests that do not provide a complete named split still use [[src/shared/task-collaboration-proposals.ts#taskCollaborationProposalProtocol]] before the current user request. When the lead returns a valid proposal, that visible planning turn is reused as its handoff and Agents One automatically starts the next role; the lead is not run twice. Invalid or partial proposals remain inert and can be adjusted manually.

[[src/shared/task-collaboration-proposals.ts#hasValidTaskCollaborationProposal]] validates every assignment against the enabled runtime allow-list. A valid proposal counts as a control-plane outcome in [[src/main/agent-runtimes.ts#hasRemoteWorkspaceOutcome]], so the Gateway may finish that planning turn without a Workspace audit entry or artifact; invalid and partial proposals do not bypass the existing evidence guard.

[[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx#runCollaboration]] writes each assigned Runtime's reasoning/tool event execution and final output back into the same transcript with that Runtime's name, avatar, color, role, and assignment id. The active live rows use the currently executing Runtime identity. A modifying role cannot hand off until it publishes a Runtime-verified file or adapter-produced diff. If a review returns `不通过`, the platform removes stale evidence, injects the review conclusion into the implementation retry, and reruns implementation and review up to a bounded three total attempts; the lead's final evidence-based acceptance is the only successful terminal state. Manual pause, intervention, and reassignment remain recovery paths.

## Artifact rendering

Real artifacts are rendered from execution metadata rather than from publication notices.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeConversationMessage]] converts image artifacts into local `MEDIA` tokens and non-image files into attachments. Hiding artifact-publication cards therefore does not hide images or downloadable files.

## Regression coverage

Adapter tests protect both the quiet transcript and the actual artifact output path.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.test.ts]] verifies that error, artifact, and workspace-authorization lifecycle notices are omitted while genuine reasoning and hydrated image artifacts remain. Proposal parser, automatic dispatch without duplicate user messages, verified delivery, failed-review retry, prompt ordering, optional adjustment-card rendering, and Gateway control-outcome tests protect the collaboration boundary.
