package one.agents.mobile

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import one.agents.mobile.contract.ScheduleRecentExecution

@Composable internal fun ScheduleMetadata(scheduleId: String, nextRunAt: String?, timeZone: String, recent: ScheduleRecentExecution?, language: String, compact: Boolean = true) {
    Column(Modifier.testTag("schedule-metadata-$scheduleId")) {
        Text(nextRunAt?.let { stringResource(R.string.next_run_at, scheduleTime(it, timeZone, language)) }
            ?: stringResource(R.string.no_next_run), style = MaterialTheme.typography.bodySmall, maxLines = if (compact) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
        val execution = recent?.execution
        when {
            recent == null || (execution != null && execution.scheduleId != scheduleId) ->
                Text(stringResource(R.string.recent_execution_unavailable), style = MaterialTheme.typography.bodySmall)
            execution == null -> Text(stringResource(R.string.no_schedule_executions), style = MaterialTheme.typography.bodySmall)
            else -> {
                Text(stringResource(R.string.recent_execution, translatedState(execution.status), scheduleTime(execution.triggeredAt, timeZone, language)), style = MaterialTheme.typography.bodySmall, maxLines = if (compact) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
                execution.summary?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, maxLines = if (compact) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
