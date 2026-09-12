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
  artifactRetry: {
    label: "Resync remote artifacts",
    title: "Some remote artifacts are temporarily unavailable",
    description:
      "The task has completed. You can resync these artifacts separately without rerunning it.",
    unnamed: "Unnamed artifact",
    actionLabel: "Resync artifact {{name}}",
    syncing: "Syncing…",
    retry: "Resync",
  },
  linkedProject: "Linked project",
} as const;
