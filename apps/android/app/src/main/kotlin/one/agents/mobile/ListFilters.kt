package one.agents.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import one.agents.mobile.contract.Project

@Composable internal fun ListFilterBar(model: MobileViewModel, state: MobileState, schedules: Boolean) {
    val selection = if (schedules) state.scheduleSelection else state.conversationSelection
    var open by remember(state.owner?.ownerId, state.owner?.spaceId, state.owner?.dataEpoch, schedules) { mutableStateOf(false) }
    val permitted = state.demo || (if (schedules) "schedule:read" else "conversation:read") in state.owner?.capabilities.orEmpty()
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
        val tabs = if (schedules) listOf("all" to R.string.c_all, "enabled" to R.string.state_enabled, "paused" to R.string.state_paused)
            else listOf("all" to R.string.c_all, "active" to R.string.state_active, "archive" to R.string.archived)
        tabs.forEach { (value, label) ->
            val active = if (value == "archive") selection.archived else selection.state == value && !selection.archived
            Column {
                TextButton(onClick = { model.selectListFilters(selection.copy(state = if (value == "archive") "all" else value, archived = value == "archive"), schedules) }, contentPadding = PaddingValues(horizontal = 8.dp), enabled = permitted && !state.busy) { Text(stringResource(label), color = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant) }
                Box(Modifier.width(24.dp).height(2.dp).background(if (active) COrange else Color.Transparent))
            }
        }
        TextButton(onClick = { open = true }, enabled = permitted && !state.busy) { Text(state.projects.find { it.id == selection.projectId }?.name ?: stringResource(R.string.all_projects)) }
    }
    }
    if (open) ListFilterDialog(selection, state.projects, state.projectError, schedules, state.busy,
        retryProjects = model::refreshProjects, close = { open = false },
        apply = { value -> model.selectListFilters(value, schedules) { open = false } }, projectRequestId = state.projectError?.let { state.failureRequestId("project", it) })
}

@Composable internal fun ListFilterDialog(initial: MobileListSelection, projects: List<Project>, projectError: String?, schedules: Boolean, busy: Boolean,
    retryProjects: () -> Unit, close: () -> Unit, apply: (MobileListSelection) -> Unit, projectRequestId: String? = null) {
    var selected by remember(initial) { mutableStateOf(initial) }
    AlertDialog(onDismissRequest = close, modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(horizontal = 16.dp), properties = DialogProperties(usePlatformDefaultWidth = false),
        title = { Text(stringResource(R.string.filters)) }, text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.filter_project), style = MaterialTheme.typography.titleSmall)
                FilterOption(stringResource(R.string.all_projects), selected.projectId == null, !busy) { selected = selected.copy(projectId = null) }
                projects.forEach { project -> FilterOption(project.name, selected.projectId == project.id, !busy) { selected = selected.copy(projectId = project.id) } }
                if (selected.projectId != null && projects.none { it.id == selected.projectId }) Text(stringResource(R.string.filter_project_unavailable), color = MaterialTheme.colorScheme.error)
                projectError?.let { code ->
                    ErrorFeedback(stringResource(R.string.project_catalog_failed, translatedError(code)), projectRequestId)
                    TextButton(onClick = retryProjects, enabled = !busy) { Text(stringResource(R.string.retry_read_sync)) }
                }
                HorizontalDivider()
                Text(stringResource(R.string.filter_state), style = MaterialTheme.typography.titleSmall)
                val options = if (schedules) listOf("all" to R.string.all_states, "enabled" to R.string.state_enabled, "paused" to R.string.state_paused, "running" to R.string.state_running, "blocked" to R.string.state_blocked)
                    else listOf("all" to R.string.all_states, "active" to R.string.state_active, "attention" to R.string.state_needs_attention, "idle" to R.string.state_idle)
                options.forEach { (value, label) -> FilterOption(stringResource(label), selected.state == value, !busy) { selected = selected.copy(state = value) } }
                if (!schedules) {
                    HorizontalDivider()
                    Text(stringResource(R.string.filter_archive), style = MaterialTheme.typography.titleSmall)
                    FilterOption(stringResource(R.string.not_archived), !selected.archived, !busy) { selected = selected.copy(archived = false) }
                    FilterOption(stringResource(R.string.archived), selected.archived, !busy) { selected = selected.copy(archived = true) }
                }
            }
        }, confirmButton = { TextButton(onClick = { apply(selected) }, enabled = !busy && (selected.projectId == null || projects.any { it.id == selected.projectId })) { Text(stringResource(R.string.apply_filters)) } },
        dismissButton = { TextButton(onClick = close) { Text(stringResource(R.string.cancel)) } })
}
@Composable private fun FilterOption(label: String, selected: Boolean, enabled: Boolean, choose: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = enabled, onClick = choose)) {
        RadioButton(selected, onClick = choose, enabled = enabled)
        Text(label, Modifier.weight(1f).padding(top = 12.dp, end = 8.dp), style = MaterialTheme.typography.bodyLarge)
    }
}
