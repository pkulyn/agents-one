package one.agents.mobile

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import one.agents.mobile.contract.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "en-w360dp-h640dp")
class ScheduleMetadataUiTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    private fun execution(scheduleId: String = "plan-1") = ScheduleExecution("original-run", scheduleId, "scheduled", triggeredAt = "2026-10-05T00:00:00Z", status = "running", summary = "Original running summary")

    @Test fun runningRecordAndNextTimeKeepOriginalStatusAndOwnerCalendarDate() {
        ui.setContent { MaterialTheme { ScheduleMetadata("plan-1", "2026-10-05T01:00:00Z", "America/New_York", ScheduleRecentExecution(execution()), "en") } }
        ui.onNodeWithText("Next run: Oct 4, 2026, 9:00:00 PM").assertIsDisplayed()
        ui.onNodeWithText("Latest execution: Running · Oct 4, 2026, 8:00:00 PM").assertIsDisplayed()
        ui.onNodeWithText("Original running summary").assertIsDisplayed()
        ui.onAllNodesWithText("Succeeded", substring = true).assertCountEquals(0)
    }

    @Test fun legacyMissingFieldAndKnownEmptyHistoryRemainDifferent() {
        val recent = mutableStateOf<ScheduleRecentExecution?>(null)
        ui.setContent { MaterialTheme { ScheduleMetadata("plan-1", null, "Asia/Shanghai", recent.value, "en") } }
        ui.onNodeWithText("No next run scheduled").assertIsDisplayed()
        ui.onNodeWithText("Latest execution unavailable. Open execution history.").assertIsDisplayed()
        ui.onNodeWithText("No executions yet").assertDoesNotExist()
        ui.runOnIdle { recent.value = ScheduleRecentExecution(null) }
        ui.onNodeWithText("No executions yet").assertIsDisplayed()
        ui.onNodeWithText("Latest execution unavailable. Open execution history.").assertDoesNotExist()
    }

    @Test fun foreignScheduleCannotRenderItsSummaryTimeOrStatus() {
        ui.setContent { MaterialTheme { ScheduleMetadata("plan-1", null, "Asia/Shanghai", ScheduleRecentExecution(execution("foreign-plan")), "en") } }
        ui.onNodeWithText("Latest execution unavailable. Open execution history.").assertIsDisplayed()
        ui.onNodeWithText("Original running summary").assertDoesNotExist()
        ui.onAllNodesWithText("Running", substring = true).assertCountEquals(0)
        ui.onNodeWithText("No executions yet").assertDoesNotExist()
    }

    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun chineseRecentExecutionLabelsUseOriginalOwnerTime() {
        ui.setContent { MaterialTheme { ScheduleMetadata("plan-1", null, "Asia/Shanghai", ScheduleRecentExecution(execution().copy(status = "failed", summary = "原失败摘要")), "zh-CN") } }
        ui.onNodeWithText("暂无下次运行时间").assertIsDisplayed()
        ui.onNodeWithText("最近执行：失败 · " + scheduleTime("2026-10-05T00:00:00Z", "Asia/Shanghai", "zh-CN")).assertIsDisplayed()
        ui.onNodeWithText("原失败摘要").assertIsDisplayed()
    }
}
