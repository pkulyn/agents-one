package one.agents.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import one.agents.mobile.contract.ExecutionPolicy

internal fun policyCatalogAvailable(policy: ExecutionPolicy, state: MobileState): Boolean = policy.enforced &&
    state.runtimes.any { it.id == policy.runtimeId } && (policy.projectId == null || state.projects.any { it.id == policy.projectId }) && policy.mode in setOf("inspect", "project_write", "desktop_analysis", "desktop_execute", "desktop_auto", "desktop_full_access")

internal fun permissionLabel(mode: String?): Int = when(mode) { "desktop_analysis", "inspect" -> R.string.ui_permission_readonly; "desktop_full_access" -> R.string.ui_permission_full; else -> R.string.ui_permission_auto }
internal fun defaultTaskPolicy(candidates: List<ExecutionPolicy>, state: MobileState): ExecutionPolicy? =
    candidates.firstOrNull { it.projectId == null && it.mode == "desktop_auto" && policyCatalogAvailable(it, state) }
        ?: candidates.firstOrNull { it.mode == "desktop_auto" && policyCatalogAvailable(it, state) }
        ?: candidates.firstOrNull { it.mode == "desktop_execute" && policyCatalogAvailable(it, state) }
        ?: candidates.firstOrNull { it.mode != "desktop_full_access" && policyCatalogAvailable(it, state) }

internal fun currentPolicySelection(candidates: List<ExecutionPolicy>, choice: ExecutionPolicy?, state: MobileState): ExecutionPolicy? =
    choice?.let { selected -> candidates.firstOrNull {
        it.id == selected.id && it.runtimeId == selected.runtimeId && it.projectId == selected.projectId &&
            it.mode == selected.mode && policyCatalogAvailable(it, state)
    } }

@Composable internal fun PolicySelector(policies: List<ExecutionPolicy>, state: MobileState, selection: ExecutionPolicy?, select: (ExecutionPolicy?) -> Unit) {
    val desktopChoices = policies.filter { it.id.startsWith("desktop-task-") }
    if (desktopChoices.isNotEmpty()) {
        DesktopTaskSelector(desktopChoices, state, selection, select)
        return
    }
    Text(stringResource(R.string.policy), style = MaterialTheme.typography.labelLarge)
    if (policies.isEmpty()) Text(stringResource(R.string.policy_missing))
    policies.forEach { policy ->
        val enabled = !state.busy && policyCatalogAvailable(policy, state)
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("execution-policy:${policy.id}").clickable(enabled = enabled) { select(policy) }) {
            RadioButton(selection == policy, onClick = { select(policy) }, enabled = enabled)
            Column(Modifier.weight(1f).padding(top = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(state.runtimes.find { it.id == policy.runtimeId }?.name ?: stringResource(R.string.policy_runtime_unavailable), style = MaterialTheme.typography.bodyLarge)
                val project = if (policy.projectId == null) stringResource(R.string.no_project) else state.projects.find { it.id == policy.projectId }?.name ?: stringResource(R.string.project_unavailable)
                Text(stringResource(R.string.policy_project, project), style = MaterialTheme.typography.bodySmall)
                Text(stringResource(when (policy.mode) { "inspect" -> R.string.policy_inspect; "project_write" -> R.string.policy_project_write; else -> R.string.policy_unavailable }), style = MaterialTheme.typography.bodySmall)
                if (policy.unattendedApproved) Text(stringResource(R.string.policy_unattended), style = MaterialTheme.typography.bodySmall)
                policy.restrictionReason?.let { Text(translatedError(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@Composable private fun DesktopTaskSelector(policies: List<ExecutionPolicy>, state: MobileState, selection: ExecutionPolicy?, select: (ExecutionPolicy?) -> Unit) {
    val binding = listOf(state.owner?.ownerId, state.owner?.spaceId, state.owner?.dataEpoch, state.selected?.id, state.selectedSchedule?.id)
    var runtimeId by remember(binding) { mutableStateOf(selection?.runtimeId ?: state.selected?.runtimeId ?: policies.firstOrNull { policyCatalogAvailable(it, state) }?.runtimeId) }
    var projectId by remember(binding) { mutableStateOf(selection?.projectId ?: state.selected?.projectId) }
    fun modeName(value: String?) = when(value) { "desktop_analysis", "inspect" -> "analysis"; "desktop_full_access" -> "full_access"; else -> "auto" }
    var mode by remember(binding) { mutableStateOf(if(selection == null) "auto" else modeName(selection.mode)) }
    fun candidate(runtime: String?, project: String?, permission: String): ExecutionPolicy? {
        val available = policies.filter { it.runtimeId == runtime && it.projectId == project && policyCatalogAvailable(it, state) }
        return when(permission) { "full_access" -> available.firstOrNull { it.mode == "desktop_full_access" }; "analysis" -> available.firstOrNull { it.mode in setOf("desktop_analysis", "inspect") }; else -> available.firstOrNull { it.mode == "desktop_auto" } ?: available.firstOrNull { it.mode == "desktop_execute" } }
    }
    fun choose(runtime: String?, project: String?, permission: String) { runtimeId = runtime; projectId = project; mode = permission; select(candidate(runtime, project, permission)) }
    LaunchedEffect(binding, policies, state.runtimes, state.projects) { if(selection == null) select(candidate(runtimeId, projectId, mode)) }
    TaskChoice(stringResource(R.string.task_agent), state.runtimes.find { it.id == runtimeId }?.name ?: stringResource(R.string.task_choose_agent), state.busy || state.selected != null, "task-agent") { close ->
        state.runtimes.forEach { runtime -> DropdownMenuItem(text = { Text(runtime.name) }, enabled = policies.any { it.runtimeId == runtime.id && policyCatalogAvailable(it, state) }, onClick = { choose(runtime.id, projectId, mode); close() }) }
    }
    TaskChoice(stringResource(R.string.filter_project), if(projectId == null) stringResource(R.string.no_project) else state.projects.find { it.id == projectId }?.name ?: stringResource(R.string.project_unavailable), state.busy || state.selected != null, "task-project") { close ->
        DropdownMenuItem(text = { Text(stringResource(R.string.no_project)) }, onClick = { choose(runtimeId, null, mode); close() })
        state.projects.forEach { project -> DropdownMenuItem(text = { Text(project.name) }, onClick = { choose(runtimeId, project.id, mode); close() }) }
    }
    TaskChoice(stringResource(R.string.task_mode), stringResource(when(mode) { "analysis" -> R.string.ui_permission_readonly; "full_access" -> R.string.ui_permission_full; else -> R.string.ui_permission_auto }), state.busy, "task-mode") { close ->
        listOf("auto" to R.string.ui_permission_auto, "analysis" to R.string.ui_permission_readonly, "full_access" to R.string.ui_permission_full).forEach { (value, label) -> DropdownMenuItem(text = { Text(stringResource(label)) }, enabled = candidate(runtimeId, projectId, value) != null, onClick = { choose(runtimeId, projectId, value); close() }) }
    }
    if(runtimeId != null && selection == null) Text(stringResource(R.string.task_selection_unavailable), color = MaterialTheme.colorScheme.error)

}

@Composable private fun TaskChoice(label: String, value: String, busy: Boolean, tag: String, options: @Composable ColumnScope.(close: () -> Unit) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Text(label, style = MaterialTheme.typography.labelLarge)
    Box {
        OutlinedButton(onClick = { expanded = true }, enabled = !busy, shape = RoundedCornerShape(3.dp), colors = ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.surfaceContainer, contentColor = MaterialTheme.colorScheme.onSurface), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag)) { Text(value) }
        DropdownMenu(expanded = expanded && !busy, onDismissRequest = { expanded = false }) {
            options { expanded = false }
        }
    }
}
