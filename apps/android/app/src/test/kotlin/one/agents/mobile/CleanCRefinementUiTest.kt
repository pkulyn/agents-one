package one.agents.mobile

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import kotlinx.coroutines.flow.MutableStateFlow
import one.agents.mobile.contract.*
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
class CleanCRefinementUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private lateinit var model: MobileViewModel
    private lateinit var flow: MutableStateFlow<MobileState>
    private fun setup(offline: Boolean = false) {
        ui.runOnUiThread {
            model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            model.forget(); model.language("zh-CN"); model.appearance("light"); model.demo()
            @Suppress("UNCHECKED_CAST")
            flow = MobileViewModel::class.java.getDeclaredField("mutable").apply { isAccessible = true }.get(model) as MutableStateFlow<MobileState>
            val l = Limits(100,50000,262144,86400000,7,100000,300000)
            val o = OwnerSpace("original-owner", "primary-space", "家用电脑", "desktop", !offline, !offline, !offline, "Asia/Shanghai", listOf("conversation:read", "conversation:create", "conversation:advance", "conversation:manage", "schedule:read", "schedule:manage"), l, "original-epoch", platform = "windows")
            val runtime = Runtime("original-runtime", "OpenCode", "local", healthy = true, capabilities = emptyList(), allowedActions = listOf("read"), model = "opencode/big-pickle")
            val c = Conversation("original-conversation", "runtime_conversation", "手机连接与项目同步", runtime.id, projectId = "original-project", pinned = false, archived = false, revision = "1", lastMessageSeq = "2", lastReadMessageSeq = "1", lastMessagePreview = "原始对话内容仍然保留", activity = "idle", activeRunIds = emptyList(), createdAt = "2026-10-15T08:00:00Z", updatedAt = "2026-10-15T08:01:00Z", allowedActions = listOf("read", "advance", "manage"))
            val policy = ExecutionPolicy("desktop-task-auto", runtime.id, c.projectId, "desktop_auto", true, true, listOf("create","advance","trigger"))
            val enabled = ScheduleSummary("enabled-plan", "每日项目简报", runtime.id, scheduleExpression = "0 9 * * *", schedulerTimeZone = "Asia/Shanghai", enabled = true, effectiveState = "running", concurrencyPolicy = "skip", timeoutMs = 300000, activeRunIds = emptyList(), pendingCount = 0, revision = "1", allowedActions = listOf("read"))
            flow.value = MobileState(language = "zh-CN", appearance = "light", owner = o, owners = listOf(o), paired = true, deviceLabel = "华为P70", runtimes = listOf(runtime), projects = listOf(Project("original-project", "Agents One", listOf(policy.id)), Project("other-project", "工作笔记", emptyList())), policies = listOf(policy), conversations = listOf(c), schedules = listOf(enabled, enabled.copy(id = "paused-plan", name = "每周资料整理", enabled = false, effectiveState = "paused")), ownerCacheOnly = offline)
        }
        ui.waitForIdle()
    }
    private fun capture(name: String) {
        ui.waitForIdle()
        ui.runOnUiThread {
            val view = ui.activity.window.decorView
            val bitmap = android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(bitmap))
            val dir = File("D:/Projects/Agents-One-Private/plans/mobile-mac/ui-polish-20261019/screenshots").apply { mkdirs() }
            File(dir,name + ".png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
        }
    }
    // @lat: [[mobile-data#Mobile data#Android single offline notice]]
    @Test fun offlineOwnerShowsOneShortTopNoticeWithoutDuplicateConnectionErrors() {
        setup(offline = true)
        ui.runOnUiThread { flow.value = flow.value.copy(error = "owner_offline", syncError = "owner_offline", conversationError = "owner_offline") }
        ui.waitForIdle()
        ui.onNodeWithText("桌面端离线 · 可查看已保存内容").assertExists()
        ui.onAllNodesWithText("桌面端离线 · 可查看已保存内容").assertCountEquals(1)
        ui.onNodeWithText("本地记录 · 离线只读").assertDoesNotExist()
        ui.onNodeWithText("无法连接 Owner，请检查连接并保持 Owner 运行。").assertDoesNotExist()
        ui.onNodeWithText("连接待确认").assertDoesNotExist()
    }
    // @lat: [[mobile-data#Mobile data#Android clean C task navigation]]
    @Test fun originalProjectsCollapseAndEnabledPlansIncludeRunning() {
        setup(offline = true)
        ui.onNodeWithContentDescription("刷新").assertDoesNotExist()
        ui.onNodeWithTag("owner-space-selector").assertDoesNotExist()
        ui.onNodeWithTag("list-search").assertExists()
        capture("conversations-zh")
        ui.onNodeWithTag("category:projects").performClick()
        ui.onNodeWithText("手机连接与项目同步").assertDoesNotExist()
        capture("projects-collapsed-zh")
        ui.onNodeWithTag("project-group:original-project").performClick()
        ui.waitUntil(10000) { org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !flow.value.busy && flow.value.conversationSelection.projectId == "original-project" }
        ui.onNodeWithText("手机连接与项目同步").assertExists()
        capture("projects-expanded-zh")
        ui.onAllNodesWithText("定时").onLast().performClick()
        ui.onNodeWithText("每日项目简报").assertExists()
        ui.onNodeWithText("每周资料整理").assertDoesNotExist()
        capture("schedules-enabled-zh")
        ui.onNodeWithTag("category:paused").performClick()
        ui.onNodeWithText("每周资料整理").assertExists()
        capture("schedules-paused-zh")
        ui.onAllNodesWithText("我的").onLast().performClick()
        ui.onAllNodesWithText("华为P70").onFirst().assertExists()
        ui.onNodeWithText("Windows").assertExists()
        ui.onNodeWithText("切换运行设备").assertExists()
        capture("account-zh")
    }
    // @lat: [[mobile-data#Mobile data#Android compact activity and composer stop]]
    @Test fun activityStartsFoldedAndEmptyComposerBecomesOriginalRunStop() {
        setup()
        ui.mainClock.autoAdvance = false
        ui.runOnUiThread {
            val c = flow.value.conversations.single()
            val now = "2026-10-15T08:01:00Z"
            val run = Run("original-run", conversationId = c.id, runtimeId = c.runtimeId, status = "running", lastRunEventSeq = "2", artifacts = emptyList(), activity = listOf(RunActivity("progress-1","progress","正在核对原项目文件",now), RunActivity("tool-1","tool_call","",now,toolName = "rg", toolKind = "terminal")), allowedActions = listOf("read","cancel"))
            flow.value = flow.value.copy(selected = c.copy(activeRunIds = listOf(run.runId)), runs = listOf(run), messages = listOf(Message(id = "user-1",conversationId = c.id,messageSeq = "1",kind = "user",content = "请核对项目实施进展",visibleToUser = true,createdAt = now)))
        }
        ui.mainClock.advanceTimeBy(100)
        ui.onNodeWithText("正在核对原项目文件").assertDoesNotExist()
        ui.onNodeWithText("停止当前运行").assertDoesNotExist()
        ui.onNodeWithText("对话与分析").assertDoesNotExist()
        ui.onNodeWithText("自动").assertExists()
        ui.onNodeWithText("opencode/big-pickle").assertExists()
        check(ui.onAllNodesWithText("OpenCode").onLast().fetchSemanticsNode().boundsInRoot.top < ui.onNodeWithText("思考").fetchSemanticsNode().boundsInRoot.top)
        ui.onNodeWithContentDescription("停止").assertIsEnabled()
        ui.mainClock.autoAdvance = false
        capture("conversation-running-start")
        ui.mainClock.advanceTimeBy(450); capture("conversation-running-mid")
        ui.mainClock.advanceTimeBy(450); capture("conversation-running-end")
        ui.mainClock.autoAdvance = true
        ui.onNodeWithText("思考").performClick()
        ui.onNodeWithText("正在核对原项目文件").assertExists()
        ui.onNodeWithText("1 次工具调用").performClick()
        ui.onNodeWithText("rg").assertExists()
        capture("conversation-expanded-zh")
        ui.onNodeWithTag("conversation-composer").performTextInput("下一步")
        ui.onNodeWithContentDescription("发送").assertIsNotEnabled()
        ui.runOnUiThread { model.language("en") }
        ui.onNodeWithText("Automatic").assertExists()
        capture("conversation-en")
        ui.runOnUiThread {
            val run = flow.value.runs.single()
            flow.value = flow.value.copy(selected = flow.value.selected!!.copy(activeRunIds = emptyList()), runs = listOf(run.copy(status = "succeeded")), messages = flow.value.messages + Message(id = "answer", conversationId = run.conversationId!!, messageSeq = "2", kind = "assistant", runId = run.runId, content = "Original final answer", visibleToUser = true, createdAt = "2026-10-15T08:02:00Z"))
        }
        ui.onNodeWithText("Original final answer").assertExists()
        ui.onAllNodesWithText("OpenCode").assertCountEquals(2)
        capture("conversation-completed-en")
    }
}
