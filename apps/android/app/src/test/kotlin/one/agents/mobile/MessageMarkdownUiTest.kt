package one.agents.mobile

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class MessageMarkdownUiTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun chineseLinkFailureShowsSelectableAddress() {
        ui.setContent { MaterialTheme { MessageMarkdown("[打开结果](https://example.com/result)", openLink = { throw IllegalArgumentException("no_browser") }) } }
        ui.waitUntil(5_000) { ui.onAllNodesWithText("打开结果").fetchSemanticsNodes().isNotEmpty() }
        ui.onNode(hasClickAction(), useUnmergedTree = true).performClick()
        ui.onNodeWithText("无法打开此链接，可选中并复制。").assertIsDisplayed()
        ui.onNodeWithText("https://example.com/result").assertIsDisplayed()
    }
    @Test fun newContentSupersedesPendingParsingAndKeepsFinalBody() {
        val source = mutableStateOf("Old **message**")
        ui.setContent { MaterialTheme { MessageMarkdown(source.value) } }
        ui.runOnIdle { source.value = "```text\nstreaming first line" }
        ui.runOnIdle { source.value = "Final **完整回复** END-MARKER" }
        ui.waitUntil(5_000) { ui.onAllNodesWithText("Final 完整回复 END-MARKER").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("Old message").assertDoesNotExist()
        ui.onNodeWithText("streaming first line", substring = true).assertDoesNotExist()
        ui.onNodeWithText("Final 完整回复 END-MARKER").assertIsDisplayed()
    }
    @Test fun realTextLinkInvokesOnlyOnTapAndOpeningFailureHasFeedback() {
        val clicked = mutableListOf<String>()
        ui.setContent { MaterialTheme { MessageMarkdown("[Open result](https://example.com/result)", openLink = { clicked.add(it); throw IllegalArgumentException("no_browser") }) } }
        ui.waitUntil(5_000) { ui.onAllNodesWithText("Open result", substring = false).fetchSemanticsNodes().isNotEmpty() }
        assertTrue(clicked.isEmpty())
        ui.onNode(hasClickAction(), useUnmergedTree = true).performClick()
        assertEquals(listOf("https://example.com/result"), clicked)
        ui.onNodeWithText("Could not open this link. You can select and copy it.").assertIsDisplayed()
        ui.onNodeWithText("https://example.com/result").assertIsDisplayed()
    }
    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE) fun codeAndTableHaveIndependentHorizontalScrollAtLargeFont() {
        val content = "```text\n" + "long-column ".repeat(12) + "CODE-END\n```\n\n| 中文 | Second | Third |\n| --- | --- | --- |\n| 结果 | value | TABLE-END |"
        ui.setContent { MaterialTheme { CompositionLocalProvider(LocalDensity provides Density(1f, 2f)) { MessageMarkdown(content) } } }
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("message-table").fetchSemanticsNodes().isNotEmpty() }
        val screenWidth = ui.onRoot().fetchSemanticsNode().boundsInRoot.width
        assertTrue(ui.onNodeWithTag("message-code").fetchSemanticsNode().boundsInRoot.width <= screenWidth)
        ui.onNodeWithTag("message-code").performTouchInput { swipeLeft() }
        val codeScroll = ui.onNodeWithTag("message-code").fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange]
        assertTrue("scroll=${codeScroll.value()} max=${codeScroll.maxValue()}", codeScroll.value() > 0f)
        ui.onNodeWithTag("message-code").performSemanticsAction(SemanticsActions.ScrollBy) { it(100_000f, 0f) }
        ui.waitForIdle()
        val endScroll = ui.onNodeWithTag("message-code").fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange]
        assertEquals(endScroll.maxValue(), endScroll.value(), 1f)
        ui.onNodeWithTag("message-table").performTouchInput { swipeLeft() }
        ui.onNodeWithText("TABLE-END").assertIsDisplayed()
        ui.onNodeWithText("CODE-END", substring = true).assertExists()
    }
}
