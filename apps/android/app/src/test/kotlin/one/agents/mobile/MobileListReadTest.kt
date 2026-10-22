package one.agents.mobile

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.*
import androidx.lifecycle.ViewModelProvider
import kotlinx.serialization.json.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import one.agents.mobile.contract.*
import one.agents.mobile.net.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class MobileListReadTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private lateinit var model: MobileViewModel
    private val limits = Limits(100, 50000, 262144, 86400000, 7, 100000, 300000)
    private fun owner(capabilities: List<String>) = OwnerSpace("owner-1", "space-1", "Original Owner", "desktop", true, false, false, "Asia/Shanghai", capabilities, limits, "epoch-1")
    private fun conversation(id: String) = Conversation(id, "runtime_conversation", id, "runtime-1", pinned = false, archived = false, revision = "1", lastMessageSeq = "0", lastReadMessageSeq = "0", activity = "idle", activeRunIds = emptyList(), createdAt = "2026-10-05T00:00:00Z", updatedAt = "2026-10-05T00:00:00Z", allowedActions = listOf("read"))
    private fun conversations(ids: List<String>, cursor: String? = null) = Json.encodeToJsonElement(ConversationPage(ids.map(::conversation), cursor, "snapshot-1"))
    private fun schedules(ids: List<String>, cursor: String? = null) = Json.encodeToJsonElement(ScheduleSummaryPage(ids.map { ScheduleSummary(it, it, "runtime-1", scheduleExpression = "5m", schedulerTimeZone = "Asia/Shanghai", enabled = true, effectiveState = "enabled", concurrencyPolicy = "skip", timeoutMs = 600000, activeRunIds = emptyList(), pendingCount = 0, revision = "1", allowedActions = listOf("read")) }, cursor, "snapshot-1"))
    private val emptyPage = Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"1"}""")
    private fun scheduleDetail(id: String = "initial-schedule") = Json.encodeToJsonElement(Schedule(id, id, "Original schedule instructions", "runtime-1", scheduleExpression = "5m", schedulerTimeZone = "Asia/Shanghai", enabled = true, effectiveState = "running", concurrencyPolicy = "queue", timeoutMs = 600000, nextRunAt = "2026-10-05T01:00:00Z", activeRunIds = listOf("native-active"), pendingCount = 2, revision = "9", allowedActions = listOf("read")))
    private fun execution(id: String, scheduleId: String = "initial-schedule") = ScheduleExecution(id, scheduleId, "scheduled", triggeredAt = "2026-10-05T00:00:00Z", status = "succeeded", runtimeRunId = "native-$id", conversationId = "result-$id", summary = "Original scheduled summary")
    private fun history(ids: List<String>, cursor: String? = null, revision: String = "history-1", scheduleId: String = "initial-schedule") = Json.encodeToJsonElement(ScheduleExecutionPage(ids.map { execution(it, scheduleId) }, cursor, revision))
    private val resultMessages = Json.parseToJsonElement("""{"items":[{"id":"native-message","conversationId":"result-e1","messageSeq":"1","kind":"assistant","content":"Original scheduled result body","visibleToUser":true,"createdAt":"2026-10-05T00:01:00Z"}],"hasMoreBefore":false,"snapshotCursor":"cursor-1","snapshotRevision":"1"}""")
    private fun messagePage(sequences: List<String>, more: Boolean = false, cursor: String = "message-cursor", revision: String = "1", conversationId: String = "initial") = Json.encodeToJsonElement(MessagePage(sequences.map { Message("message-$it", conversationId, it, kind = "assistant", content = "Original body $it", visibleToUser = true, createdAt = "2026-10-05T00:00:00Z") }, more, cursor, revision))
    private data class Request(val method: String, val suffix: List<String>, val query: Map<String, String> = emptyMap(), val body: JsonObject? = null)
    private inner class Client : MobileControlClient("https://owner.example", { null }) {
        val calls = CopyOnWriteArrayList<Request>()
        var capabilities = listOf("conversation:read", "schedule:read")
        var bootstrapOwnerId = "owner-1"
        var handleRead: ((List<String>, Map<String, String>) -> JsonElement?)? = null
        var handleSearch: ((List<String>, JsonObject) -> JsonElement)? = null
        var handleMarkRead: ((String, String) -> JsonElement)? = null
        var handleAvatar: ((OwnerBinding, String, String) -> RuntimeAvatarBytes)? = null
        override fun runtimeAvatar(binding: OwnerBinding, runtimeId: String, avatarId: String): RuntimeAvatarBytes = handleAvatar?.invoke(binding, runtimeId, avatarId) ?: error("Unexpected avatar request")
        var handleRefresh: ((JsonObject) -> JsonElement)? = null
        override fun refreshCredential(body: JsonObject): JsonElement = handleRefresh?.invoke(body) ?: error("Unexpected credential refresh")
        override fun streamEvents(binding: OwnerBinding, cursor: String?, lastEventId: String?, consume: (StreamEvent) -> Unit, failed: (MobileApiException) -> Unit, opened: () -> Unit): MobileEventSubscription { opened(); return MobileEventSubscription {} }
        override fun markRead(binding: OwnerBinding, conversationId: String, sequence: String): JsonElement {
            calls.add(Request("POST", listOf("conversations", conversationId, "read"), body = buildJsonObject { put("lastReadMessageSeq", sequence) }))
            return handleMarkRead?.invoke(conversationId, sequence) ?: Json.encodeToJsonElement(ReadPosition(conversationId, sequence))
        }
        override fun read(binding: OwnerBinding, suffix: List<String>, query: Map<String, String>): JsonElement {
            calls.add(Request("GET", suffix, query))
            if (suffix == listOf("bootstrap")) return Json.encodeToJsonElement(Bootstrap(MOBILE_PROTOCOL, owner(capabilities).copy(ownerId = bootstrapOwnerId), "1", "2026-10-05T00:00:00Z", "epoch-1", capabilities, limits, "cursor-1"))
            handleRead?.invoke(suffix, query)?.let { return it }
            return when (suffix) {
                listOf("conversations") -> conversations(listOf("initial"))
                listOf("schedules") -> schedules(listOf("initial-schedule"))
                else -> emptyPage
            }
        }
        override fun search(binding: OwnerBinding, suffix: List<String>, body: JsonObject): JsonElement {
            calls.add(Request("POST", suffix, body = body))
            return handleSearch?.invoke(suffix, body) ?: error("Unexpected search")
        }
        override fun write(binding: OwnerBinding, suffix: List<String>, body: JsonObject?, mutationId: String, revision: String?, method: String): JsonElement {
            calls.add(Request(method, suffix, body = body))
            error("Unexpected business mutation in read navigation")
        }
    }
    @Before fun reset() {
        ui.runOnUiThread { model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.forget(); model.language("en") }
    }
    private fun avatarClient(): Client = Client().also { client ->
        client.handleRead = { suffix, _ -> if (suffix == listOf("runtimes")) Json.encodeToJsonElement(RuntimePage(listOf(Runtime("runtime-1", "Original agent", "local", avatar = "ava-original", color = "#F37021", healthy = true, capabilities = emptyList(), allowedActions = listOf("read"))), null, "1")) else null }
        ui.runOnUiThread { MobileViewModel::class.java.getDeclaredField("credentials").apply { isAccessible = true }.set(model, Credentials("phone-1", "test-token", "2099-01-01T00:00:00Z", "test-refresh", "2099-01-01T00:00:00Z", "1")) }
    }
    // @lat: [[mobile-data#Mobile data#Android avatar real list original runtime binding]]
    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE) fun originalListReadsOnlyCurrentRuntimeReferenceAndKeepsTaskStateIndependent() {
        val client = avatarClient()
        val requests = CopyOnWriteArrayList<List<Any>>()
        client.handleAvatar = { binding, runtime, avatar ->
            requests.add(listOf(binding, runtime, avatar))
            RuntimeAvatarBytes("image/png", java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII="))
        }
        connect(client)
        check(model.state.value.runtimes.single().avatar == "ava-original")
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50)); ui.onAllNodesWithTag("runtime-avatar-image", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        check(requests.single() == listOf(OwnerBinding("owner-1","space-1"), "runtime-1", "ava-original"))
        check(model.state.value.error == null && !model.state.value.busy)
        ui.onNodeWithTag("runtime-avatar-image", useUnmergedTree = true).assertIsDisplayed()
    }
    // @lat: [[mobile-data#Mobile data#Android avatar connection loss rejects late bytes]]
    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE) fun forgettingConnectionWhileImageReadIsPendingCannotInstallOldImage() {
        val client = avatarClient(); val started = CountDownLatch(1); val release = CountDownLatch(1); val completed = CountDownLatch(1)
        val originalReads = client.handleRead
        client.handleRead = { suffix, query -> if (suffix == listOf("conversations")) conversations(emptyList()) else originalReads?.invoke(suffix,query) }
        client.handleAvatar = { _, _, _ -> started.countDown(); try { check(release.await(10,TimeUnit.SECONDS)); RuntimeAvatarBytes("image/png", java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII=")) } finally { completed.countDown() } }
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)
        var result: android.graphics.Bitmap? = null; var finished = false
        try {
            connect(client)
            ui.runOnUiThread { scope.launch { try { result = model.loadRuntimeAvatar(model.state.value.runtimes.single()) } finally { finished = true } } }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50)); started.count == 0L }
            perform { model.forget() }; release.countDown()
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); completed.count == 0L && finished }
            ui.onNodeWithTag("runtime-avatar-image").assertDoesNotExist()
            check(result == null)
            check(model.state.value.owner == null && model.state.value.runtimes.isEmpty())
        } finally { release.countDown(); scope.cancel() }
    }
    // @lat: [[mobile-data#Mobile data#Android credential late refresh connection admission]]
    @Test fun oldCredentialRefreshIsCancelledBeforeStorageAfterConnectionIsForgotten() {
        val client = avatarClient(); val originalReads = client.handleRead
        client.handleRead = { suffix, query -> if (suffix == listOf("conversations")) conversations(emptyList()) else originalReads?.invoke(suffix,query) }
        connect(client)
        perform { model.observeForeground(false) }
        val prefs = ui.activity.getSharedPreferences("connection", android.content.Context.MODE_PRIVATE)
        prefs.edit().putString("future-preference","preserve").commit()
        ui.runOnUiThread { MobileViewModel::class.java.getDeclaredField("credentials").apply { isAccessible = true }.set(model, Credentials("phone-1", "expired", "2020-01-01T00:00:00Z", "test-refresh", "2099-01-01T00:00:00Z", "1")) }
        val started = CountDownLatch(1); val release = CountDownLatch(1)
        client.handleRefresh = { started.countDown(); check(release.await(10,TimeUnit.SECONDS)); Json.encodeToJsonElement(Credentials("phone-1","late-token","2099-01-01T00:00:00Z","late-refresh","2099-01-01T00:00:00Z","1")) }
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)
        var cancelled = false; var finished = false
        try {
            ui.runOnUiThread { scope.launch { try { model.loadRuntimeAvatar(model.state.value.runtimes.single()) } catch (_: kotlinx.coroutines.CancellationException) { cancelled = true } finally { finished = true } } }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50)); started.count == 0L }
            perform { model.forget() }; release.countDown()
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); finished }
            check(cancelled && model.state.value.owner == null && prefs.getString("credentials",null) == null && prefs.getString("refresh_rotation",null) == null)
            check(prefs.getString("future-preference",null) == "preserve")
        } finally { release.countDown(); scope.cancel(); prefs.edit().remove("future-preference").commit() }
    }
    // @lat: [[mobile-data#Mobile data#Android avatar revoked device clears connection]]
    @Test fun revokedImageReadClearsOriginalConnectionAndDoesNotBecomeTaskFailure() {
        val client = avatarClient()
        client.handleAvatar = { _, _, _ -> throw MobileApiException("revoked",403) }
        connect(client)
        ui.waitUntil(10000) { model.state.value.owner == null }
        check(model.state.value.runtimes.isEmpty() && model.state.value.error == null)
    }
    // @lat: [[mobile-data#Mobile data#Android original conversation preview single line]]
    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE) fun authorizedOriginalPreviewUsesOneEllipsizedLineAtNarrowWidth() {
        val client = Client(); val preview = "原消息 excerpt " + "long original text ".repeat(10)
        client.handleRead = { suffix, _ -> if (suffix == listOf("conversations")) Json.encodeToJsonElement(ConversationPage(listOf(conversation("preview").copy(lastMessagePreview = preview)),null,"1")) else null }
        connect(client)
        val layouts = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        ui.onNodeWithText(preview,useUnmergedTree=true).assertIsDisplayed().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
        check(layouts.single().lineCount == 1 && layouts.single().isLineEllipsized(0))
        check(model.state.value.conversations.single().lastMessagePreview == preview && model.state.value.selected == null)
    }
    // @lat: [[mobile-data#Mobile data#Android runtime and policy frozen directory completeness]]
    @Test fun originalRuntimeAndPolicyDirectoriesLoadAllPagesAndRefuseChangedSnapshot() {
        val client = Client(); client.capabilities = listOf("conversation:read", "conversation:create")
        var changed = false
        client.handleRead = { suffix, query ->
            val second = query["cursor"] != null
            when (suffix) {
                listOf("runtimes") -> Json.encodeToJsonElement(RuntimePage(listOf(Runtime(if (second) "runtime-2" else "runtime-1", if (second) "Second agent" else "First agent", "local", healthy = true, capabilities = emptyList(), allowedActions = listOf("read", "create"))), if (second) null else "rt-next", if (changed && second) "2" else "1"))
                listOf("execution-policies") -> Json.encodeToJsonElement(ExecutionPolicyPage(listOf(ExecutionPolicy(if (second) "policy-2" else "policy-1", if (second) "runtime-2" else "runtime-1", mode = if (second) "project_write" else "inspect", enforced = true, unattendedApproved = false, allowedActions = listOf("create"))), if (second) null else "policy-next", "1"))
                else -> null
            }
        }
        connect(client)
        check(model.state.value.runtimes.map { it.name } == listOf("First agent", "Second agent"))
        check(model.state.value.policies.map { it.id } == listOf("policy-1", "policy-2"))
        check(client.calls.any { it.suffix == listOf("runtimes") && it.query["cursor"] == "rt-next" } && client.calls.any { it.suffix == listOf("execution-policies") && it.query["cursor"] == "policy-next" })
        changed = true; perform { model.refresh() }
        check(model.state.value.runtimes.isEmpty() && model.state.value.error == "protocol_incompatible")
    }
    // @lat: [[mobile-data#Mobile data#Android unread sequence precision]]
    @Test fun unreadBadgeUsesOriginalSequenceBeyondLongAndClearsAtConfirmedBoundary() {
        val client = Client()
        val pending = conversation("pending").copy(lastMessageSeq = "9007199254740993123457", lastReadMessageSeq = "9007199254740993123456")
        check(conversationUnread(pending))
        check(!conversationUnread(pending.copy(lastReadMessageSeq = pending.lastMessageSeq)))
        check(!conversationUnread(pending.copy(lastReadMessageSeq = "9007199254740993123458")))
        client.handleRead = { suffix, _ -> if (suffix == listOf("conversations")) Json.encodeToJsonElement(ConversationPage(listOf(pending), null, "1")) else null }
        connect(client)
        ui.onNodeWithContentDescription("Unread").assertIsDisplayed()
        client.handleRead = { suffix, _ -> if (suffix == listOf("conversations")) Json.encodeToJsonElement(ConversationPage(listOf(pending.copy(lastReadMessageSeq = pending.lastMessageSeq)), null, "1")) else null }
        perform { model.refresh() }
        ui.onNodeWithContentDescription("Unread").assertDoesNotExist()
    }
    // @lat: [[mobile-data#Mobile data#Android filter request and cursor fidelity]]
    @Test fun projectArchiveStatusFiltersStayTypedAcrossGetSearchMoreAndExpiredCursor() {
        val client = Client()
        val filtered = conversation("filtered").copy(projectId = "p2", archived = true, activity = "needs_attention")
        client.handleRead = { suffix, query -> when {
            suffix == listOf("projects") -> Json.encodeToJsonElement(ProjectPage(listOf(Project(if (query["cursor"] == null) "p1" else "p2", "Project ${query["cursor"] ?: "one"}", emptyList())), if (query["cursor"] == null) "p-cursor" else null, "1"))
            suffix == listOf("conversations") && query["projectId"] == "p2" -> Json.encodeToJsonElement(ConversationPage(listOf(filtered), "c-cursor", "1"))
            else -> null
        } }
        var firstPages = 0
        client.handleSearch = { _, body ->
            if (body["cursor"] != null) throw MobileApiException("cursor_expired", 410)
            firstPages++; Json.encodeToJsonElement(ConversationPage(listOf(filtered.copy(id = "fresh-$firstPages")), if (firstPages == 1) "expired" else null, "1"))
        }
        connect(client)
        check(model.state.value.projects.map { it.id } == listOf("p1", "p2"))
        val filters = MobileListSelection("p2", "attention", true)
        perform { model.selectListFilters(filters, false) }
        val get = client.calls.last(); check(get.method == "GET" && get.query == mapOf("projectId" to "p2", "state" to "attention", "archived" to "true"))
        perform { model.search("正文", false) }; perform { model.more(false) }
        val posts = client.calls.filter { it.method == "POST" }
        check(posts.size == 3 && posts.all { it.body!!["projectId"]!!.jsonPrimitive.content == "p2" && it.body["state"]!!.jsonPrimitive.content == "attention" && it.body["archived"]!!.jsonPrimitive.boolean && it.body["query"]!!.jsonPrimitive.content == "正文" })
        check(posts[1].body!!["cursor"]!!.jsonPrimitive.content == "expired" && posts[2].body!!["cursor"] == null)
        check(model.state.value.conversationSelection == filters && model.state.value.conversations.single().id == "fresh-2" && model.state.value.conversationCursor == null)
    }
    // @lat: [[mobile-data#Mobile data#Android failed filter preserves original list authority]]
    @Test fun failedFilterLeavesTheOriginalQueryAndCursorAndCatalogFailureIsIndependent() {
        val client = Client()
        client.handleRead = { suffix, _ -> if (suffix == listOf("projects")) Json.encodeToJsonElement(ProjectPage(listOf(Project("p1", "First", emptyList())), null, "1")) else null }
        client.handleSearch = { _, body ->
            if (body["projectId"] != null) throw MobileApiException("owner_offline", 503)
            conversations(listOf(if (body["cursor"] == null) "old" else "more"), if (body["cursor"] == null) "old-cursor" else null)
        }
        connect(client); perform { model.search("original", false) }; perform { model.selectListFilters(MobileListSelection("p1"), false) }
        check(model.state.value.conversationSelection == MobileListSelection() && model.state.value.conversationQuery == "original" && model.state.value.conversationCursor == "old-cursor")
        perform { model.more(false) }
        check(client.calls.last().body!!["projectId"] == null && client.calls.last().body!!["query"]!!.jsonPrimitive.content == "original")
        client.handleRead = { suffix, _ -> if (suffix == listOf("projects")) throw MobileApiException("owner_offline", 503) else null }
        perform { model.refresh() }
        check(model.state.value.projectError == "owner_offline" && model.state.value.conversations.isNotEmpty() && model.state.value.scheduleError == null)
    }
    // @lat: [[mobile-data#Mobile data#Android filter source reset and list isolation]]
    @Test fun eachListHasIndependentFiltersRefreshRetainsThemAndAnotherOwnerResetsThem() {
        val client = Client()
        client.handleRead = { suffix, query -> when {
            suffix == listOf("projects") -> Json.encodeToJsonElement(ProjectPage(listOf(Project("p1", "First", emptyList())), null, "1"))
            suffix == listOf("conversations") && query["state"] == "active" -> Json.encodeToJsonElement(ConversationPage(listOf(conversation("running").copy(projectId = "p1", activity = "active")), null, "1"))
            suffix == listOf("schedules") && query["state"] == "paused" -> Json.encodeToJsonElement(ScheduleSummaryPage(listOf(ScheduleSummary("paused", "Paused", "runtime-1", projectId = "p1", scheduleExpression = "5m", schedulerTimeZone = "Asia/Shanghai", enabled = false, effectiveState = "paused", concurrencyPolicy = "skip", timeoutMs = 600000, activeRunIds = emptyList(), pendingCount = 0, revision = "1", allowedActions = listOf("read"))), null, "1"))
            else -> null
        } }
        connect(client)
        perform { model.selectListFilters(MobileListSelection("p1", "active"), false) }
        perform { model.selectListFilters(MobileListSelection("p1", "paused"), true) }
        perform { model.refresh() }
        check(model.state.value.conversationSelection.state == "active" && model.state.value.scheduleSelection.state == "paused")
        check(model.state.value.conversations.single().id == "running" && model.state.value.schedules.single().id == "paused")
        client.bootstrapOwnerId = "other-owner"
        perform { model.selectOwner(owner(client.capabilities).copy(ownerId = "other-owner")) }
        check(model.state.value.conversationSelection == MobileListSelection() && model.state.value.scheduleSelection == MobileListSelection())
        check(model.state.value.conversationQuery.isEmpty() && model.state.value.scheduleQuery.isEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Viewport read boundary]]
    @Test fun readBoundaryTracksVisibleViewportInsteadOfLatestFetchedMessage() {
        val client = messageClient { messagePage((1..100).map { it.toString() }) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); client.calls.any { it.suffix.last() == "read" } }
        val initial = client.calls.filter { it.suffix.last() == "read" }.last().body!!["lastReadMessageSeq"]!!.jsonPrimitive.content.toInt()
        check(initial in 1..30)
        ui.onNodeWithTag("conversation-messages").performScrollToIndex(60)
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.selected!!.lastReadMessageSeq.toInt() > 60 }
        check(model.state.value.selected!!.lastReadMessageSeq.toInt() < 100)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Read failure and explicit retry]]
    @Test fun readFailureRetainsAuthorityAndDoesNotLoopUntilRetry() {
        val client = messageClient { messagePage(listOf("1")) }
        client.handleMarkRead = { _, _ -> throw MobileApiException("owner_offline", 503) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.readError != null }
        check(model.state.value.selected!!.lastReadMessageSeq == "0")
        ui.runOnUiThread { model.acknowledgeVisible("initial", listOf("1")) }
        ui.waitForIdle(); check(client.calls.count { it.suffix.last() == "read" } == 1)
        client.handleMarkRead = { id, sequence -> Json.encodeToJsonElement(ReadPosition(id, sequence)) }
        ui.onNodeWithText("Retry").performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.selected!!.lastReadMessageSeq == "1" }
        check(model.state.value.readError == null && client.calls.count { it.suffix.last() == "read" } == 2)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Read identity and precision]]
    @Test fun exactLargeReadSequenceRejectsUnloadedAndWrongConversationBoundaries() {
        val sequence = "900719925474099312345678901234567890"
        val client = messageClient { messagePage(listOf(sequence)) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.selected!!.lastReadMessageSeq == sequence }
        val count = client.calls.size
        ui.runOnUiThread { model.acknowledgeVisible("initial", listOf("999999999999999999999999999999999999")); model.acknowledgeVisible("other", listOf(sequence)) }
        ui.waitForIdle(); check(client.calls.size == count)
        check(client.calls.single { it.suffix.last() == "read" }.body!!["lastReadMessageSeq"]!!.jsonPrimitive.content == sequence)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Late read confirmation]]
    @Test fun lateReadConfirmationCannotReopenConversationOrCancelOwnerRun() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val client = messageClient { messagePage(listOf("1")) }
        client.handleMarkRead = { id, sequence -> entered.countDown(); check(release.await(10, TimeUnit.SECONDS)); Json.encodeToJsonElement(ReadPosition(id, sequence)) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        try {
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); entered.count == 0L }
            ui.runOnUiThread { model.back() }; release.countDown()
            ui.waitForIdle(); check(model.state.value.selected == null && model.state.value.readError == null)
            check(client.calls.none { it.suffix.last() == "cancel" })
        } finally { release.countDown() }
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Invalid read confirmation]]
    @Test fun wrongOwnerResponseDoesNotOptimisticallyMarkRead() {
        val client = messageClient { messagePage(listOf("1")) }
        client.handleMarkRead = { _, _ -> Json.encodeToJsonElement(ReadPosition("other", "1")) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.readError == "protocol_incompatible" }
        check(model.state.value.selected!!.lastReadMessageSeq == "0")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Serialized read observations]]
    @Test fun scrollingWhileAcknowledgementIsPendingCoalescesWithoutParallelRequests() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val client = messageClient { messagePage((1..100).map { it.toString() }) }
        var active = 0; var maximum = 0
        client.handleMarkRead = { id, sequence ->
            active++; maximum = maxOf(maximum, active); entered.countDown()
            check(release.await(10, TimeUnit.SECONDS)); active--
            Json.encodeToJsonElement(ReadPosition(id, sequence))
        }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        try {
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); entered.count == 0L }
            ui.runOnUiThread { model.acknowledgeVisible("initial", listOf("50")); model.acknowledgeVisible("initial", listOf("80")) }
            release.countDown()
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.selected!!.lastReadMessageSeq == "80" }
            val requests = client.calls.filter { it.suffix.last() == "read" }
            check(maximum == 1 && requests.size == 2)
            check(requests.last().body!!["lastReadMessageSeq"]!!.jsonPrimitive.content == "80")
        } finally { release.countDown() }
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Hidden read boundary rejection]]
    @Test fun hiddenLoadedMessagesCannotBecomeReadBoundaries() {
        val client = messageClient { Json.encodeToJsonElement(MessagePage(listOf(Message("hidden", "initial", "99", kind = "assistant", content = "Private", visibleToUser = false, createdAt = "2026-10-05T00:00:00Z")), false, "cursor", "1")) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.runOnUiThread { model.acknowledgeVisible("initial", listOf("99")) }
        ui.waitForIdle(); check(client.calls.none { it.suffix.last() == "read" })
        check(model.state.value.selected!!.lastReadMessageSeq == "0")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Read credential revocation]]
    @Test fun revokedReadAcknowledgementClearsOwnerAndLoadedBusinessViews() {
        val client = messageClient { messagePage(listOf("1")) }
        client.handleMarkRead = { _, _ -> throw MobileApiException("revoked", 403) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.error == "revoked" }
        check(model.state.value.owner == null && model.state.value.selected == null && model.state.value.messages.isEmpty())
    }
    private fun perform(block: () -> Unit) {
        ui.runOnUiThread(block)
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
    }
    private fun connect(client: Client) {
        // Test-only reflection avoids bypass hooks or replacement credential storage in the app.
        ui.runOnUiThread { MobileViewModel::class.java.getDeclaredField("client").apply { isAccessible = true }.set(model, client) }
        perform { model.selectOwner(owner(client.capabilities)) }
    }
    private fun historyClient(page: (Map<String, String>) -> JsonElement): Client = Client().also { client ->
        client.handleRead = { suffix, query -> when (suffix) {
            listOf("schedules", "initial-schedule") -> scheduleDetail()
            listOf("schedules", "initial-schedule", "executions") -> page(query)
            listOf("conversations", "result-e1") -> Json.encodeToJsonElement(conversation("result-e1"))
            listOf("conversations", "result-e1", "messages") -> resultMessages
            else -> null
        } }
    }
    private fun messageClient(page: (Map<String, String>) -> JsonElement): Client = Client().also { client ->
        client.handleRead = { suffix, query -> when (suffix) {
            listOf("conversations", "initial") -> Json.encodeToJsonElement(conversation("initial"))
            listOf("conversations", "initial", "messages") -> page(query)
            else -> null
        } }
    }

    // @lat: [[mobile-data#Mobile data#Android request identity section isolation and no ID retry]]
    @Test fun unknownListFailureKeepsItsOwnTraceAndRetryWithoutIdClearsIt() {
        var requestId: String? = "conversation-original-51"
        val client = Client()
        client.handleRead = { suffix, _ -> when (suffix) {
            listOf("conversations") -> throw MobileApiException("new_owner_error", 500, requestId)
            listOf("schedules") -> throw MobileApiException("new_owner_error", 500, "schedule-original-51")
            else -> null
        } }
        connect(client)
        ui.onNodeWithText("Request ID: conversation-original-51").assertIsDisplayed()
        ui.onNodeWithText("Request ID: schedule-original-51").assertDoesNotExist()
        check(model.state.value.failureRequestId("schedule", "new_owner_error") == "schedule-original-51")
        requestId = null; perform { model.refresh() }
        ui.onNodeWithText("Request ID: conversation-original-51").assertDoesNotExist()
        check(model.state.value.failureRequestId("conversation", "new_owner_error") == null)
        ui.onAllNodesWithText("Schedules").onLast().performClick()
        ui.onNodeWithText("Request ID: schedule-original-51").assertIsDisplayed()
        client.handleRead = null; perform { model.refresh() }
        check(model.state.value.failureTraces.isEmpty())
        ui.onNodeWithText("Request ID: schedule-original-51").assertDoesNotExist()
    }
    // @lat: [[mobile-data#Mobile data#Android request identity rejects late history error]]
    @Test fun historyErrorAfterLeavingDetailCannotPublishItsRequestIdentity() {
        val started = CountDownLatch(1); val release = CountDownLatch(1)
        val client = historyClient { started.countDown(); check(release.await(10, TimeUnit.SECONDS)); throw MobileApiException("new_owner_error", 500, "old-detail-request-51") }
        try {
            connect(client)
            ui.runOnUiThread { model.openSchedule(model.state.value.schedules.single()) }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); started.count == 0L }
            ui.onNodeWithContentDescription("Back").performClick(); release.countDown()
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
            check(model.state.value.historyError == null)
            check(model.state.value.failureTraces.values.none { it.requestId == "old-detail-request-51" })
            ui.onNodeWithText("Request ID: old-detail-request-51").assertDoesNotExist()
        } finally { release.countDown() }
    }
    // @lat: [[mobile-data#Mobile data#Android global action request identity and dismissal]]
    @Test fun bootstrapFailureShowsOriginalTraceAndDismissalHidesItWithoutWriting() {
        val client = Client()
        client.bootstrapOwnerId = "foreign-owner"
        // Bootstrap response identity validation errors have no remote trace.
        connect(client)
        check(model.state.value.error == "protocol_incompatible")
        check(model.state.value.failureRequestId("global", "protocol_incompatible") == null)
        client.bootstrapOwnerId = "owner-1"
        client.handleRead = { suffix, _ -> if (suffix == listOf("runtimes")) throw MobileApiException("new_owner_error",500,"original-global-51") else null }
        perform { model.selectOwner(owner(client.capabilities)) }
        ui.onNodeWithText("Request ID: original-global-51").assertIsDisplayed()
        ui.onNodeWithContentDescription("Close").performClick()
        ui.onNodeWithText("Request ID: original-global-51").assertDoesNotExist()
        check(model.state.value.error == null && client.calls.all { it.method == "GET" })
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Original search pagination]]
    @Test fun searchAndMoreRetainSeparateQueriesForConversationsAndSchedules() {
        val client = Client()
        client.handleSearch = { suffix, body ->
            val second = body["cursor"] != null
            if (suffix.first() == "schedules") schedules(listOf(if (second) "s2" else "s1"), if (second) null else "s-cursor")
            else conversations(listOf(if (second) "c2" else "c1"), if (second) null else "c-cursor")
        }
        connect(client)
        perform { model.search("weekly plan", true) }
        perform { model.search("weekly conversation", false) }
        perform { model.more(true) }
        perform { model.more(false) }
        check(model.state.value.error == null)
        check(model.state.value.schedules.map { it.id } == listOf("s1", "s2"))
        check(model.state.value.conversations.map { it.id } == listOf("c1", "c2"))
        val posted = client.calls.filter { it.method == "POST" }
        check(posted.map { it.body?.get("query")?.jsonPrimitive?.content } == listOf("weekly plan", "weekly conversation", "weekly plan", "weekly conversation"))
        check(posted[2].body?.get("cursor")?.jsonPrimitive?.content == "s-cursor")
        check(posted[3].body?.get("cursor")?.jsonPrimitive?.content == "c-cursor")
        check(client.calls.none { it.method == "GET" && "cursor" in it.query })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Expired list snapshot replacement]]
    @Test fun expiredCursorReloadsSameQueryAndReplacesOldSnapshot() {
        val client = Client(); var firstPageCount = 0
        client.handleSearch = { _, body ->
            if (body["cursor"] != null) throw MobileApiException("cursor_expired", 410)
            firstPageCount++
            conversations(listOf(if (firstPageCount == 1) "old" else "fresh"), if (firstPageCount == 1) "expired" else null)
        }
        connect(client); perform { model.search("unchanged", false) }; perform { model.more(false) }
        check(model.state.value.conversations.map { it.id } == listOf("fresh"))
        check(model.state.value.conversationCursor == null && model.state.value.error == null)
        check(client.calls.filter { it.method == "POST" }.all { it.body?.get("query")?.jsonPrimitive?.content == "unchanged" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Failed search keeps original cursor conditions]]
    @Test fun failedSearchDoesNotBindExistingCursorToNewQueryAndClearReturnsToGet() {
        val client = Client()
        client.handleSearch = { _, body ->
            if (body["query"]?.jsonPrimitive?.content == "bad") throw MobileApiException("owner_offline", 503)
            conversations(listOf(if (body["cursor"] == null) "old" else "more"), if (body["cursor"] == null) "old-cursor" else null)
        }
        connect(client); perform { model.search("good", false) }; perform { model.search("bad", false) }; perform { model.more(false) }
        check(client.calls.last().body?.get("query")?.jsonPrimitive?.content == "good")
        perform { model.search("   ", false) }
        check(client.calls.last().method == "GET" && client.calls.last().query.isEmpty())
        check(model.state.value.conversationQuery.isEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Read capability isolation]]
    @Test fun ungrantedSchedulesAreNotRequestedAndCatalogFailureDoesNotHideConversations() {
        val client = Client(); client.capabilities = listOf("conversation:read")
        client.handleRead = { suffix, _ -> if (suffix == listOf("runtimes")) throw MobileApiException("requires_owner_action", 503) else null }
        connect(client)
        check(model.state.value.conversations.map { it.id } == listOf("initial"))
        check(model.state.value.scheduleError == "requires_owner_action")
        check(model.state.value.error == "requires_owner_action")
        check(client.calls.none { it.suffix == listOf("schedules") || it.suffix == listOf("execution-policies") })
        ui.onNodeWithContentDescription("New conversation").assertDoesNotExist()
        val before = client.calls.size; perform { model.search("plan", true) }
        check(client.calls.size == before && model.state.value.error == "scope_denied")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Independent list read failure]]
    @Test fun failedScheduleReadIsNotShownAsAnEmptySuccessfulList() {
        val client = Client()
        client.handleRead = { suffix, _ -> if (suffix == listOf("schedules")) throw MobileApiException("requires_owner_action", 409) else null }
        connect(client)
        check(model.state.value.conversations.isNotEmpty())
        check(model.state.value.scheduleError == "requires_owner_action")
        check(model.state.value.conversationError == null)
        ui.onAllNodesWithText("Schedules").onLast().performClick()
        ui.onNodeWithText("Continue this action on your Owner.").assertIsDisplayed()
        ui.onNodeWithText("No schedules here yet").assertDoesNotExist()
        client.handleRead = null; perform { model.refresh() }
        check(model.state.value.scheduleError == null && model.state.value.schedules.isNotEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Bootstrap space identity refusal]]
    @Test fun differentOwnerBootstrapIsRejectedBeforeBusinessReads() {
        val client = Client(); client.bootstrapOwnerId = "different-owner"
        connect(client)
        check(model.state.value.owner == null && model.state.value.error == "protocol_incompatible")
        check(client.calls.size == 1)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Read authentication failure]]
    @Test fun revocationIsNotSwallowedAsAPartialListError() {
        val client = Client()
        client.handleRead = { suffix, _ -> if (suffix == listOf("schedules")) throw MobileApiException("revoked", 403) else null }
        connect(client)
        check(model.state.value.owner == null && model.state.value.conversations.isEmpty())
        check(model.state.value.error == "revoked" && !model.state.value.busy)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Nullable message identity display]]
    @Test fun nullableMessageIdsRenderSeparateOriginalSequences() {
        val client = Client()
        client.handleRead = { suffix, _ -> when (suffix) {
            listOf("conversations", "initial") -> Json.encodeToJsonElement(conversation("initial"))
            listOf("conversations", "initial", "messages") -> Json.parseToJsonElement("""{"items":[{"id":null,"conversationId":"initial","messageSeq":"1","kind":"user","content":"Original user body","visibleToUser":true,"createdAt":"2026-10-05T00:00:00Z"},{"id":null,"conversationId":"initial","messageSeq":"2","kind":"assistant","content":"Original reply body","visibleToUser":true,"createdAt":"2026-10-05T00:00:01Z"}],"hasMoreBefore":false,"snapshotCursor":"cursor-1","snapshotRevision":"1"}""")
            else -> null
        } }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        check(model.state.value.error == null && model.state.value.messages.size == 2)
        ui.onNodeWithText("Original user body").assertIsDisplayed()
        ui.onNodeWithText("Original reply body").assertIsDisplayed()
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Original schedule history navigation]]
    @Test fun nativeHistoryShowsOriginalDefinitionAndReturnsFromOriginalResultConversation() {
        val client = historyClient { history(listOf("e1")) }; connect(client)
        ui.onAllNodesWithText("Schedules").onLast().performClick()
        ui.onNodeWithTag("schedule-row:initial-schedule").performScrollTo().assertIsDisplayed().performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.viewedSchedule != null && !model.state.value.busy }
        ui.onNodeWithText("Original schedule instructions").assertIsDisplayed()
        ui.runOnUiThread { model.language("zh-CN") }
        ui.onNodeWithTag("schedule-history").performScrollToNode(hasText("执行历史"))
        ui.onNodeWithText("执行历史").assertIsDisplayed()
        ui.runOnUiThread { model.language("en") }
        ui.onNodeWithTag("schedule-history").performScrollToNode(hasText("Open result conversation"))
        ui.onNodeWithText("Original scheduled summary").assertIsDisplayed()
        ui.onNodeWithText("Open result conversation").performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.selected != null && !model.state.value.busy }
        ui.onNodeWithText("Original scheduled result body").assertIsDisplayed()
        check(model.state.value.selected?.id == "result-e1")
        ui.onNodeWithContentDescription("Back").performClick()
        check(model.state.value.viewedSchedule?.id == "initial-schedule" && model.state.value.scheduleExecutions.single().id == "e1")
        ui.onNodeWithContentDescription("Back").performClick()
        check(model.state.value.viewedSchedule == null && model.state.value.scheduleExecutions.isEmpty())
        check(client.calls.all { it.method == "GET" || (it.method == "POST" && it.suffix.last() == "read" && it.body?.keys == setOf("lastReadMessageSeq")) })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Long schedule history pagination]]
    @Test fun historyPastOneHundredRunsKeepsOriginalIdsAndFrozenRevision() {
        val client = historyClient { query -> if (query["cursor"] == null) history((1..100).map { "e$it" }, "history-cursor") else history((101..125).map { "e$it" }) }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }
        check(model.state.value.scheduleExecutions.size == 100)
        perform { model.moreScheduleHistory() }
        check(model.state.value.scheduleExecutions.size == 125 && model.state.value.historyCursor == null)
        check(model.state.value.scheduleExecutions.last().conversationId == "result-e125")
        check(client.calls.last().suffix == listOf("schedules", "initial-schedule", "executions") && client.calls.last().query == mapOf("cursor" to "history-cursor"))
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Expired schedule history replacement]]
    @Test fun expiredHistoryCursorReplacesOldSnapshotRatherThanAppendingIt() {
        var fresh = false
        val client = historyClient { query ->
            if (query["cursor"] != null) { fresh = true; throw MobileApiException("cursor_expired", 410) }
            if (fresh) history(listOf("fresh"), revision = "history-2") else history(listOf("old"), "expired")
        }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }; perform { model.moreScheduleHistory() }
        check(model.state.value.scheduleExecutions.map { it.id } == listOf("fresh"))
        check(model.state.value.historySnapshotRevision == "history-2" && model.state.value.historyError == null)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Schedule history error is not empty success]]
    @Test fun historyFailurePreservesDefinitionAndDisplaysAnErrorWithoutEmptySuccess() {
        val client = historyClient { throw MobileApiException("requires_owner_action", 409) }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }
        ui.onNodeWithText("Original schedule instructions").assertIsDisplayed()
        ui.onNodeWithTag("schedule-history").performScrollToNode(hasText("Continue this action on your Owner."))
        ui.onNodeWithText("Continue this action on your Owner.").assertIsDisplayed()
        ui.onNodeWithText("No executions yet").assertDoesNotExist()
        check(model.state.value.viewedSchedule?.revision == "9" && model.state.value.historyError == "requires_owner_action")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Schedule history identity and snapshot refusal]]
    @Test fun historyFromAnotherScheduleOrChangedFrozenSnapshotIsRefused() {
        var wrongSchedule = true
        val client = historyClient { query ->
            if (wrongSchedule) history(listOf("foreign"), scheduleId = "other-schedule")
            else if (query["cursor"] == null) history(listOf("e1"), "more") else history(listOf("e2"), revision = "changed")
        }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }
        check(model.state.value.historyError == "protocol_incompatible" && model.state.value.scheduleExecutions.isEmpty())
        wrongSchedule = false; perform { model.refreshViewedSchedule() }; perform { model.moreScheduleHistory() }
        check(model.state.value.scheduleExecutions.map { it.id } == listOf("e1") && model.state.value.historyError == "protocol_incompatible")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Schedule result read scope]]
    @Test fun resultNavigationRequiresConversationReadAndUsesStoredOriginalBinding() {
        val client = historyClient { history(listOf("e1")) }; client.capabilities = listOf("schedule:read")
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }
        ui.onNodeWithText("Open result conversation").assertDoesNotExist()
        val before = client.calls.size
        perform { model.openExecutionConversation(model.state.value.scheduleExecutions.single().copy(conversationId = "fake-new-conversation")) }
        check(client.calls.size == before && model.state.value.error == "scope_denied")
        client.capabilities = listOf("schedule:read", "conversation:read"); perform { model.refresh() }; perform { model.openSchedule(model.state.value.schedules.single()) }
        perform { model.openExecutionConversation(model.state.value.scheduleExecutions.single().copy(conversationId = "fake-new-conversation")) }
        check(model.state.value.selected?.id == "result-e1")
        check(client.calls.none { "fake-new-conversation" in it.suffix })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Late detail response after back]]
    @Test fun returningBeforeDetailArrivesDoesNotReopenItOrCancelActiveRun() {
        val started = CountDownLatch(1); val release = CountDownLatch(1)
        val client = historyClient { history(listOf("e1")) }
        val original = client.handleRead
        client.handleRead = { suffix, query ->
            if (suffix == listOf("schedules", "initial-schedule")) { started.countDown(); check(release.await(10, TimeUnit.SECONDS)) }
            original?.invoke(suffix, query)
        }
        connect(client)
        ui.runOnUiThread { model.openSchedule(model.state.value.schedules.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); started.count == 0L }
        check(model.state.value.openingDetail)
        ui.onNodeWithContentDescription("Back").performClick(); release.countDown()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
        check(model.state.value.viewedSchedule == null && model.state.value.scheduleExecutions.isEmpty() && !model.state.value.openingDetail)
        check(client.calls.none { it.suffix.last() == "executions" || it.method != "GET" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Late history response after back]]
    @Test fun returningAfterDefinitionLoadsRejectsLateExecutionHistory() {
        val started = CountDownLatch(1); val release = CountDownLatch(1)
        val client = historyClient { started.countDown(); check(release.await(10, TimeUnit.SECONDS)); history(listOf("e1"), "late-cursor") }
        connect(client)
        ui.runOnUiThread { model.openSchedule(model.state.value.schedules.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); started.count == 0L }
        check(model.state.value.viewedSchedule?.activeRunIds == listOf("native-active"))
        ui.onNodeWithContentDescription("Back").performClick(); release.countDown()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
        check(model.state.value.viewedSchedule == null && model.state.value.scheduleExecutions.isEmpty() && model.state.value.historyCursor == null)
        check(client.calls.all { it.method == "GET" || (it.method == "POST" && it.suffix.last() == "read" && it.body?.keys == setOf("lastReadMessageSeq")) })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Owner schedule time zone display]]
    @Test fun scheduleTimesFollowOwnerTimeZoneIncludingDifferentCalendarDate() {
        val client = historyClient { history(emptyList()) }
        val original = client.handleRead
        client.handleRead = { suffix, query ->
            if (suffix == listOf("schedules", "initial-schedule")) {
                val detail = Json.decodeFromJsonElement<Schedule>(scheduleDetail())
                Json.encodeToJsonElement(detail.copy(schedulerTimeZone = "America/New_York"))
            } else original?.invoke(suffix, query)
        }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }
        ui.onNodeWithText("Owner timezone: America/New_York").assertIsDisplayed()
        ui.onNodeWithText("Next run: Oct 4, 2026, 9:00:00 PM").assertIsDisplayed()
    }
    // @lat: [[mobile-data#Mobile data#Android schedule real list and detail metadata]]
    @Test fun authorizedScheduleListAndDetailShowSameOriginalExecutionWithoutMutation() {
        val client = historyClient { history(emptyList()) }
        val original = client.handleRead
        val recent = ScheduleRecentExecution(execution("recent-1").copy(status = "running", completedAt = null, summary = "Current original summary"))
        client.handleRead = { suffix, query -> when (suffix) {
            listOf("schedules") -> {
                val page = Json.decodeFromJsonElement<ScheduleSummaryPage>(schedules(listOf("initial-schedule")))
                Json.encodeToJsonElement(page.copy(items = page.items.map { it.copy(nextRunAt = "2026-10-05T01:00:00Z", schedulerTimeZone = "America/New_York", recentExecution = recent) }))
            }
            listOf("schedules", "initial-schedule") -> Json.encodeToJsonElement(Json.decodeFromJsonElement<Schedule>(scheduleDetail()).copy(schedulerTimeZone = "America/New_York", recentExecution = recent))
            else -> original?.invoke(suffix, query)
        } }
        connect(client)
        ui.onAllNodesWithText("Schedules").onLast().performClick()
        ui.onNodeWithTag("schedule-metadata-initial-schedule", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("Every 5 minutes").assertIsDisplayed()
        ui.onNodeWithText("Next run: Oct 4, 2026, 9:00:00 PM").assertIsDisplayed()
        ui.onNodeWithText("Latest execution: Running · Oct 4, 2026, 8:00:00 PM").assertIsDisplayed()
        ui.onNodeWithText("Current original summary").assertIsDisplayed()
        ui.onNodeWithTag("schedule-row:initial-schedule").performScrollTo().assertIsDisplayed().performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
        ui.onNodeWithTag("schedule-metadata-initial-schedule").assertIsDisplayed()
        ui.onNodeWithText("Current original summary").assertIsDisplayed()
        check(model.state.value.viewedSchedule?.recentExecution == recent)
        check(model.state.value.viewedSchedule?.scheduleExpression == "5m")
        ui.onNodeWithText("Every 5 minutes").assertIsDisplayed()
        ui.onNodeWithText("Owner expression: 5m").assertIsDisplayed()
        check(client.calls.all { it.method == "GET" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Complete original message pagination]]
    @Test fun allOneHundredTwentyFiveMessagesArriveInOriginalOrderAndBody() {
        val client = messageClient { query -> when (query["cursor"]) {
            null -> messagePage((76..125).map { it.toString() }, true, "before-76")
            "before-76" -> messagePage((26..75).map { it.toString() }, true, "before-26")
            "before-26" -> messagePage((1..25).map { it.toString() }, false, "start")
            else -> error("Unexpected cursor")
        } }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.onNodeWithText("Load earlier messages").assertIsDisplayed().performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
        perform { model.olderMessages() }
        check(model.state.value.messages.map { it.messageSeq } == (1..125).map { it.toString() })
        check(model.state.value.messages.map { it.content } == (1..125).map { "Original body $it" })
        check(!model.state.value.hasOlderMessages && model.state.value.messageError == null)
        val calls = client.calls.filter { it.suffix.last() == "messages" }
        check(calls[1].query == mapOf("cursor" to "before-76", "beforeSeq" to "76"))
        check(calls[2].query == mapOf("cursor" to "before-26", "beforeSeq" to "26"))
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Expired message snapshot replacement]]
    @Test fun messageCursorExpiryLoadsLatestPageAndDoesNotMixSnapshots() {
        var refreshed = false
        val client = messageClient { query ->
            if (query["cursor"] != null) { refreshed = true; throw MobileApiException("cursor_expired", 410) }
            if (refreshed) messagePage(listOf("100", "101"), cursor = "fresh", revision = "2") else messagePage(listOf("50", "51"), true, "expired")
        }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }; perform { model.olderMessages() }
        check(model.state.value.messages.map { it.messageSeq } == listOf("100", "101"))
        check(model.state.value.messageSnapshotRevision == "2" && model.state.value.messageError == null)
        check(client.calls.last().query.isEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Message page integrity refusal]]
    @Test fun foreignDuplicateUnorderedOverlappingAndChangedSnapshotPagesAreRejected() {
        var broken: JsonElement = messagePage(listOf("1"), conversationId = "foreign")
        val client = messageClient { query -> if (query["cursor"] == null) messagePage(listOf("50", "51"), true, "old") else broken }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        val invalid = listOf(
            messagePage(listOf("1"), conversationId = "foreign"),
            messagePage(listOf("1", "1")), messagePage(listOf("3", "2")),
            messagePage(listOf("50")), messagePage(listOf("2"), revision = "2"),
            messagePage(emptyList(), true), messagePage(listOf("2"), cursor = "old"),
            messagePage(listOf("1".repeat(65))), messagePage(listOf("2"), revision = "invalid"),
            messagePage(listOf("2"), cursor = "x".repeat(4097)), messagePage((1..101).map { it.toString() })
        )
        invalid.forEach { candidate ->
            broken = candidate; perform { model.olderMessages() }
            check(model.state.value.messageError == "protocol_incompatible")
            check(model.state.value.messages.map { it.messageSeq } == listOf("50", "51"))
        }
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Large message sequences stay strings]]
    @Test fun sequenceComparisonRetainsSixtyFourDigitValuesAndGapsWithoutNumericCoercion() {
        val big = "1" + "0".repeat(63); val previous = (big.toBigInteger() - java.math.BigInteger.ONE).toString()
        val client = messageClient { query -> if (query["cursor"] == null) messagePage(listOf(big), true, "old") else messagePage(listOf(previous)) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }; perform { model.olderMessages() }
        check(model.state.value.messages.map { it.messageSeq } == listOf(previous, big))
        check(client.calls.last().query["beforeSeq"] == big)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Late message page after back]]
    @Test fun returningDuringOldPageReadRejectsLateDataAndSendsNoCancellation() {
        val started = CountDownLatch(1); val release = CountDownLatch(1)
        val client = messageClient { query ->
            if (query["cursor"] != null) { started.countDown(); check(release.await(10, TimeUnit.SECONDS)); messagePage(listOf("1")) }
            else messagePage(listOf("50"), true, "old")
        }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.runOnUiThread { model.olderMessages() }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); started.count == 0L }
        ui.onNodeWithContentDescription("Back").performClick(); release.countDown()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
        check(model.state.value.selected == null && model.state.value.messages.isEmpty() && model.state.value.messageCursor == null)
        check(client.calls.all { it.method == "GET" || (it.method == "POST" && it.suffix.last() == "read" && it.body?.keys == setOf("lastReadMessageSeq")) })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Message refresh keeps schedule parent]]
    @Test fun refreshingOriginalResultConversationRetainsItsParentHistory() {
        val client = historyClient { history(listOf("e1")) }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }; perform { model.openExecutionConversation(model.state.value.scheduleExecutions.single()) }
        perform { model.refreshConversation() }
        check(model.state.value.selected?.id == "result-e1" && model.state.value.viewedSchedule?.id == "initial-schedule")
        ui.onNodeWithContentDescription("Back").performClick()
        check(model.state.value.selected == null && model.state.value.scheduleExecutions.single().id == "e1" && model.state.value.messageCursor == null)
    }
}
