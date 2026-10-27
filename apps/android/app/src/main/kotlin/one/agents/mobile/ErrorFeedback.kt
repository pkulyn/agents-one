package one.agents.mobile

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource

data class FailureTrace(val code: String, val requestId: String)

// Display the opaque contract ID, never arbitrary remote message/details.
internal fun validFailureRequestId(value: String?): String? = value?.takeIf {
    Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$").matches(it)
}

internal fun MobileState.withFailure(section: String, code: String, requestId: String?): MobileState {
    val id = validFailureRequestId(requestId)
    return copy(failureTraces = if (id == null) failureTraces - section else failureTraces + (section to FailureTrace(code, id)))
}

internal fun MobileState.failureRequestId(section: String, code: String): String? =
    failureTraces[section]?.takeIf { it.code == code }?.requestId

@Composable internal fun ErrorFeedback(message: String, requestId: String?, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.error) {
    Column(modifier) {
        Text(message, color = color, style = MaterialTheme.typography.bodyMedium)
        validFailureRequestId(requestId)?.let { id ->
            SelectionContainer { Text(stringResource(R.string.error_request_id, id), style = MaterialTheme.typography.bodySmall, color = color) }
        }
    }
}
