# Runtime Chat Rendering

Runtime conversations reuse the native chat message union so every agent gets the same reasoning, tool, attachment, and media presentation without exposing control-plane noise as conversation content.

## Event presentation boundary

The renderer adapts durable runtime events without changing their stored records or main-process contracts.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeEventMessages]] keeps reasoning, tool calls, tool results, and cancellation feedback visible. Error and timeout events may still mark a matching tool call as failed, but they do not create standalone system cards; artifact-publication events also do not create notice cards. Workspace Grant creation/absence messages are platform lifecycle state rather than model reasoning, so current and already-persisted copies are filtered from the visible thought rows. Diagnostics and artifact metadata remain available to their other consumers.

## Collaboration proposal control turn

An explicit multi-agent request must produce a user-confirmable platform proposal before any agent performs workspace work.

[[src/shared/task-collaboration-proposals.ts#taskCollaborationProposalProtocol]] is placed before the current user request by [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]]. It requires an explicit multi-agent request, named role split, or confirmation-UI retry to emit one proposal and then stop; the assistant must not inspect or modify the workspace first.

[[src/shared/task-collaboration-proposals.ts#hasValidTaskCollaborationProposal]] validates every assignment against the enabled runtime allow-list. A valid proposal counts as a control-plane outcome in [[src/main/agent-runtimes.ts#hasRemoteWorkspaceOutcome]], so the Gateway may finish that planning turn without a Workspace audit entry or artifact; invalid and partial proposals do not bypass the existing evidence guard.

## Artifact rendering

Real artifacts are rendered from execution metadata rather than from publication notices.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.ts#runtimeConversationMessage]] converts image artifacts into local `MEDIA` tokens and non-image files into attachments. Hiding artifact-publication cards therefore does not hide images or downloadable files.

## Regression coverage

Adapter tests protect both the quiet transcript and the actual artifact output path.

[[src/renderer/src/screens/RuntimeChat/runtimeChatMessageAdapter.test.ts]] verifies that error, artifact, and workspace-authorization lifecycle notices are omitted while genuine reasoning and hydrated image artifacts remain. Proposal parser, prompt ordering, confirmation-card rendering, and Gateway control-outcome tests protect the collaboration boundary.
