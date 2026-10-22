package one.agents.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import one.agents.mobile.contract.Schedule
import one.agents.mobile.contract.ScheduleSummary

@Composable internal fun ScheduleDefinition(schedule: Schedule, state: MobileState) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val project = schedule.projectId?.let { id -> state.projects.find { it.id == id }?.name ?: id } ?: stringResource(R.string.no_project)
        Text(stringResource(R.string.policy_project, project), style = MaterialTheme.typography.bodyMedium)
        Text(stringResource(R.string.schedule_execution_policy), style = MaterialTheme.typography.labelLarge)
        schedule.executionPolicyId?.let { Text(stringResource(R.string.schedule_policy_identity, it), style = MaterialTheme.typography.bodySmall) }
        val policy = state.policies.find { it.id == schedule.executionPolicyId && it.runtimeId == schedule.runtimeId && it.projectId == schedule.projectId }
        if (policy == null) Text(stringResource(R.string.schedule_policy_not_provided), style = MaterialTheme.typography.bodySmall)
        else {
            Text(stringResource(when (policy.mode) { "inspect" -> R.string.policy_inspect; "project_write" -> R.string.policy_project_write; "desktop_analysis" -> R.string.task_analysis; "desktop_execute" -> R.string.task_execute; "desktop_auto" -> R.string.task_auto; "desktop_full_access" -> R.string.task_full_access; else -> R.string.policy_unavailable }))
            if (policy.enforced && policy.unattendedApproved) Text(stringResource(R.string.policy_unattended), style = MaterialTheme.typography.bodySmall)
            if (!policy.enforced) Text(translatedError("unverified_policy"), style = MaterialTheme.typography.bodySmall)
            policy.restrictionReason?.let { Text(translatedError(it), style = MaterialTheme.typography.bodySmall) }
        }
    }
}

// @lat: [[mobile-data#Mobile data#Android original schedule detail management]]
internal fun scheduleDetailSummary(schedule: Schedule) = ScheduleSummary(
    id = schedule.id, name = schedule.name, runtimeId = schedule.runtimeId, projectId = schedule.projectId,
    executionPolicyId = schedule.executionPolicyId, scheduleExpression = schedule.scheduleExpression,
    schedulerTimeZone = schedule.schedulerTimeZone, enabled = schedule.enabled, effectiveState = schedule.effectiveState,
    concurrencyPolicy = schedule.concurrencyPolicy, timeoutMs = schedule.timeoutMs, nextRunAt = schedule.nextRunAt,
    recentExecution = schedule.recentExecution, activeRunIds = schedule.activeRunIds, pendingCount = schedule.pendingCount,
    revision = schedule.revision, allowedActions = schedule.allowedActions)

@Composable internal fun ScheduleManagementControls(allowedActions: List<String>, pendingCount: Long, capabilities: List<String>, busy: Boolean, edit: () -> Unit, action: (String) -> Unit) {
    Column {
        if ("edit" in allowedActions && "schedule:manage" in capabilities) TextButton(onClick = edit, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.edit)) }
        listOf("pause" to R.string.pause, "resume" to R.string.resume, "trigger" to R.string.trigger, "discard-pending" to R.string.discard_pending, "delete" to R.string.delete_schedule).forEach { (name, label) ->
            val permission = if (name == "trigger") "schedule:trigger" else "schedule:manage"
            val originalAction = if (name == "discard-pending") "discard_pending" else name
            if (originalAction in allowedActions && permission in capabilities && (name != "discard-pending" || pendingCount > 0))
                TextButton(onClick = { action(name) }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(label)) }
        }
    }
}
