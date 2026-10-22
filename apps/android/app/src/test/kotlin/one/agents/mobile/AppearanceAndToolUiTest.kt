package one.agents.mobile

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import one.agents.mobile.contract.Message
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class AppearanceAndToolUiTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    // @lat: [[mobile-data#Mobile data#Android appearance preference preservation]]
    @Test fun appearanceIsSingleInterfacePreferenceAndSurvivesConnectionClearAndNewModel() {
        val app = ui.activity.application
        val raw = app.getSharedPreferences("connection", android.content.Context.MODE_PRIVATE)
        raw.edit().putString("unknown-ui-key", "keep").putString("language", "en").putString("endpoint", "https://example.com").putString("appearance", "invalid").commit()
        val model = MobileViewModel(app)
        assertEquals("system", model.state.value.appearance)
        model.appearance("dark"); model.forget()
        assertEquals("dark", model.state.value.appearance)
        assertEquals("keep", raw.getString("unknown-ui-key", null))
        assertEquals("https://example.com", raw.getString("endpoint", null))
        assertEquals("dark", MobileViewModel(app).state.value.appearance)
        assertTrue(appearanceIsDark("dark", false)); assertFalse(appearanceIsDark("light", true))
        assertTrue(appearanceIsDark("system", true)); assertFalse(appearanceIsDark("system", false))
        model.appearance("system")
    }
    // @lat: [[mobile-data#Mobile data#Android English appearance selection]]
    @Test fun englishAppearanceRadioUpdatesOriginalSelection() {
        val value = mutableStateOf("system")
        ui.setContent { MaterialTheme { Column { AppearanceSelector(value.value) { value.value = it } } } }
        ui.onNodeWithText("Dark").performClick(); assertEquals("dark", value.value)
        ui.onNodeWithText("Light").performClick(); assertEquals("light", value.value)
        ui.onNodeWithText("Follow system").performClick(); assertEquals("system", value.value)
    }
    // @lat: [[mobile-data#Mobile data#Android tool summary transient expansion]]
    @Test fun toolIsCollapsedKeepsFullUpdatedBodyWhenExpandedAndResetsForNewSource() {
        val row = mutableStateOf(Message("tool-1", "conversation-1", "1", messageRevision = "1", kind = "tool_summary", content = "Original **完整摘要** END", visibleToUser = true, createdAt = "2026-10-07T00:00:00Z"))
        val epoch = mutableStateOf("owner-1\u0000space-1\u0000epoch-1")
        ui.setContent { MaterialTheme { MessageBody(row.value, epoch.value) } }
        ui.onNodeWithText("Original 完整摘要 END").assertDoesNotExist()
        ui.onNodeWithText("Show tool summary").performClick()
        ui.waitUntil(5_000) { ui.onAllNodesWithText("Original 完整摘要 END").fetchSemanticsNodes().isNotEmpty() }
        ui.runOnIdle { row.value = row.value.copy(content = "Updated **完整摘要** FINAL", messageRevision = "2") }
        ui.waitUntil(5_000) { ui.onAllNodesWithText("Updated 完整摘要 FINAL").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("Hide tool summary").performClick()
        ui.onNodeWithText("Updated 完整摘要 FINAL").assertDoesNotExist()
        ui.onNodeWithText("Show tool summary").performClick()
        ui.runOnIdle { epoch.value = "owner-2\u0000space-1\u0000epoch-1" }
        ui.onNodeWithText("Show tool summary").assertIsDisplayed()
        ui.onNodeWithText("Updated 完整摘要 FINAL").assertDoesNotExist()
    }
    // @lat: [[mobile-data#Mobile data#Android Chinese tool and appearance labels]]
    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun chineseControlsHaveTranslatedAppearanceAndToolActions() {
        ui.setContent { MaterialTheme { Column {
            AppearanceSelector("system") {}
            MessageBody(Message("tool-1", "conversation-1", "1", messageRevision = "1", kind = "tool_summary", content = "原工具正文", visibleToUser = true, createdAt = "2026-10-07T00:00:00Z"), "epoch-1")
        } } }
        ui.onNodeWithText("跟随系统").assertIsDisplayed()
        ui.onNodeWithText("浅色").assertIsDisplayed(); ui.onNodeWithText("深色").assertIsDisplayed()
        ui.onNodeWithText("展开工具摘要").performClick()
        ui.waitUntil(5_000) { ui.onAllNodesWithText("原工具正文").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("收起工具摘要").assertIsDisplayed()
    }
}
