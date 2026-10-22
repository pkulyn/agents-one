package one.agents.mobile

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ScheduleFrequencyTest {
    private fun context(language: String): Context {
        val context = ApplicationProvider.getApplicationContext<Context>()
        return context.createConfigurationContext(Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)) })
    }
    private fun describe(value: String, language: String = "en") = scheduleFrequency(context(language), value, language)

    // @lat: [[mobile-data#Mobile data#Android frequency interval original semantics]]
    @Test fun intervalsUseBilingualPluralAndLegacyZeroClampWithoutMutatingSource() {
        val original = " 0002H "
        assertEquals("Every 2 hours", describe(original)); assertEquals(" 0002H ", original)
        assertEquals("Every 1 minute", describe("0m")); assertEquals("Every 1 hour", describe("1h"))
        assertEquals("Every 1,000 minutes", describe("1000m")); assertEquals("每 5 分钟", describe("5m", "zh-CN"))
        assertEquals("每 2 小时", describe("2h", "zh-CN"))
    }

    // @lat: [[mobile-data#Mobile data#Android frequency common Cron and Sunday alias]]
    @Test fun commonCronDescriptionsUseLocaleTimeAndBothOriginalSundayValues() {
        assertEquals("Every minute", describe("* * * * *"))
        val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.ENGLISH).format(LocalTime.of(9, 30))
        assertEquals("Daily at $time", describe("30 9 * * *"))
        assertEquals("Weekdays at $time", describe("30 9 * * 1-5"))
        assertEquals("Every Sunday at $time", describe("30 9 * * 0"))
        assertEquals(describe("30 9 * * 0"), describe("30 9 * * 7"))
        assertEquals(describe("30 9 * * 0"), describe("30 9 * * 0,7"))
        assertTrue(describe("30 9 * * 1-5", "zh-CN").startsWith("周一至周五 "))
    }

    // @lat: [[mobile-data#Mobile data#Android frequency complex AND with original step anchors]]
    @Test fun complexConditionsAreAndAndStepsStartAtFieldOrRangeMinimum() {
        assertEquals("All conditions must match: minute: 5, 12, 19; hour: 2; day of month: 1, 11, 21, 31; month: Jan, Jul; weekday: Sunday, Monday, Tuesday",
            describe("5-20/7 2 */10 1,7 0-2,7"))
        assertEquals("All conditions must match: minute: 0, 20, 40; hour: any; day of month: 1; month: any; weekday: Monday",
            describe("*/20 * 1 * 1"))
        assertEquals("All conditions must match: minute: 0; hour: any; day of month: any; month: any; weekday: any",
            describe("*/999999999999999999999999999999 * * * *"))
        val zh = describe("15 3 1 2 1", "zh-CN")
        assertTrue(zh.startsWith("以下条件须同时满足：")); assertTrue(zh.contains("日期：1")); assertTrue(zh.contains("星期：星期一"))
    }

    // @lat: [[mobile-data#Mobile data#Android frequency unsupported expression preserves original]]
    @Test fun unsupportedOrUnsafeInputKeepsOriginalOwnerExpression() {
        val originals = listOf("30 9 * * MON", "0 0 * * ?", "60 9 * * *", "5/2 * * * *", "*/0 * * * *", "8-3 * * * *", "0 0 0 * *", "0 0 * 13 *", "0 0 * * 8", "0,,1 * * * *", "0 0 * * * *", "@daily", "9007199254740992h", "  custom expression  ")
        originals.forEach { assertEquals("Owner expression: $it", describe(it)) }
        assertEquals("桌面表达式：@daily", describe("@daily", "zh-CN"))
    }

    // @lat: [[mobile-data#Mobile data#Android frequency weekday steps and full unions]]
    @Test fun steppedSundayAndUnionCoverageDoNotChangeCivilWeekdayMeaning() {
        assertEquals(describe("0 9 * * 0,2,4,6"), describe("0 9 * * */2"))
        assertEquals(describe("0 9 * * 1,4,0"), describe("0 9 * * 1-7/3"))
        assertEquals(describe("0 9 * * *"), describe("0 9 * * 0-6"))
        assertEquals(describe("* * * * *"), describe("0-59 0-23 1-31 1-12 0-7"))
    }
}
