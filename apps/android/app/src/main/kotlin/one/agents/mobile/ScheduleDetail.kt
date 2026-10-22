package one.agents.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import one.agents.mobile.contract.ScheduleSummary

internal fun scheduleTime(value: String, timeZone: String, language: String): String = try {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
        .withLocale(Locale.forLanguageTag(language)).withZone(ZoneId.of(timeZone))
        .format(Instant.parse(value))
} catch (_: Exception) { value }

@Composable internal fun ScheduleRunControls(activeRunIds: List<String>, allowedActions: List<String>, capabilities: List<String>, busy: Boolean, cancel: (String) -> Unit) {
    if ("cancel" !in allowedActions || "schedule:cancel" !in capabilities) return
    Column {
        activeRunIds.forEach { runId ->
            TextButton(onClick = { cancel(runId) }, enabled = !busy, modifier = Modifier.testTag("schedule-stop-$runId")) { Text(stringResource(R.string.stop_run)) }
        }
    }
}

@Composable internal fun ScheduleDetail(model: MobileViewModel, state: MobileState, onEdit: (ScheduleSummary) -> Unit, onAction: (ScheduleSummary, String) -> Unit) {
    val schedule = state.viewedSchedule ?: return
    LazyColumn(Modifier.fillMaxSize().testTag("schedule-history"), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Text(translatedState(schedule.effectiveState), style = MaterialTheme.typography.titleMedium)
            Text(state.runtimes.find { it.id == schedule.runtimeId }?.name ?: schedule.runtimeId, style = MaterialTheme.typography.bodyMedium)
            ScheduleFrequency(schedule.scheduleExpression, state.language, compact = false)
            Text(stringResource(R.string.frequency_owner_expression, schedule.scheduleExpression), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.owner_timezone, schedule.schedulerTimeZone), style = MaterialTheme.typography.bodySmall)
            ScheduleMetadata(schedule.id, schedule.nextRunAt, schedule.schedulerTimeZone, schedule.recentExecution, state.language, compact = false)
            Text(stringResource(R.string.pending_count, schedule.pendingCount))
            ScheduleRunControls(schedule.activeRunIds, schedule.allowedActions, state.owner?.capabilities.orEmpty(), state.busy) { model.cancelRun(it) }
        }
        item {
            Text(stringResource(R.string.prompt), style = MaterialTheme.typography.labelLarge)
            SelectionContainer { Text(schedule.prompt, style = MaterialTheme.typography.bodyLarge) }
        }
        item { ScheduleDefinition(schedule, state) }
        item { ScheduleManagementControls(schedule.allowedActions, schedule.pendingCount, state.owner?.capabilities.orEmpty(), state.busy,
            edit = { onEdit(scheduleDetailSummary(schedule)) }, action = { onAction(scheduleDetailSummary(schedule), it) }) }
        item { HorizontalDivider(); Spacer(Modifier.height(16.dp)); Text(stringResource(R.string.execution_history), style = MaterialTheme.typography.titleMedium) }
        state.historyError?.let { code -> item { ErrorFeedback(translatedError(code), state.failureRequestId("history", code)) } }
        if (!state.busy && state.scheduleExecutions.isEmpty() && state.historyError == null) item { Text(stringResource(R.string.empty_execution_history)) }
        items(state.scheduleExecutions, key = { it.id }) { execution ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row {
                    Text(scheduleTime(execution.triggeredAt, schedule.schedulerTimeZone, state.language), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Text(translatedState(execution.status), style = MaterialTheme.typography.labelLarge)
                }
                Text(stringResource(when (execution.trigger) {
                    "manual" -> R.string.trigger_manual
                    "scheduled" -> R.string.trigger_scheduled
                    "missed" -> R.string.trigger_missed
                    else -> R.string.state_unknown
                }), style = MaterialTheme.typography.bodySmall)
                execution.summary?.takeIf { it.isNotBlank() }?.let { SelectionContainer { Text(it, style = MaterialTheme.typography.bodyMedium) } }
                if (execution.conversationId != null && "conversation:read" in (state.owner?.capabilities ?: emptyList())) {
                    TextButton(onClick = { model.openExecutionConversation(execution) }, enabled = !state.busy) { Text(stringResource(R.string.open_result_conversation)) }
                }
                HorizontalDivider()
            }
        }
        if (state.historyCursor != null) item { TextButton(onClick = model::moreScheduleHistory, enabled = !state.busy) { Text(stringResource(R.string.more)) } }
    }
}
