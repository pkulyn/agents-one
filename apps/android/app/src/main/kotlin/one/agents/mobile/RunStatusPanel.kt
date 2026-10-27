package one.agents.mobile

import androidx.compose.animation.core.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import one.agents.mobile.contract.Run

@Composable internal fun ActivityDisclosure(title: String, active: Boolean, tools: Boolean = false, binding: Any?, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    var expanded by remember(binding) { mutableStateOf(false) }
    val opacity = if(active) {
        val pulse = rememberInfiniteTransition(label = "activity-pulse")
        val value by pulse.animateFloat(0.7f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "activity-opacity")
        value
    } else 1f
    Column(modifier) {
        Row(Modifier.heightIn(min = 40.dp).clickable { expanded = !expanded }.testTag("activity-disclosure"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(if(tools) Icons.Outlined.Build else Icons.Outlined.Psychology, null, Modifier.size(18.dp).rotate(if(active && tools) (opacity - 0.85f) * 70f else 0f), tint = if(active) MaterialTheme.colorScheme.primary.copy(alpha = opacity) else MaterialTheme.colorScheme.primary)
            Text(title, style = MaterialTheme.typography.labelLarge, color = if(active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(if(expanded) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if(expanded) Column(Modifier.padding(start = 26.dp, bottom = 8.dp)) { content() }
    }
}

@Composable internal fun RunStatusCard(run: Run, model: MobileViewModel, state: MobileState, showCancel: Boolean = true) {
    val active = run.status in setOf("queued", "running", "cancelling")
    val activity = run.activity.orEmpty()
    val tools = activity.filter { it.type in setOf("tool_call", "tool_result") }
    val progress = activity.filter { it.type !in setOf("tool_call", "tool_result") && it.summary.isNotBlank() }
    val binding = listOf(state.owner?.ownerId, state.owner?.spaceId, state.owner?.dataEpoch, run.runId)
    Column(Modifier.fillMaxWidth().testTag("run-status-" + run.runId)) {
        if(!active && activity.isEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(if(run.status == "succeeded") Icons.Outlined.Check else Icons.Outlined.StopCircle, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant); Text(translatedState(run.status), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if(active || progress.isNotEmpty()) ActivityDisclosure(stringResource(R.string.ui_thinking), active, binding = binding) {
            progress.forEach { Text(it.summary, style = MaterialTheme.typography.bodySmall) }
        }
        if(tools.isNotEmpty()) ActivityDisclosure(stringResource(R.string.ui_tools_count, tools.count { it.type == "tool_call" }.coerceAtLeast(1)), active, tools = true, binding = binding + "tools") {
            tools.forEach { item -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(if(item.type == "tool_result") Icons.Outlined.Check else Icons.Outlined.Build, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary); Text(item.toolName ?: item.summary, style = MaterialTheme.typography.bodySmall) } }
        }
        if(showCancel && "cancel" in run.allowedActions && state.owner?.capabilities?.any { it in setOf("conversation:advance", "schedule:cancel") } == true)
            TextButton(onClick = { model.cancelRun(run.runId) }, modifier = Modifier.testTag("run-cancel-" + run.runId), enabled = !state.busy) { Text(stringResource(R.string.stop_run)) }
        run.error?.let { ErrorFeedback(translatedError(it.code), it.requestId) }
        run.artifacts.forEach { artifact -> key(artifact.id) { Text(stringResource(R.string.run_artifact, artifact.name, artifact.sizeBytes), style = MaterialTheme.typography.bodySmall); ArtifactDelivery(model, state, artifact) } }
    }
}
