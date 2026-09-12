export default {
  scrollToLatest: "Jump to latest message",
  skills: {
    title: "Discovered Skills",
    note: "Metadata only. Agents One does not load or execute these Skills in the main process.",
    empty: "No displayable Skills were found.",
  },
  proposal: {
    aria: "Agent collaboration suggestion",
    title: "Multi-agent collaboration suggested",
    adjust: "Adjust collaboration plan",
  },
  commands: {
    new: "Start a new Runtime conversation",
    clear: "Clear and start a new Runtime conversation",
    branch: "Create a read-only analysis branch from this conversation",
    branchHint: "Optional branch name",
    skills: "View the source and trust information for discovered Skills",
  },
  progress: {
    preparing: "Thinking and preparing to execute…",
    agentPreparing: "{{agent}} is thinking and preparing to execute…",
  },
  feedback: {
    newConversation: "New conversation",
    branchRequiresMessage:
      "Send and save at least one conversation message before creating a branch.",
    branchFromReply:
      "Continue from the selected reply; retain only user-visible messages and execution summaries.",
    branchFromConversation:
      "Continue from this conversation; retain only user-visible messages and execution summaries.",
    branchFailed: "Could not create the conversation branch.",
    commandBusy:
      "The previous Runtime command is still running. Do not submit it again.",
    commandRequired: "Enter a complete slash command.",
    skillsLoadFailed:
      "Could not read local Skill metadata. No Skill was executed.",
    compactPending:
      "A context compaction request is already awaiting confirmation.",
    attachmentsRejected:
      "/{{command}} does not accept attachments. Your input was preserved.",
    commandApiUnavailable:
      "This app version does not provide the Runtime command control interface.",
    commandFailed: "The Runtime command failed.",
    emptyPrompt: "The Runtime command returned an empty prompt template.",
    commandNeedsInput: "This Runtime command needs further confirmation.",
    commandComplete: "Runtime command completed.",
    queuedFollowUp:
      "This Runtime does not support mid-run steering. The message will be sent as a follow-up after the current run finishes.",
    steeringUnavailable:
      "This Runtime did not declare mid-run steering support. The message was preserved without being sent or interrupting the task.",
    readOnlyBranch:
      "This is a read-only analysis branch. Writing requires a separate implementation branch with its own worktree. The message was not sent.",
    fullAccessRequiresProject:
      "Select a project folder before using full access.",
    collaborationSaveFailed:
      "Could not save the collaboration plan. Try again later.",
    currentUserRequest: "Current user request:\n{{prompt}}",
    taskFailed: "Task request failed.",
    noFinalAfterEvents:
      "The agent ended this turn during tool use or reasoning without submitting a final response. The task is not considered complete; use Continue to request a final response, or submit it again.",
    noFinal:
      "The agent did not return a displayable final response for this turn.",
    failureWithoutDetail:
      "The task failed, but the agent did not return a detailed error.",
  },
  transcript: {
    user: "User",
    agent: "Agent",
    intro:
      "Here is the recent context from this conversation. Continue your response using it.",
    current: "Current user message: {{prompt}}",
    entry: "{{role}}: {{content}}",
  },
  events: {
    noDetail: "The Runtime did not provide details.",
    cancelled: "Task cancelled",
    traceUnavailable: "Reasoning trace unavailable",
    toolsWithoutReasoning:
      "The agent Runtime reported tool calls for this turn but did not provide a displayable reasoning summary.",
    lifecycleOnly:
      "The agent Runtime returned only lifecycle events and a final response, without a displayable reasoning summary or tool-call events.",
  },
  close: "Close",
  cancel: "Cancel",
  model: {
    picker: "Choose a model for this conversation",
    title: "Model",
    scope: "Applies only to this conversation and does not change defaults",
    list: "Model list",
    current: "{{model}} (current conversation)",
    empty: "This Runtime did not return any switchable models.",
    confirm: "Switch model",
    unavailable: "Model unavailable",
    loading: "Loading available models",
    switching: "Switching model: {{model}}",
    label: "Model: {{model}}",
    loadingTitle: "Loading this Runtime's model list…",
    switchingTitle: "Switching to model: {{model}}…",
    switchTitle: "Model: {{model}}; click to switch the conversation model",
    choose: "Choose a model for this conversation",
    noMetadata: "The remote agent did not provide model metadata",
  },
  thinking: {
    picker: "Choose a reasoning level for this conversation",
    title: "Reasoning",
    scope: "Only levels supported by the current Pi model are shown",
    list: "Reasoning level list",
    option: "{{label}} ({{level}})",
    empty: "The current Pi model did not declare switchable reasoning levels.",
    confirm: "Switch reasoning level",
    auto: "Auto",
    level: "Reasoning level: {{level}}",
    busyLabel:
      "Reasoning level: {{level}}; switch after the current task finishes",
    loading: "Loading reasoning levels",
    switching: "Switching reasoning level: {{level}}",
    busyTitle:
      "The current task is running. You can switch reasoning levels after it finishes.",
    loadingTitle: "Loading reasoning levels supported by the current Pi model…",
    switchingTitle: "Switching the conversation reasoning level…",
    switchTitle:
      "Reasoning is determined by the current {{runtime}} model; click to view or switch",
    openCodeLabel:
      "Reasoning level: Auto; OpenCode ACP did not provide switchable options",
    openCodeTitle:
      "OpenCode ACP did not declare switchable reasoning levels. The current model controls reasoning automatically.",
    levels: {
      off: "Off",
      minimal: "Minimal",
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra high",
      max: "Maximum",
    },
  },
  compact: {
    dialog: "Confirm conversation context compaction",
    title: "Compact this conversation's context?",
    description:
      "This calls the Runtime's native compaction feature and replaces conversation history with a summary.",
    focus: "Keep focus on: {{instructions}}",
    confirm: "Compact context",
  },
  cancelResume: {
    dialog: "Confirm stop and resume with a new message",
    title: "Stop the current run and resume with a new message?",
    description:
      "This Runtime does not support native mid-run steering. It will be cancelled only after confirmation, then the same conversation will continue with the new message.",
    confirm: "Stop and continue",
  },
  webAction: {
    required: "{{provider}} needs you to complete an action",
    open: "Open {{provider}} window",
    continue: "I've finished; continue",
  },
  permissions: {
    manage: "Manage permissions for this task",
    auto: "Auto",
    readOnly: "Read only",
    fullAccess: "Full access",
    autoHint: "Can read and write, but cannot move or delete files",
    readOnlyHint: "Can view the project and attachments without changing files",
    unavailable: "This Runtime did not declare usable write permissions",
    remoteFullHint:
      "Full access on the remote host; local projects require separate authorization",
    fullHint: "Can create, edit, move, or delete project files",
  },
  isolation: {
    worktree: "Worktree branch",
    container: "Container",
    remote: "Remote execution",
    host: "Local execution",
    boundary: "Execution boundary: {{level}}",
  },
  webPreview: {
    show: "Show web preview",
    hide: "Hide web preview",
  },
  collaboration: {
    dashboard: "Collaboration dashboard",
    dashboardAria: "Agent collaboration dashboard",
    showDashboard: "Show collaboration dashboard",
    hideDashboard: "Hide collaboration dashboard",
    implementationGuidance:
      "Re-implement based on the acceptance result and publish a complete deliverable with its path, SHA-256, source machine, and change summary.",
    intervention: "Role intervention",
    interveneRole: "Intervene: {{role}}",
    closeIntervention: "Close role intervention",
    currentStatus: "Current status: {{status}}",
    status: {
      running: "Running",
      paused: "Paused",
      waiting: "Waiting for input",
      handedOff: "Handed off",
      pending: "Pending",
    },
    you: "You · {{visibility}}",
    shared: "Shared",
    private: "This role only",
    instructionPlaceholder:
      "Describe what to correct, available materials, or handling requirements…",
    instructionLabel: "Instruction for the current role",
    rolePermission: "Role permission",
    inheritPermission: "Inherit task permission (current: {{permission}})",
    fullAccessOption:
      "Full access (create and edit; deletion requires confirmation)",
    shareHint:
      "Share with the collaboration so later roles can read this exchange",
    currentAgent: "Current agent",
    reassignRole: "Reassign current role",
    pauseRole: "Pause this role",
    saveInstruction: "Save instruction",
    communicating: "Communicating…",
    sendToAgent: "Send to this agent",
    continueTasks: "Continue downstream tasks",
    briefRequired:
      "Send and save the initial task brief before the platform can safely resume this role.",
  },
  collaborationRun: {
    unrecoverable:
      "This run cannot be recovered, possibly because the desktop app restarted while it was running. Send the task again in this conversation.",
    singleAgent:
      "This turn was handled as a single-agent task; collaboration was not started.",
    persistenceFailed:
      "The response was received, but saving the local conversation record failed. The run itself completed normally.",
    defaultBrief: "Complete the task according to the collaboration plan.",
    finalReviewRole: "{{role}} · Final acceptance summary",
    finalReviewResponsibility:
      "Summarize final acceptance using only the deliverables and acceptance evidence registered by the platform; do not redo another role's work.",
    finalReviewContext: "All handoffs, deliverables, and acceptance evidence",
    missingResumeRole:
      "The collaboration role to resume no longer exists. Reconfigure the collaboration roles.",
    dependencyIncomplete:
      "A prerequisite role has not completed. This role cannot continue without its handoff.",
    agentRequired:
      "Collaboration requires at least one role with an assigned agent.",
    permissionPreflightFailed: "{{role}} failed permission preflight",
    implementationPermissionBlocked:
      "An implementation role lacks permission. Waiting for the collaboration configuration to be adjusted.",
    notStarted: "Collaboration did not start:\n{{reason}}",
    linkedProject: "Linked project",
    workspacePreflightFailed: "{{role}} failed workspace preflight",
    workspaceBlocked:
      "Workspace reachability preflight failed. Waiting for the collaboration configuration to be adjusted.",
    evidenceGenerationFailed:
      "Could not create the read-only project evidence bundle.",
    evidenceGenerated: "Read-only project evidence bundle created",
    evidenceRecipients: "{{name}}; sent only to {{roles}}",
    evidencePrepareFailed:
      "Could not prepare the read-only project evidence bundle.",
    roleEvidenceFailed: "Could not prepare the evidence bundle for {{role}}",
    evidenceBlocked:
      "Preparing the read-only project evidence bundle failed. Waiting for user input.",
    evidenceUnsafe:
      "Collaboration did not start: the read-only project evidence bundle required by remote roles could not be created safely. {{reason}}",
    workspacePassed: "Workspace reachability preflight passed",
    joinBlocked:
      "A prerequisite branch did not succeed, so the join role was not started.",
    roleNoAgent: "No usable agent is configured for {{role}}.",
    roleParallelStarted: "{{role}} started in parallel",
    pausedByUser: "The user paused this role. Waiting for input.",
    cancelled: "The collaboration task was cancelled.",
    roleIncomplete: "{{role}} did not complete.",
    roleWaitingReason:
      "{{role}} did not complete and is waiting for input: {{reason}}",
    deliveryPublished: "{{role}} published delivery evidence",
    noVerifiableDelivery:
      "{{role}} did not publish a verifiable file or code change.",
    interventionAnswered: "{{role}} answered the intervention",
    acceptancePassed: "Final acceptance passed",
    acceptanceFailed: "Final acceptance did not pass",
    handedOff: "{{role}} handed off",
    requestFailed: "Task request failed.",
    roleStartFailed:
      "{{role}} could not start and is waiting for input: {{reason}}",
    dependencyBranchBlocked:
      "{{role}} did not succeed, so dependent branches were not started.",
    noAcceptanceRole:
      "No acceptance role was assigned, so the platform did not automatically determine whether the delivery met the requirements.",
    roleNoAgentDownstream:
      "No usable agent is configured for {{role}}; downstream roles were not started.",
    roleStarted: "{{role}} started",
    cancelledBeforeCompletion:
      "The collaboration task was cancelled before the current role completed.",
    agentRoleIncomplete: "{{agent}} did not complete the {{role}} role.",
    roleFailed: "{{role}} failed and is waiting for input.",
    verificationPublished: "{{role}} published verification evidence",
    noDeliveryDownstream:
      "{{role}} did not publish a verifiable file or code change, so downstream roles will not start. Use Intervene to add delivery requirements; if needed, change this role to Full access and retry.",
    noRealDelivery:
      "{{role}} did not deliver a real artifact and is waiting for input.",
    incompleteDelivery: "{{role}} did not publish a complete deliverable",
    deliveryDetailsPending: "{{role}} deliverable details are incomplete",
    deliveryDetailsMissing:
      "Path, SHA-256, source machine, or change summary is missing. Acceptance will mark this as low-confidence evidence.",
    acceptanceRejected: "Final acceptance failed",
    acceptanceReview: "Final acceptance requires manual review",
    guidedReplyComplete:
      "{{role}} completed the directed conversation. Waiting for user confirmation before continuing.",
    autoReassigned:
      "{{role}} did not pass and was automatically reassigned to {{implementationRole}}",
    autoCorrectionLimit:
      "The automatic correction limit was reached. Waiting for user intervention.",
    roleStartWaiting: "{{role}} could not start and is waiting for input.",
    visibilityShared: " (shared with collaboration)",
    visibilityPrivate: " (this role only)",
    reassignedWaiting:
      "{{role}} was reassigned. Waiting for it to complete again before continuing.",
    reassigned: "{{role}} was reassigned",
    reassignedDetail:
      "Reassigned to {{agent}}; waiting for the user to send a new directed instruction.",
    taskTitle: "Collaboration task",
    acceptanceReassignedDetail:
      "Reassigned to {{agent}}; continuing from the acceptance stage.",
    acceptanceReassignFailed: "Could not reassign acceptance.",
    acceptanceRecordPreserved:
      "Acceptance reassignment failed; the original collaboration record was preserved: {{reason}}",
  },
  artifactRetry: {
    label: "Resync remote artifacts",
    title: "Some remote artifacts are temporarily unavailable",
    description:
      "The task has completed. You can resync these artifacts separately without rerunning it.",
    unnamed: "Unnamed artifact",
    actionLabel: "Resync artifact {{name}}",
    syncing: "Syncing…",
    retry: "Resync",
    runUnavailable:
      "The current run is unavailable, so the artifact cannot be resynced.",
    success:
      "The artifact was resynced and can be opened from the attachments on this response.",
    failed: "Could not resync the artifact. Try again later.",
  },
  linkedProject: "Linked project",
} as const;
