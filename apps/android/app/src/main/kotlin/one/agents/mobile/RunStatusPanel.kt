package one.agents.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import one.agents.mobile.contract.Run
import one.agents.mobile.contract.RunActivity

@Composable internal fun RunStatusPanel(model: MobileViewModel, state: MobileState) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row {
            Text(stringResource(R.string.run_status), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = model::refreshRunStatus, enabled = !state.busy) { Text(stringResource(R.string.refresh)) }
        }
        state.runError?.let { ErrorFeedback(translatedError(it), state.failureRequestId("run", it)) }
    }
}

@Composable internal fun RunStatusCard(run: Run, model: MobileViewModel, state: MobileState) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(translatedState(run.status), style = MaterialTheme.typography.labelLarge)
            if (run.status in setOf("queued", "running", "cancelling"))
                LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 4.dp))
            run.activity.orEmpty().takeLast(4).forEach { RunActivityLine(it) }
            run.error?.let { ErrorFeedback(translatedError(it.code), it.requestId) }
            if ("cancel" in run.allowedActions && state.owner?.capabilities?.any { it in setOf("conversation:advance", "schedule:cancel") } == true) TextButton(onClick = { model.cancelRun(run.runId) }, modifier = Modifier.testTag("run-cancel-${run.runId}"), enabled = !state.busy) { Text(stringResource(R.string.stop_run)) }
            run.artifacts.forEach { artifact ->
                key(artifact.id) {
                Text(stringResource(R.string.run_artifact, artifact.name, artifact.sizeBytes), style = MaterialTheme.typography.bodySmall)
                ArtifactDelivery(model, state, artifact)
                }
            }
        }
    }
}

@Composable private fun RunActivityLine(activity: RunActivity) {
    val label = stringResource(when (activity.type) {
        "queued" -> R.string.run_activity_queued
        "started" -> R.string.run_activity_started
        "tool_call" -> R.string.run_activity_tool_call
        "tool_result" -> R.string.run_activity_tool_result
        "error" -> R.string.run_activity_error
        "completed" -> R.string.run_activity_completed
        "cancelled" -> R.string.run_activity_cancelled
        "timed_out" -> R.string.run_activity_timed_out
        else -> R.string.run_activity_progress
    })
    val kind = activity.toolKind?.let { stringResource(when (it) {
        "tool" -> R.string.run_kind_tool
        "skill" -> R.string.run_kind_skill
        "mcp" -> R.string.run_kind_mcp
        "terminal" -> R.string.run_kind_terminal
        "workspace" -> R.string.run_kind_workspace
        else -> R.string.run_kind_tool
    }) }
    Column(Modifier.fillMaxWidth().padding(start = 8.dp, top = 2.dp, bottom = 2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(label, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
            if (!activity.toolName.isNullOrBlank()) Text(listOfNotNull(kind, activity.toolName).joinToString(" · "), style = MaterialTheme.typography.labelMedium)
        }
        if (activity.type !in setOf("tool_call", "tool_result") && activity.summary.isNotBlank())
            Text(activity.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else if (activity.type == "tool_call" && !activity.summary.isBlank() && activity.summary != "Tool call")
            Text(activity.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
