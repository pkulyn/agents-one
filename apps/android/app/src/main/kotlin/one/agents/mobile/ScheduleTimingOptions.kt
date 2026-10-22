package one.agents.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.util.Locale

// @lat: [[mobile-data#Mobile data#Android schedule advanced draft preservation]]
@Composable internal fun ScheduleTimingOptions(expression: String, changeExpression: (String) -> Unit, timeout: String, changeTimeout: (String) -> Unit, concurrency: String, changeConcurrency: (String) -> Unit, language: String) {
    var expanded by remember { mutableStateOf(false) }
    var intervalInput by remember { mutableStateOf(expression.isBlank() || Regex("^[0-9]+[mh]$", RegexOption.IGNORE_CASE).matches(expression.trim())) }
    val concurrencyLabel = stringResource(when (concurrency) { "skip" -> R.string.skip; "queue" -> R.string.queue; "replace" -> R.string.replace; else -> R.string.state_unknown })
    val formattedTimeout = timeout.toBigIntegerOrNull()?.let { NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)).format(it) } ?: timeout
    if (intervalInput) OutlinedTextField(expression, changeExpression, label = { Text(stringResource(R.string.schedule_interval)) }, supportingText = { Text(stringResource(R.string.schedule_interval_hint)) })
    else {
        ScheduleFrequency(expression, language, compact = false)
        Text(stringResource(R.string.frequency_owner_expression, expression), style = MaterialTheme.typography.bodySmall)
    }
    Text(stringResource(R.string.schedule_advanced_summary, formattedTimeout, concurrencyLabel), style = MaterialTheme.typography.bodySmall)
    val expandedDescription = stringResource(if (expanded) R.string.options_expanded else R.string.options_collapsed)
    TextButton(onClick = { expanded = !expanded }, modifier = Modifier.heightIn(min = 48.dp).semantics { stateDescription = expandedDescription }) {
        Text(stringResource(if (expanded) R.string.hide_advanced_options else R.string.advanced_options))
    }
    if (expanded) {
        OutlinedTextField(expression, { changeExpression(it); intervalInput = it.isBlank() || Regex("^[0-9]+[mh]$", RegexOption.IGNORE_CASE).matches(it.trim()) }, label = { Text(stringResource(R.string.expression)) })
        if (!intervalInput) TextButton(onClick = { intervalInput = true }) { Text(stringResource(R.string.interval_input)) }
        OutlinedTextField(timeout, changeTimeout, label = { Text(stringResource(R.string.timeout)) })
        Text(stringResource(R.string.concurrency))
        listOf("skip" to R.string.skip, "queue" to R.string.queue, "replace" to R.string.replace).forEach { (value, label) ->
            Row(Modifier.fillMaxWidth().clickable { changeConcurrency(value) }.heightIn(min = 48.dp)) {
                RadioButton(concurrency == value, { changeConcurrency(value) })
                Text(stringResource(label), Modifier.padding(top = 12.dp))
            }
        }
    }
}
