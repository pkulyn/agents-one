export default {
  recovery: {
    title: "Review uncertain writes",
    description:
      "Review uncertain file writes from completed tasks. Releasing the block allows new tasks; it does not retry the old command or change its result.",
    refresh: "Refresh write review",
    empty: "No uncertain writes available for review",
    run: "Original task",
    unknownRun: "The original task needs further review",
    acknowledge:
      "I reviewed the file and confirm releasing this task's write block",
    release: "Release write block",
    capacityExceeded:
      "Some uncertain writes could not be loaded. Review them further on the desktop.",
    restartHint:
      "Restarted locks require intact writer termination proof and the original host to have exited. Locks without proof need further review.",
    states: {
      matches_requested:
        "The file matches the requested content; the original execution remains uncertain.",
      matches_previous:
        "The file matches its previous content; this does not prove the write never happened.",
      changed: "The file has other changes. Review the project file first.",
      unavailable:
        "The file cannot currently be read. Review the project file first.",
      blocked: "The write block cannot currently be released.",
    },
    errors: {
      run_active:
        "The original task is still running. Refresh after it finishes.",
      run_unavailable:
        "The original task state cannot be confirmed. Further review is required.",
      requires_owner_action:
        "The project, audit or lock changed. Further desktop review is required.",
      revision_conflict:
        "The file or audit changed after review. Refresh and confirm again.",
      profile_inactive: "The active profile changed. Reopen settings.",
      restore_write_locked:
        "Data restoration is in progress. The block cannot be released yet.",
      scope_denied:
        "This window cannot perform this operation. Reopen settings.",
    },
  },
  title: "Phone connection",
  pairedTasksHint: "After pairing, manage conversations and schedules on your phone and start tasks with agents configured on this computer.",
  advancedRecovery: "Advanced: task recovery",
  connectionSetup: "Connection service settings",
  description:
    "Pair the Android app and manage connected phones. Choose the agent, project and execution mode when starting a task on your phone.",
  endpoint: "Connection service HTTPS address",
  token: "Owner management key",
  save: "Save and connect",
  refresh: "Refresh",
  loading: "Connecting…",
  setup:
    "Enter the HTTPS service address and the separate Owner key provided by your service administrator. The key is protected by your operating system.",
  enabled: "Allow phone connections",
  disabled: "Phone access is disabled",
  enabledHint:
    "Disabling blocks phone requests and expires pending invitations. Existing tasks and schedules keep running.",
  owner: "Data space",
  ready: "Connection management is available",
  taskPending:
    "The desktop task channel is not ready. Keep the desktop running and check its connection.",
  invite: "Create invitation",
  invitation: "Pairing invitation",
  expiry: "Expires",
  expired: "This invitation has expired. Create another one.",
  copy: "Copy invitation",
  copied: "Copied",
  copyFailed: "Unable to copy. Select and copy the invitation manually.",
  instructions:
    "In the Android app, open Account, enter this HTTPS address and invitation, then compare the verification phrase on both screens before approving.",
  pending: "Waiting for approval",
  noPending: "No pairing requests",
  phrase: "Verification phrase",
  match: "I checked that the phone displays this phrase",
  permissions: "Access permissions",
  scopeHint:
    "Applies to this entire data space. Grant only the actions this device needs.",
  approve: "Approve device",
  reject: "Reject",
  devices: "Paired devices",
  noDevices: "No paired devices",
  revoked: "Revoked",
  active: "Authorized",
  deviceExpired: "Expired",
  lastSeen: "Last credential activity",
  revoke: "Revoke access",
  revokeConfirm:
    "Revoke access for {{name}}? Existing tasks and schedules will continue.",
  confirm: "Confirm revocation",
  cancel: "Cancel",
  scopes: {
    conversation_read: "View conversations",
    conversation_create: "Create conversations",
    conversation_advance: "Continue conversations",
    conversation_manage: "Manage conversations",
    schedule_read: "View schedules",
    schedule_manage: "Manage schedules",
    schedule_trigger: "Run schedules",
    schedule_cancel: "Stop schedule runs",
    artifact_read: "View files",
  },
  errors: {
    generic: "Unable to complete this action. Check the service and refresh.",
    invalid_input: "Check the HTTPS address, key and selected permissions.",
    scope_denied: "The Owner management key is invalid or has no access.",
    secure_storage_unavailable:
      "Operating system credential protection is unavailable. No key was saved.",
    protocol_incompatible:
      "This service does not support the required phone management protocol.",
    connection_binding_conflict:
      "The saved connection belongs to a different data space. Restore that service binding before changing it.",
    invitation_expired:
      "The pairing request expired or was already handled. Refresh the list.",
    service_unavailable:
      "Cannot reach the phone connection service. Check its address and availability.",
  },
  execution: {
    title: "Phone task execution policies",
    description:
      "Approve the runtime, project and execution capabilities available to phones. Changes to execution configuration or project directories invalidate approval. The phone also needs the corresponding device permissions.",
    selection: "Execution scope",
    runtime: "Runtime",
    chooseRuntime: "Choose a runtime",
    project: "Project",
    noProject: "No project binding",
    missingRuntime: "Runtime unavailable",
    missingProject: "Project unavailable",
    mode: "Execution mode",
    inspect: "Conversation and read-only analysis",
    project_write: "Safe project writes",
    unavailable: "Unavailable",
    unattended: "Allow unattended scheduled execution",
    unattendedHint:
      "Approval requires an executor that enforces this capability.",
    review: "Check execution capabilities",
    verified: "Current execution capabilities verified",
    unverified: "Capabilities unverified; approval unavailable",
    expired: "This check expired. Check again.",
    reviewExpiry: "Check expires",
    confirmApproval: "I approve the execution scope above",
    approve: "Approve execution policy",
    alreadyApproved: "This scope already has an active policy.",
    refresh: "Refresh execution policies",
    approved: "Existing execution policies",
    noPolicies: "No execution policies approved",
    active: "Currently valid",
    inactive: "Invalid; check again",
    revoke: "Revoke execution policy",
    revokeConfirm:
      "Revocation blocks new tasks using this policy. Existing tasks continue.",
    confirmRevoke: "Confirm policy revocation",
    cancel: "Cancel",
    errors: {
      invalid_input: "Select a valid runtime, project and execution scope.",
      profile_inactive: "The active profile changed. Reopen settings.",
      restore_write_locked:
        "Data restoration is in progress. Policy changes are unavailable.",
      revision_conflict:
        "Another operation changed the policies. Refresh and retry.",
      resource_not_found:
        "The selected runtime, project or policy no longer exists. Refresh.",
      requires_owner_action:
        "Review the desktop configuration or policy storage before refreshing.",
      unverified_policy:
        "Complete execution permission evidence is missing. This scope cannot be approved.",
      mobile_execution_unavailable:
        "Unable to check or change policies. Refresh and retry.",
    },
  },
};
