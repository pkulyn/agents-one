package one.agents.mobile

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.lifecycle.ViewModelProvider
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class MobileScheduleControlUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @Before fun reset() { ui.runOnUiThread { ViewModelProvider(ui.activity)[MobileViewModel::class.java].forget() } }
    private fun show(block: @Composable () -> Unit) { ui.runOnUiThread { ui.activity.setContent(content = block) } }

    @Test fun stopsOnlyTheNativeIdOfThePressedButton() {
        val cancelled = mutableListOf<String>()
        show { MaterialTheme { ScheduleRunControls(listOf("native-1", "native-2"), listOf("cancel"), listOf("schedule:cancel"), false) { cancelled.add(it) } } }
        ui.onNodeWithTag("schedule-stop-native-1").assertIsDisplayed().assertIsEnabled().performClick()
        ui.onNodeWithTag("schedule-stop-native-2").assertIsDisplayed().assertIsEnabled().performClick()
        check(cancelled == listOf("native-1", "native-2"))
    }

    @Test fun managementAndConversationStopScopesCannotShowScheduleStop() {
        show { MaterialTheme { ScheduleRunControls(listOf("native-1"), listOf("cancel"), listOf("schedule:manage", "conversation:cancel"), false) { error("unexpected stop") } } }
        ui.onNodeWithTag("schedule-stop-native-1").assertDoesNotExist()
    }

    @Test fun cancellationScopeCannotOverrideOriginalReadOnlyAction() {
        show { MaterialTheme { ScheduleRunControls(listOf("native-1"), listOf("read"), listOf("schedule:cancel"), false) { error("unexpected stop") } } }
        ui.onNodeWithTag("schedule-stop-native-1").assertDoesNotExist()
    }

    @Test fun busyBlocksAnotherStopWhileTheRequestIsPending() {
        val cancelled = mutableListOf<String>()
        show { MaterialTheme { ScheduleRunControls(listOf("native-1"), listOf("cancel"), listOf("schedule:cancel"), true) { cancelled.add(it) } } }
        ui.onNodeWithTag("schedule-stop-native-1").assertIsNotEnabled().performClick()
        check(cancelled.isEmpty())
    }
}
