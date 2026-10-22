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
    // @lat: [[mobile-data#Mobile data#Approved C native layout]]
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
        val output = File("D:/Projects/Agents-One-Private/plans/mobile-mac/previews/android58").apply { mkdirs() }
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
        ui.onAllNodesWithText("Conversations").onLast().performClick()
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
                one.agents.mobile.contract.Message("visual-user", conversation.id, "1", kind = "user", content = "请梳理本周项目进度，列出下一步。", visibleToUser = true, createdAt = "2026-10-08T08:00:00Z"),
                one.agents.mobile.contract.Message("visual-assistant", conversation.id, "2", kind = "assistant", content = "## 本周进度\n\n- 对话与定时任务已接入桌面。\n- 下一步进行跨网络真机验证。", visibleToUser = true, createdAt = "2026-10-08T08:01:00Z")
            ))
            model.composerDraft("继续检查连接恢复流程")
        }
        capture("conversation-detail")
        ui.runOnUiThread { ViewModelProvider(ui.activity)[MobileViewModel::class.java].language("zh-CN") }
        capture("conversation-detail-zh")
        ui.runOnUiThread { val model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.back() }
        capture("conversations-zh")
        ui.runOnUiThread { ViewModelProvider(ui.activity)[MobileViewModel::class.java].appearance("dark") }
        capture("conversations-dark")
    }
}
