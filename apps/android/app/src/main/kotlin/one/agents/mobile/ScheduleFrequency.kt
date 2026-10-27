package one.agents.mobile

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import java.math.BigInteger
import java.text.NumberFormat
import java.time.DayOfWeek
import java.time.LocalTime
import java.time.Month
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale

private val cronBounds = listOf(0..59, 0..23, 1..31, 1..12, 0..7)

private fun cronValues(part: String, bounds: IntRange): Set<Int>? {
    val result = mutableSetOf<Int>()
    for (item in part.split(',')) {
        val stepped = Regex("^(\\*|[0-9]+-[0-9]+)/([0-9]+)$").matchEntire(item)
        val base = stepped?.groupValues?.get(1) ?: item
        val step = stepped?.groupValues?.get(2)?.toBigIntegerOrNull() ?: BigInteger.ONE
        if (step < BigInteger.ONE) return null
        val range = Regex("^([0-9]+)-([0-9]+)$").matchEntire(base)
        val start: Int
        val end: Int
        if (base == "*") { start = bounds.first; end = bounds.last }
        else if (range != null) {
            start = range.groupValues[1].toIntOrNull() ?: return null
            end = range.groupValues[2].toIntOrNull() ?: return null
        } else {
            if (!Regex("^[0-9]+$").matches(base)) return null
            start = base.toIntOrNull() ?: return null; end = start
        }
        if (start !in bounds || end !in bounds || start > end) return null
        for (value in start..end) if ((value - start).toBigInteger().mod(step) == BigInteger.ZERO) result.add(value)
    }
    return result
}

internal fun scheduleFrequency(context: Context, expression: String, language: String): String {
    val locale = Locale.forLanguageTag(language)
    val number = NumberFormat.getIntegerInstance(locale)
    fun raw() = context.getString(R.string.frequency_owner_expression, expression)
    val value = expression.trim()
    val interval = Regex("^([0-9]+)([mh])$", RegexOption.IGNORE_CASE).matchEntire(value)
    if (interval != null) {
        val count = interval.groupValues[1].toBigInteger().max(BigInteger.ONE)
        // Above JS's exact integer range, retain the Owner expression rather than invent precision.
        if (count > BigInteger("9007199254740991")) return raw()
        val hours = interval.groupValues[2].equals("h", ignoreCase = true)
        val label = if (hours) { if (count == BigInteger.ONE) R.string.frequency_hour_one else R.string.frequency_hours }
            else { if (count == BigInteger.ONE) R.string.frequency_minute_one else R.string.frequency_minutes }
        return context.getString(label, number.format(count))
    }
    val parts = value.split(Regex("\\s+"))
    if (parts.size != 5) return raw()
    val sets = parts.mapIndexed { i, part -> cronValues(part, cronBounds[i]) ?: return raw() }
        .mapIndexed { i, values -> if (i == 4) values.map { if (it == 7) 0 else it }.toSet() else values }
    val full = cronBounds.mapIndexed { i, bounds -> if (i == 4) (0..6).toSet() else bounds.toSet() }
    if (sets == full) return context.getString(R.string.frequency_every_minute)
    fun weekday(v: Int) = DayOfWeek.of(if (v == 0) 7 else v).getDisplayName(TextStyle.FULL, locale)
    if (sets[0].size == 1 && sets[1].size == 1 && sets[2] == full[2] && sets[3] == full[3]) {
        val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(LocalTime.of(sets[1].single(), sets[0].single()))
        if (sets[4] == full[4]) return context.getString(R.string.frequency_daily, time)
        if (sets[4] == (1..5).toSet()) return context.getString(R.string.frequency_weekdays, time)
        if (sets[4].size == 1) return context.getString(R.string.frequency_weekly, weekday(sets[4].single()), time)
    }
    val labels = listOf(R.string.frequency_minute_field, R.string.frequency_hour_field, R.string.frequency_day_field, R.string.frequency_month_field, R.string.frequency_weekday_field)
    val conditions = sets.mapIndexed { i, values ->
        val description = if (values == full[i]) context.getString(R.string.frequency_any) else values.sorted().joinToString(", ") {
            when (i) { 3 -> Month.of(it).getDisplayName(TextStyle.SHORT, locale); 4 -> weekday(it); else -> number.format(it) }
        }
        context.getString(labels[i], description)
    }
    return context.getString(R.string.frequency_all_conditions, conditions.joinToString("; "))
}

@Composable internal fun ScheduleFrequency(expression: String, language: String, compact: Boolean = true) {
    Text(scheduleFrequency(LocalContext.current, expression, language), style = MaterialTheme.typography.bodyMedium,
        maxLines = if (compact) 2 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
}
