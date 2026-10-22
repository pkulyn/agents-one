package one.agents.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import one.agents.mobile.contract.Conversation

@Composable internal fun ConversationProjectDialog(model: MobileViewModel, original: Conversation, state: MobileState, close: () -> Unit) {
    var selected by remember(original.id, original.revision) { mutableStateOf(original.projectId) }
    val current = state.selected
    val permitted = current?.id == original.id && "manage" in current.allowedActions && "conversation:manage" in state.owner?.capabilities.orEmpty()
    val running = current?.activeRunIds?.isNotEmpty() == true
    AlertDialog(onDismissRequest = close, modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(horizontal = 16.dp), properties = DialogProperties(usePlatformDefaultWidth = false),
        title = { Text(stringResource(R.string.change_project)) }, text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.project_change_notice), style = MaterialTheme.typography.bodySmall)
                state.error?.let { ErrorFeedback(translatedError(it), state.failureRequestId("global", it)) }
                if (running) Text(translatedError("run_active"), color = MaterialTheme.colorScheme.error)
                ProjectChoice(stringResource(R.string.no_project), selected == null, !state.busy) { selected = null }
                state.projects.forEach { project -> ProjectChoice(project.name, selected == project.id, !state.busy) { selected = project.id } }
                if (selected != null && state.projects.none { it.id == selected }) Text(stringResource(R.string.project_unavailable), color = MaterialTheme.colorScheme.error)
                state.projectError?.let { code ->
                    ErrorFeedback(stringResource(R.string.project_catalog_failed, translatedError(code)), state.failureRequestId("project", code))
                    TextButton(onClick = model::refreshProjects, enabled = !state.busy) { Text(stringResource(R.string.retry_read_sync)) }
                }
            }
        }, confirmButton = { TextButton(onClick = { model.changeConversationProject(original, selected, close) }, enabled = permitted && !state.busy && !running && selected != original.projectId && (selected == null || state.projects.any { it.id == selected })) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = close) { Text(stringResource(R.string.cancel)) } })
}
@Composable private fun ProjectChoice(label: String, selected: Boolean, enabled: Boolean, choose: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = enabled, onClick = choose)) {
        RadioButton(selected, onClick = choose, enabled = enabled)
        Text(label, Modifier.weight(1f).padding(top = 12.dp, end = 8.dp))
    }
}
