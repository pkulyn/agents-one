package one.agents.mobile

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.lifecycle.ViewModelProvider
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h800dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CVisualUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @Test fun nativeCorePagesRemainNavigableAt360dp() {
        ui.runOnUiThread { val model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.forget(); model.language("en"); model.appearance("light"); model.demo() }
        ui.runOnUiThread {
            val model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            @Suppress("UNCHECKED_CAST")
            val flow = MobileViewModel::class.java.getDeclaredField("mutable").apply { isAccessible = true }.get(model) as kotlinx.coroutines.flow.MutableStateFlow<MobileState>
            val limits = one.agents.mobile.contract.Limits(100, 50000, 262144, 86400000, 7, 100000, 300000)
            val scopes = listOf("conversation:read", "conversation:create", "conversation:advance", "schedule:read", "schedule:manage")
            val owner = one.agents.mobile.contract.OwnerSpace("visual-owner", "visual-space", "家用电脑", "desktop", true, true, true, "Asia/Shanghai", scopes, limits, "visual-epoch")
            flow.value = flow.value.copy(demo = false, paired = true, owner = owner, owners = listOf(owner), policies = listOf(one.agents.mobile.contract.ExecutionPolicy("desktop-task-visual", "demo-runtime", null, "desktop_analysis", true, true, listOf("create", "advance", "trigger"))))
        }
        ui.onNodeWithText("移动端实施契约").assertExists()
        val output = File(System.getProperty("java.io.tmpdir"), "agents-one-visual/CVisualUiTest").apply { mkdirs() }
        fun capture(name: String) {
            ui.waitForIdle()
            lateinit var bitmap: android.graphics.Bitmap
            ui.runOnUiThread {
                val globalClass = Class.forName("android.view.WindowManagerGlobal")
                val global = globalClass.getDeclaredMethod("getInstance").invoke(null)
                @Suppress("UNCHECKED_CAST")
                val roots = globalClass.getDeclaredField("mViews").apply { isAccessible = true }.get(global) as List<android.view.View>
                val view = roots.lastOrNull { it.isShown && it.width > 0 && it.height > 0 } ?: ui.activity.window.decorView
                bitmap = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
                view.draw(android.graphics.Canvas(bitmap))
            }
            check(bitmap.width > 100 && bitmap.height > 100)
            File(output, name + ".png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        }
        capture("conversations")
        ui.onAllNodesWithText("Schedules").onLast().performClick()
        ui.onNodeWithText("每日工作摘要").assertExists(); capture("schedules")
        ui.onAllNodesWithText("Account").onLast().performClick()
        ui.onNodeWithText("Connections and devices").assertExists(); capture("account")
        ui.onNodeWithText("Language").performScrollTo().performClick()
        ui.onNodeWithText("简体中文").assertExists()
        ui.onNode(hasText("English") and hasAnyAncestor(isDialog())).assertExists()
        capture("language-sheet")
        ui.onNodeWithText("Close").performClick()
        ui.onAllNodesWithText("Tasks").onLast().performClick()
        ui.onNodeWithContentDescription("New conversation").performClick()
        ui.onNodeWithTag("field:Task instructions").performTextInput("Please summarize this week's work.")
        ui.onNode(hasTestTag("field:Task instructions") and hasAnyAncestor(isDialog())).assertExists()
        capture("new-conversation")
        ui.onNode(hasContentDescription("Back") and hasAnyAncestor(isDialog())).performClick()
        ui.runOnUiThread {
            val model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            @Suppress("UNCHECKED_CAST")
            val flow = MobileViewModel::class.java.getDeclaredField("mutable").apply { isAccessible = true }.get(model) as kotlinx.coroutines.flow.MutableStateFlow<MobileState>
            val conversation = flow.value.conversations.first().copy(allowedActions = listOf("read", "advance", "manage"))
            flow.value = flow.value.copy(selected = conversation, messages = listOf(
                one.agents.mobile.contract.Message(id = "visual-user", conversationId = conversation.id, messageSeq = "1", kind = "user", content = "请梳理本周项目进度，列出下一步。", visibleToUser = true, createdAt = "2026-10-08T08:00:00Z"),
                one.agents.mobile.contract.Message(id = "visual-assistant", conversationId = conversation.id, messageSeq = "2", kind = "assistant", content = "## 本周进度\n\n- 对话与定时任务已接入桌面。\n- 下一步进行跨网络真机验证。", visibleToUser = true, createdAt = "2026-10-08T08:01:00Z")
            ))
            model.composerDraft("继续检查连接恢复流程")
        }
        ui.waitUntil(5_000) {
            ui.onAllNodesWithText("## 本周进度", substring = true).fetchSemanticsNodes().isEmpty() &&
                ui.onAllNodesWithText("本周进度", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        ui.onNodeWithText("• 对话与定时任务已接入桌面。", substring = true).assertExists()
        capture("conversation-detail")
        ui.runOnUiThread { ViewModelProvider(ui.activity)[MobileViewModel::class.java].language("zh-CN") }
        capture("conversation-detail-zh")
        ui.runOnUiThread {
            val model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            @Suppress("UNCHECKED_CAST")
            val flow = MobileViewModel::class.java.getDeclaredField("mutable").apply { isAccessible = true }.get(model) as kotlinx.coroutines.flow.MutableStateFlow<MobileState>
            val conversation = flow.value.selected!!
            val createdAt = "2026-10-08T08:02:00Z"
            val run = one.agents.mobile.contract.Run(
                runId = "visual-run", turnId = "visual-turn", conversationId = conversation.id,
                runtimeId = conversation.runtimeId, status = "running", startedAt = createdAt,
                lastRunEventSeq = "2", artifacts = emptyList(),
                activity = listOf(
                    one.agents.mobile.contract.RunActivity("visual-progress", "progress", "正在核对项目内容", createdAt),
                    one.agents.mobile.contract.RunActivity("visual-tool", "tool_call", "", createdAt, toolName = "rg", toolKind = "terminal")
                ),
                allowedActions = listOf("cancel")
            )
            flow.value = flow.value.copy(selected = conversation.copy(activeRunIds = listOf(run.runId)), runs = listOf(run))
        }
        ui.onNodeWithText("正在核对项目内容").assertDoesNotExist()
        ui.onNodeWithText("思考").performClick()
        ui.onNodeWithText("1 次工具调用").performClick()
        ui.onNodeWithText("正在核对项目内容").assertExists()
        ui.onNodeWithText("rg").assertExists()
        ui.onNodeWithText("当前对话正在运行，请等待完成或停止后再发送。", substring = true).assertDoesNotExist()
        ui.onNodeWithText("执行状态").assertDoesNotExist()
        ui.onNodeWithText("停止当前运行").assertDoesNotExist()
        ui.onNodeWithContentDescription("发送").assertIsNotEnabled()
        capture("conversation-detail-running-zh")
        ui.runOnUiThread { val model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.back() }
        capture("conversations-zh")
        ui.runOnUiThread { ViewModelProvider(ui.activity)[MobileViewModel::class.java].appearance("dark") }
        capture("conversations-dark")
    }
}
