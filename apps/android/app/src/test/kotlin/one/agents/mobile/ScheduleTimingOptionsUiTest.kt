package one.agents.mobile

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "en-w360dp-h640dp")
class ScheduleTimingOptionsUiTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    @Test fun editedExpressionTimeoutAndConcurrencySurviveFoldAndReopen() {
        val expression=mutableStateOf("5m"); val timeout=mutableStateOf("300"); val concurrency=mutableStateOf("skip")
        ui.setContent { MaterialTheme { Column { ScheduleTimingOptions(expression.value, {expression.value=it}, timeout.value, {timeout.value=it}, concurrency.value, {concurrency.value=it}, "en") } } }
        ui.onNodeWithText("Timeout in seconds").assertDoesNotExist()
        ui.onNodeWithText("Concurrent runs").assertDoesNotExist()
        ui.onNodeWithText("Interval").assertIsDisplayed()
        ui.onNodeWithText("Advanced options").performClick()
        ui.onNodeWithText("Schedule expression").performTextReplacement("30 9 * * 1-5")
        ui.onNodeWithText("Timeout in seconds").performTextReplacement("450")
        ui.onNodeWithText("Queue").performClick()
        ui.onNodeWithText("Hide advanced options").performClick()
        ui.onNodeWithText("Timeout: 450 seconds · Concurrency: Queue").assertIsDisplayed()
        assertEquals("30 9 * * 1-5",expression.value); assertEquals("450",timeout.value); assertEquals("queue",concurrency.value)
        ui.onNodeWithText("Advanced options").performClick()
        ui.onNodeWithText("Schedule expression").assert(hasText("30 9 * * 1-5"))
        ui.onNodeWithText("Timeout in seconds").assert(hasText("450"))
    }
    @Test fun originalCronAndUnknownConcurrencyCannotBeRewrittenByVisibilityControls() {
        val expression=" 30 09 * * 1-5 "; var callbacks=0
        ui.setContent { MaterialTheme { Column { ScheduleTimingOptions(expression, {callbacks++}, "660", {callbacks++}, "legacy-policy", {callbacks++}, "en") } } }
        ui.onNodeWithText("Owner expression: $expression").assertIsDisplayed()
        ui.onNodeWithText("Interval").assertDoesNotExist()
        ui.onNodeWithText("Advanced options").performClick()
        ui.onNodeWithText("Schedule expression").assert(hasText(expression))
        ui.onNodeWithText("Use interval input").performClick()
        ui.onNodeWithText("Hide advanced options").performClick()
        assertEquals(0,callbacks)
        ui.onNodeWithText("Interval").assert(hasText(expression))
    }
    @Test @Config(qualifiers="zh-rCN-w360dp-h640dp") fun chineseAdvancedLabelsAndSelectedSummaryRemainReadable() {
        ui.setContent { MaterialTheme { Column { ScheduleTimingOptions("5m", {}, "300", {}, "replace", {}, "zh-CN") } } }
        ui.onNodeWithText("运行间隔").assertIsDisplayed()
        ui.onNodeWithText("超时：300 秒 · 并发：替换").assertIsDisplayed()
        ui.onNodeWithText("高级选项").performClick()
        ui.onNodeWithText("超时秒数").assertIsDisplayed(); ui.onNodeWithText("并发策略").assertIsDisplayed()
        ui.onNodeWithText("收起高级选项").performClick()
        ui.onNodeWithText("超时秒数").assertDoesNotExist()
    }
}
