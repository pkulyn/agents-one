# Runtime Chat Rendering

Runtime conversations reuse the native chat message union so every agent gets the same reasoning, tool, attachment, and media presentation without exposing control-plane noise as conversation content.

## Event presentation boundary

The renderer adapts durable runtime events without changing their stored records or main-process contracts.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeEventMessages]] keeps reasoning, tool calls, tool results, and cancellation feedback visible. Error and timeout events may still mark a matching tool call as failed, but they do not create standalone system cards; artifact-publication events also do not create notice cards. Workspace Grant creation/absence messages are platform lifecycle state rather than model reasoning, so current and already-persisted copies are filtered from the visible thought rows. Diagnostics and artifact metadata remain available to their other consumers.

## Collaboration proposal control turn

An explicit multi-agent request must produce a user-confirmable platform proposal before any agent performs workspace work, without making the confirmation UI depend on a model completing hidden control syntax.

[[src/shared/task-collaboration-proposals.ts#createExplicitTaskCollaborationProposal]] recognizes an explicit collaboration/coordination request only when at least two registered runtimes have `负责`/`承担` responsibilities, resolves names and aliases against the enabled Runtime catalog, and creates the proposal locally. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] persists that normal agent control message and renders the existing confirmation card without starting a remote run. The current coordinator is always included in the trusted catalog even if the caller's catalog map omitted it.

Requests that do not provide a complete named split still use [[src/shared/task-collaboration-proposals.ts#taskCollaborationProposalProtocol]] before the current user request. This keeps open-ended planning available while the deterministic path protects the common “你负责编排、Pi 负责执行、Claude 负责复核” flow from reasoning-event truncation or missing final output.

[[src/shared/task-collaboration-proposals.ts#hasValidTaskCollaborationProposal]] validates every assignment against the enabled runtime allow-list. A valid proposal counts as a control-plane outcome in [[src/main/agent-runtimes.ts#hasRemoteWorkspaceOutcome]], so the Gateway may finish that planning turn without a Workspace audit entry or artifact; invalid and partial proposals do not bypass the existing evidence guard.

## Artifact rendering

Real artifacts are rendered from execution metadata rather than from publication notices.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeConversationMessage]] converts image artifacts into local `MEDIA` tokens and non-image files into attachments. Hiding artifact-publication cards therefore does not hide images or downloadable files.

## Regression coverage

Adapter tests protect both the quiet transcript and the actual artifact output path.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.test.ts]] verifies that error, artifact, and workspace-authorization lifecycle notices are omitted while genuine reasoning and hydrated image artifacts remain. Proposal parser, prompt ordering, confirmation-card rendering, and Gateway control-outcome tests protect the collaboration boundary.
