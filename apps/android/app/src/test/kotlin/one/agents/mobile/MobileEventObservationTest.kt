package one.agents.mobile

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.*
import androidx.lifecycle.ViewModelProvider
import kotlinx.serialization.json.*
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
class MobileEventObservationTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private lateinit var model: MobileViewModel
    private val codec = Json { ignoreUnknownKeys = true }
    private val limits = Limits(100, 50000, 262144, 86400000, 7, 100000, 300000)
    private val capabilities = listOf("conversation:read", "schedule:read")
    private fun owner(scopes: List<String> = capabilities, id: String = "owner-1") = OwnerSpace(id, "space-1", "Original Owner", "desktop", true, false, false, "Asia/Shanghai", scopes, limits, "epoch-1")
    private fun conversation(id: String = "original", title: String = "Original", revision: String = "1") = Conversation(id, "native_session", title, "hermes-local", pinned = false, archived = false, revision = revision, lastMessageSeq = "1", lastReadMessageSeq = "0", activity = "idle", activeRunIds = emptyList(), createdAt = "2026-10-05T00:00:00Z", updatedAt = "2026-10-05T00:00:00Z", allowedActions = listOf("read"))
    private fun message(content: String = "Original body", sequence: String = "1", revision: String = "1") = Message("-$sequence", "original", sequence, revision, kind = "assistant", content = content, visibleToUser = true, createdAt = "2026-10-05T00:00:00Z")
    private fun schedule(revision: String = "1") = Schedule("schedule-1", "Original schedule", "Original prompt", "hermes-local", scheduleExpression = "5m", schedulerTimeZone = "Asia/Shanghai", enabled = true, effectiveState = "enabled", concurrencyPolicy = "skip", timeoutMs = 300000, activeRunIds = emptyList(), pendingCount = 0, revision = revision, allowedActions = listOf("read"))
    private fun run(id: String = "run-1", sequence: String = "1", status: String = "running", conversationId: String = "original") = Run(id, conversationId = conversationId, runtimeId = "hermes-local", status = status, startedAt = "2026-10-05T00:00:00Z", completedAt = if (status == "succeeded") "2026-10-05T00:01:00Z" else null, lastRunEventSeq = sequence, artifacts = emptyList(), allowedActions = listOf("read"))
    private fun receipt(status: String) = OperationReceipt("operation-1", "mutation-1", "phone-1", "createTurn", status = status, createdAt = "2026-10-05T00:00:00Z", updatedAt = "2026-10-05T00:00:00Z")
    private data class Stream(val binding: OwnerBinding, val cursor: String?, val last: String?, val consume: (StreamEvent) -> Unit, val failed: (MobileApiException) -> Unit, var closed: Boolean = false)
    private data class Request(val method: String, val suffix: List<String>, val query: Map<String, String>, val body: JsonObject? = null)
    private inner class Client : MobileControlClient("https://owner.example", { "fake-token" }) {
        val streams = CopyOnWriteArrayList<Stream>(); val requests = CopyOnWriteArrayList<Request>()
        var scopes = capabilities; var ownerId = "owner-1"; var grantRevision = "1"; var epoch = "epoch-1"
        var snapshot: (Map<String, String>) -> Snapshot = { Snapshot(listOf(conversation()), emptyList(), listOf(schedule()), "recovery-anchor", "2", "epoch-1", null) }
        var searchResult = listOf(conversation("search-original"))
        var currentMessage = message()
        var offeredMessageEpoch = ""
        var receipts = listOf<OperationReceipt>()
        var receiptFailure = false
        override fun streamEvents(binding: OwnerBinding, cursor: String?, lastEventId: String?, consume: (StreamEvent) -> Unit, failed: (MobileApiException) -> Unit, opened: () -> Unit): MobileEventSubscription {
            val stream = Stream(binding, cursor, lastEventId, consume, failed); streams.add(stream)
            opened()
            return MobileEventSubscription { stream.closed = true }
        }
        override fun read(binding: OwnerBinding, suffix: List<String>, query: Map<String, String>): JsonElement {
            requests.add(Request("GET", suffix, query))
            return when (suffix) {
                listOf("bootstrap") -> Json.encodeToJsonElement(Bootstrap(MOBILE_PROTOCOL, owner(scopes, ownerId).copy(dataEpoch = epoch), grantRevision, "2026-10-05T00:00:00Z", epoch, scopes, limits, "bootstrap-anchor"))
                listOf("conversations") -> Json.encodeToJsonElement(ConversationPage(listOf(conversation()), null, "1"))
                listOf("schedules") -> Json.encodeToJsonElement(ScheduleSummaryPage(listOf(codec.decodeFromJsonElement<ScheduleSummary>(Json.encodeToJsonElement(schedule()))), null, "1"))
                listOf("conversations", "original") -> Json.encodeToJsonElement(conversation())
                listOf("conversations", "original", "messages") -> { offeredMessageEpoch = epoch; Json.encodeToJsonElement(MessagePage(listOf(currentMessage), false, "message-anchor", "2")) }
                listOf("schedules", "schedule-1") -> Json.encodeToJsonElement(schedule())
                listOf("schedules", "schedule-1", "executions") -> Json.encodeToJsonElement(ScheduleExecutionPage(emptyList(), null, "1"))
                listOf("snapshots") -> Json.encodeToJsonElement(snapshot(query))
                listOf("operations") -> { if (receiptFailure) throw MobileApiException("owner_offline", 503); Json.encodeToJsonElement(OperationReceiptPage(receipts, null, "1")) }
                else -> Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"1"}""")
            }
        }
        override fun search(binding: OwnerBinding, suffix: List<String>, body: JsonObject): JsonElement { requests.add(Request("POST", suffix, emptyMap(), body)); return Json.encodeToJsonElement(ConversationPage(searchResult, null, "2")) }
        override fun markRead(binding: OwnerBinding, conversationId: String, sequence: String): JsonElement { check(offeredMessageEpoch == epoch) { "Cannot mark old-epoch messages before fresh delivery" }; requests.add(Request("POST", listOf("conversations", conversationId, "read"), emptyMap())); return Json.encodeToJsonElement(ReadPosition(conversationId, sequence)) }
        override fun write(binding: OwnerBinding, suffix: List<String>, body: JsonObject?, mutationId: String, revision: String?, method: String): JsonElement { error("Observation must not submit a business mutation") }
    }
    @Before fun reset() { ui.runOnUiThread { model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.forget(); model.language("en") } }
    private fun perform(block: () -> Unit) { ui.runOnUiThread(block); waitFor { !model.state.value.busy } }
    private fun waitFor(predicate: () -> Boolean) {
        try { ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50)); predicate() } }
        catch (e: Exception) { throw AssertionError("event wait failed: busy=${model.state.value.busy}, owner=${model.state.value.owner?.ownerId}, error=${model.state.value.error}, sync=${model.state.value.syncError}", e) }
    }
    private fun connect(client: Client) {
        ui.runOnUiThread {
            fun field(name: String, value: Any) { MobileViewModel::class.java.getDeclaredField(name).apply { isAccessible = true }.set(model, value) }
            field("client", client); field("token", "fake-token"); field("credentials", Credentials("phone-1", "fake-token", "2099-01-01T00:00:00Z", "fake-refresh", "2099-01-01T00:00:00Z", "1"))
            model.observeForeground(true)
        }
        perform { model.selectOwner(owner()) }; waitFor { client.streams.size == 1 }
    }
    private fun event(type: String, payload: JsonElement, sequence: String, revision: String = "1", refType: String = "conversation", refId: String = "original"): StreamEvent {
        val value = buildJsonObject { put("eventId", "epoch-1:$sequence"); put("spaceChangeSeq", sequence); put("dataEpoch", "epoch-1"); put("type", type); put("resourceRef", Json.encodeToJsonElement(ResourceRef(refType, refId))); put("resourceRevision", revision); put("createdAt", "2026-10-05T00:00:00Z"); put("payload", payload); if (type == "run.updated") { put("runId", payload.jsonObject["runId"]!!); put("runEventSeq", payload.jsonObject["lastRunEventSeq"]!!) } }
        return StreamEvent("epoch-1:$sequence", type, value.toString())
    }
    private fun emit(client: Client, value: StreamEvent) { ui.runOnUiThread { client.streams.last().consume(value) } }
    private fun fail(client: Client, code: String, status: Int) { ui.runOnUiThread { client.streams.last().failed(MobileApiException(code, status)) } }

    // @lat: [[mobile-data#Mobile data#Android archived event exclusion]]
    @Test fun archivedRealtimeConversationLeavesDefaultListAndRecoveryDoesNotBringItBack() {
        val client = Client(); connect(client)
        val archived = conversation(revision = "2").copy(archived = true)
        emit(client, event("conversation.updated", Json.encodeToJsonElement(archived), "1", "2"))
        waitFor { model.state.value.conversations.isEmpty() }
        client.snapshot = { Snapshot(listOf(archived, conversation("kept")), emptyList(), listOf(schedule()), "filtered-anchor", "2", "epoch-1", null) }
        fail(client, "cursor_expired", 410); waitFor { client.streams.size == 2 }
        check(model.state.value.conversations.map { it.id } == listOf("kept"))
        check(client.requests.none { it.method != "GET" })
    }

    // @lat: [[mobile-data#Mobile data#Android original Run deletion]]
    @Test fun originalRunDeletionKeepsConversationAndOtherRunsWithoutMutationOrSnapshot() {
        val client = Client(); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        emit(client, event("run.updated", Json.encodeToJsonElement(run()), "1", refType = "run", refId = "run-1"))
        emit(client, event("run.updated", Json.encodeToJsonElement(run(id = "run-2")), "2", refType = "run", refId = "run-2"))
        waitFor { model.state.value.runs.size == 2 }
        val before = client.requests.count { it.suffix == listOf("snapshots") }
        emit(client, event("resource.deleted", buildJsonObject { put("kind", "run"); put("id", "run-1") }, "3", refType = "run", refId = "run-1"))
        waitFor { model.state.value.runs.singleOrNull()?.runId == "run-2" }
        check(model.state.value.selected?.id == "original" && model.state.value.messages.isNotEmpty())
        check(client.requests.count { it.suffix == listOf("snapshots") } == before)
        emit(client, event("resource.deleted", buildJsonObject { put("kind", "run"); put("id", "run-2") }, "4", refType = "run", refId = "foreign"))
        waitFor { model.state.value.syncError == "protocol_incompatible" }
        check(model.state.value.runs.single().runId == "run-2")
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Original Run terminal observation]]
    @Test fun liveRunKeepsLargeSequenceAndTerminalStatusWithoutFullSnapshotRecovery() {
        val client = Client(); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        val before = client.requests.count { it.suffix == listOf("snapshots") }
        emit(client, event("run.updated", Json.encodeToJsonElement(run(sequence = "9007199254740993123456")), "1", refType = "run", refId = "run-1"))
        waitFor { model.state.value.runs.singleOrNull()?.status == "running" }
        emit(client, event("run.updated", Json.encodeToJsonElement(run(sequence = "9007199254740993123457", status = "succeeded")), "2", refType = "run", refId = "run-1"))
        waitFor { model.state.value.runs.single().status == "succeeded" }
        ui.onNodeWithText("Run status").assertIsDisplayed(); ui.onNodeWithText("Completed").assertIsDisplayed()
        emit(client, event("run.updated", Json.encodeToJsonElement(run(sequence = "9007199254740993123456")), "3", refType = "run", refId = "run-1"))
        waitFor { client.requests.count { it.suffix == listOf("operations") } >= 4 }
        check(model.state.value.runs.single().status == "succeeded" && model.state.value.runs.single().lastRunEventSeq == "9007199254740993123457")
        check(client.requests.count { it.suffix == listOf("snapshots") } == before && client.streams.size == 1)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Owner receipt terminal refresh]]
    @Test fun observedRunRereadsReceiptsAndReplacesAcceptedEvenWhenTimestampIsUnchanged() {
        val client = Client(); client.receipts = listOf(receipt("accepted")); connect(client)
        check(model.state.value.operations.single().status == "accepted")
        client.receipts = listOf(receipt("applied"))
        emit(client, event("run.updated", Json.encodeToJsonElement(run(status = "succeeded")), "1", refType = "run", refId = "run-1"))
        waitFor { model.state.value.operations.single().status == "applied" }
        check(client.requests.none { it.method != "GET" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Run identity and terminal integrity]]
    @Test fun foreignRunIdentityAndTerminalRegressionAreRefusedWithoutReplacingStoredRun() {
        val client = Client(); connect(client)
        emit(client, event("run.updated", Json.encodeToJsonElement(run(status = "succeeded")), "1", refType = "run", refId = "run-1")); waitFor { model.state.value.runs.size == 1 }
        emit(client, event("run.updated", Json.encodeToJsonElement(run(sequence = "2", conversationId = "foreign")), "2", refType = "run", refId = "run-1"))
        waitFor { model.state.value.syncError == "protocol_incompatible" }
        check(model.state.value.runs.single().conversationId == "original" && model.state.value.runs.single().status == "succeeded")
        perform { model.retryEventObservation() }; waitFor { client.streams.size == 2 }
        emit(client, event("run.updated", Json.encodeToJsonElement(run(sequence = "2")), "2", refType = "run", refId = "run-1"))
        waitFor { model.state.value.syncError == "protocol_incompatible" }
        check(model.state.value.runs.single().status == "succeeded" && client.streams.last().last == "epoch-1:1")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Frozen Run pages and scoped restoration]]
    @Test fun originalConversationLoadsAllRunPagesAndPermissionLossClearsRunData() {
        val client = Client(); client.snapshot = { query ->
            Snapshot(if (query["cursor"] == null) listOf(conversation()) else emptyList(), if (query["cursor"] == null) (1..99).map { run("run-$it") } else listOf(run("run-100", status = "succeeded")), emptyList(), "run-anchor", "1", "epoch-1", if (query["cursor"] == null) "more-runs" else null)
        }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        check(model.state.value.runs.size == 100 && model.state.value.runError == null)
        check(client.requests.filter { it.suffix == listOf("snapshots") }.all { it.query["conversationId"] == "original" })
        client.scopes = listOf("schedule:read"); client.grantRevision = "2"; client.snapshot = { Snapshot(emptyList(), emptyList(), listOf(schedule()), "reduced", "1", "epoch-1", null) }
        emit(client, event("permission.changed", Json.encodeToJsonElement(PermissionChange("phone-1", "2", client.scopes, false)), "1", "2", "permission", "phone-1"))
        waitFor { client.streams.size == 2 }
        check(model.state.value.runs.isEmpty() && model.state.value.selected == null)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Receipt failure preserves observed Run]]
    @Test fun failedReceiptObservationDoesNotInventCompletionOrDiscardTerminalRun() {
        val client = Client(); client.receipts = listOf(receipt("accepted")); connect(client); client.receiptFailure = true
        emit(client, event("run.updated", Json.encodeToJsonElement(run(status = "succeeded")), "1", refType = "run", refId = "run-1"))
        waitFor { model.state.value.syncError == "owner_offline" }
        check(model.state.value.runs.single().status == "succeeded" && model.state.value.operations.single().status == "accepted")
        client.receiptFailure = false; client.receipts = listOf(receipt("applied"))
        waitFor { model.state.value.operations.single().status == "applied" && client.streams.size >= 2 }
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Run recovery preserves authoritative pages]]
    @Test fun expiredEventsRestoreRunPagesAndReplaceOldReceiptObservations() {
        val client = Client(); client.receipts = listOf(receipt("accepted")); connect(client)
        client.snapshot = { query -> Snapshot(if (query["cursor"] == null) listOf(conversation()) else emptyList(), if (query["cursor"] == null) (1..99).map { run("run-$it") } else listOf(run("run-100", status = "succeeded")), emptyList(), "all-runs", "1", "epoch-1", if (query["cursor"] == null) "page-2" else null) }
        client.receipts = listOf(receipt("applied")); fail(client, "cursor_expired", 410)
        waitFor { client.streams.size == 2 }
        check(model.state.value.runs.size == 100 && model.state.value.runs.last().status == "succeeded")
        check(model.state.value.operations.single().status == "applied" && client.streams.last().cursor == "all-runs")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Run detail snapshot integrity]]
    @Test fun foreignDuplicateAndChangedRunSnapshotsDoNotReplaceOriginalRunState() {
        val client = Client(); connect(client)
        client.snapshot = { Snapshot(listOf(conversation()), listOf(run()), emptyList(), "runs", "1", "epoch-1", null) }
        perform { model.openConversation(model.state.value.conversations.single()) }
        client.snapshot = { Snapshot(emptyList(), listOf(run(conversationId = "foreign")), emptyList(), "runs", "1", "epoch-1", null) }
        perform { model.refreshRunStatus() }; check(model.state.value.runError == "protocol_incompatible" && model.state.value.runs.single().conversationId == "original")
        client.snapshot = { Snapshot(emptyList(), listOf(run(), run()), emptyList(), "runs", "1", "epoch-1", null) }
        perform { model.refreshRunStatus() }; check(model.state.value.runError == "protocol_incompatible" && model.state.value.runs.size == 1)
        client.snapshot = { query -> Snapshot(emptyList(), listOf(run(if (query["cursor"] == null) "run-2" else "run-3")), emptyList(), "runs", if (query["cursor"] == null) "1" else "2", "epoch-1", if (query["cursor"] == null) "page-2" else null) }
        perform { model.refreshRunStatus() }; check(model.state.value.runError == "protocol_incompatible" && model.state.value.runs.single().runId == "run-1")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Late Run detail response]]
    @Test fun backWhileRunSnapshotIsPendingCannotReopenOrInstallLateRuns() {
        val client = Client(); connect(client)
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        client.snapshot = { entered.countDown(); check(release.await(10, TimeUnit.SECONDS)); Snapshot(listOf(conversation()), listOf(run()), emptyList(), "runs", "1", "epoch-1", null) }
        try {
            ui.runOnUiThread { model.openConversation(model.state.value.conversations.single()) }; waitFor { entered.count == 0L }
            ui.onNodeWithContentDescription("Back").performClick(); release.countDown(); waitFor { !model.state.value.busy }
            check(model.state.value.selected == null && model.state.value.runs.isEmpty() && client.requests.none { it.suffix.last() == "cancel" })
        } finally { release.countDown() }
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Live original messages and revisions]]
    @Test fun streamUpdatesOriginalConversationAndFullMessagesWithoutDuplicateOrOptimisticRead() {
        val client = Client(); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        val longBody = "原消息正文\n".repeat(5000)
        emit(client, event("conversation.updated", Json.encodeToJsonElement(conversation(title = "Updated original", revision = "2")), "9007199254740993", "2"))
        emit(client, event("message.upsert", Json.encodeToJsonElement(message(longBody, revision = "2")), "9007199254740994", "2"))
        waitFor { model.state.value.messages.single().content == longBody }
        check(model.state.value.selected?.title == "Updated original" && model.state.value.messages.single().id == "-1")
        emit(client, event("message.upsert", Json.encodeToJsonElement(message("stale replay", revision = "2")), "9007199254740994", "2"))
        ui.waitForIdle(); check(model.state.value.messages.single().content == longBody)
        check(client.requests.all { it.method == "GET" || it.suffix.last() == "read" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Foreground event resume and isolation]]
    @Test fun stoppingObservationPreservesViewsAndReconnectsWithExactLastEventWithoutCancellingTasks() {
        val client = Client(); connect(client)
        val frame = event("conversation.updated", Json.encodeToJsonElement(conversation(title = "Updated", revision = "2")), "9007199254740993123456789", "2")
        emit(client, frame); waitFor { model.state.value.conversations.single().title == "Updated" }
        val old = client.streams.single(); ui.runOnUiThread { model.observeForeground(false) }; waitFor { old.closed }
        ui.runOnUiThread { old.consume(event("conversation.updated", Json.encodeToJsonElement(conversation(title = "Late", revision = "3")), "9007199254740993123456790", "3")) }
        ui.waitForIdle(); check(model.state.value.conversations.single().title == "Updated")
        ui.runOnUiThread { model.observeForeground(true) }; waitFor { client.streams.size == 2 }
        check(client.streams.last().last == frame.id && client.streams.last().cursor == null)
        check(client.requests.all { it.method == "GET" })
        ui.runOnUiThread { model.forget() }; waitFor { client.streams.last().closed }; check(model.state.value.owner == null)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Expired event full snapshot recovery]]
    @Test fun expiredStreamReadsAllFrozenSnapshotPagesAndPreservesSelectedOriginalDetailAndEditor() {
        val client = Client(); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }; perform { model.editSchedule(codec.decodeFromJsonElement<ScheduleSummary>(Json.encodeToJsonElement(schedule()))) }
        client.currentMessage = message("Recovered original body", revision = "2")
        client.snapshot = { query ->
            val rows = if (query["cursor"] == null) listOf(conversation(title = "Recovered original", revision = "2")) + (1..98).map { conversation("original-$it") } else (99..124).map { conversation("original-$it") }
            Snapshot(rows, emptyList(), if (query["cursor"] == null) listOf(schedule("2")) else emptyList(), "fixed-event-anchor", "2", "epoch-1", if (query["cursor"] == null) "second-page" else null)
        }
        fail(client, "cursor_expired", 410); waitFor { client.streams.size == 2 }
        check(model.state.value.conversations.size == 125 && model.state.value.selected?.id == "original")
        check(model.state.value.selected?.title == "Recovered original" && model.state.value.messages.single().content == "Recovered original body")
        check(model.state.value.selectedSchedule?.revision == "1")
        check(client.streams.last().cursor == "fixed-event-anchor" && client.streams.last().last == null)
        check(client.requests.filter { it.suffix == listOf("snapshots") && "conversationId" !in it.query }.map { it.query } == listOf(emptyMap(), mapOf("cursor" to "second-page")))
        check(client.requests.none { it.suffix.last() == "cancel" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Live search remains Owner authoritative]]
    @Test fun messageChangesRefreshSameOwnerBodySearchAndRecoveryKeepsQuery() {
        val client = Client(); connect(client); perform { model.search("正文关键词", false) }
        client.searchResult = listOf(conversation("new-match", "Title without keyword"))
        emit(client, event("message.upsert", Json.encodeToJsonElement(message("正文关键词")), "1"))
        waitFor { model.state.value.conversations.single().id == "new-match" }
        fail(client, "cursor_expired", 410); waitFor { client.streams.size == 2 }
        check(model.state.value.conversationQuery == "正文关键词" && model.state.value.conversations.single().id == "new-match")
        check(client.requests.filter { it.suffix == listOf("conversations", "search") }.all { it.body?.get("query")?.jsonPrimitive?.content == "正文关键词" && it.body?.get("cursor") == null })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Live protocol refusal and explicit retry]]
    @Test fun malformedReferenceStopsWithoutAdvancingCursorAndExplicitRetryReusesAnchor() {
        val client = Client(); connect(client)
        emit(client, event("message.upsert", Json.encodeToJsonElement(message()), "1", refId = "wrong-conversation"))
        waitFor { model.state.value.syncError == "protocol_incompatible" }
        check(model.state.value.conversations.single().title == "Original" && client.streams.single().closed)
        ui.onNodeWithText("Retry").performClick(); waitFor { client.streams.size == 2 }
        check(client.streams.last().cursor == "bootstrap-anchor" && client.streams.last().last == null)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Live device revocation clears views]]
    @Test fun permissionRevocationClearsCredentialsAndBusinessViewsWithoutSubmittingCancellation() {
        val client = Client(); connect(client)
        emit(client, event("permission.changed", Json.encodeToJsonElement(PermissionChange("phone-1", "2", emptyList(), true)), "1", "2", "permission", "phone-1"))
        waitFor { model.state.value.error == "revoked" }
        check(model.state.value.owner == null && model.state.value.messages.isEmpty() && model.state.value.conversations.isEmpty() && client.streams.single().closed)
        check(client.requests.all { it.method == "GET" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Late recovery after Owner switch]]
    @Test fun lateSnapshotCannotReplaceNewOwnerOrRestartOldSubscription() {
        val client = Client(); connect(client)
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        client.snapshot = { entered.countDown(); check(release.await(10, TimeUnit.SECONDS)); Snapshot(listOf(conversation("late-old")), emptyList(), emptyList(), "old-anchor", "2", "epoch-1", null) }
        try {
            fail(client, "cursor_expired", 410); waitFor { entered.count == 0L }
            client.ownerId = "owner-2"; perform { model.selectOwner(owner(id = "owner-2")) }
            release.countDown(); waitFor { client.streams.size == 2 }; ui.waitForIdle()
            check(model.state.value.owner?.ownerId == "owner-2" && model.state.value.conversations.none { it.id == "late-old" })
            check(client.streams.last().binding.ownerId == "owner-2" && client.streams.last().cursor == "bootstrap-anchor")
        } finally { release.countDown() }
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Network event retry retains identity]]
    @Test fun networkReconnectKeepsLastEventAndReportsOfflineUntilSubscriptionOpens() {
        val client = Client(); connect(client)
        emit(client, event("conversation.updated", Json.encodeToJsonElement(conversation(title = "Observed", revision = "2")), "9", "2")); waitFor { model.state.value.conversations.single().title == "Observed" }
        fail(client, "owner_offline", 503); waitFor { client.streams.size == 2 }
        check(client.streams.first().closed && client.streams.last().last == "epoch-1:9")
        check(model.state.value.conversations.single().title == "Observed" && model.state.value.owner?.online == true && model.state.value.syncError == null)
        check(client.requests.all { it.method == "GET" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Live source deletion removes original view]]
    @Test fun originalConversationDeletionClosesItsViewAndRemovesListWithoutCancellingRun() {
        val client = Client(); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        emit(client, event("resource.deleted", buildJsonObject { put("kind", "conversation"); put("id", "original") }, "1"))
        waitFor { model.state.value.selected == null && model.state.value.conversations.isEmpty() }
        check(model.state.value.messages.isEmpty() && client.requests.none { it.suffix.last() == "cancel" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Historical event keeps message pagination boundary]]
    @Test fun unloadedHistoricalUpdateRecoversFreshPageInsteadOfMovingOldPageBoundary() {
        val client = Client(); client.currentMessage = message("Latest 50", "50"); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        emit(client, event("message.upsert", Json.encodeToJsonElement(message("Historical 1 revised", "1", "2")), "1", "2"))
        waitFor { client.streams.size == 2 }
        check(model.state.value.messages.map { it.messageSeq } == listOf("50"))
        check(client.streams.last().cursor == "recovery-anchor" && client.requests.any { it.suffix == listOf("snapshots") })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Live permission loss clears revoked data]]
    @Test fun reducedGrantClearsConversationDataBeforeRecoveringOnlyRemainingScopes() {
        val client = Client(); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        client.scopes = listOf("schedule:read"); client.grantRevision = "2"
        client.snapshot = { Snapshot(emptyList(), emptyList(), listOf(schedule()), "reduced-anchor", "2", "epoch-1", null) }
        emit(client, event("permission.changed", Json.encodeToJsonElement(PermissionChange("phone-1", "2", client.scopes, false)), "1", "2", "permission", "phone-1"))
        waitFor { model.state.value.messages.isEmpty() && model.state.value.selected == null }
        waitFor { client.streams.size == 2 }
        check(model.state.value.owner?.capabilities == listOf("schedule:read") && model.state.value.conversations.isEmpty() && model.state.value.schedules.size == 1)
        check(client.requests.none { it.suffix.last() == "cancel" })
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Restored epoch resets visible read observer]]
    @Test fun restoredOwnerEpochResetsReadAttemptAndRequiresFreshVisibleAcknowledgement() {
        val client = Client(); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        waitFor { client.requests.any { it.suffix.last() == "read" } }
        val oldCount = client.requests.count { it.suffix.last() == "read" }
        client.epoch = "epoch-2"; client.snapshot = { Snapshot(listOf(conversation()), emptyList(), listOf(schedule()), "new-epoch-anchor", "1", "epoch-2", null) }
        fail(client, "cursor_expired", 410)
        waitFor { client.streams.size == 2 && client.requests.count { it.suffix.last() == "read" } > oldCount }
        check(model.state.value.owner?.dataEpoch == "epoch-2" && client.streams.last().last == null && client.streams.last().cursor == "new-epoch-anchor")
        check(model.state.value.selected?.id == "original")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Stale grant recovery cannot restore revoked data]]
    @Test fun oldBootstrapCannotRestoreContentAfterPermissionReduction() {
        val client = Client(); connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        emit(client, event("permission.changed", Json.encodeToJsonElement(PermissionChange("phone-1", "2", listOf("schedule:read"), false)), "1", "2", "permission", "phone-1"))
        waitFor { model.state.value.syncError == "protocol_incompatible" }
        check(model.state.value.owner?.capabilities == listOf("schedule:read") && model.state.value.messages.isEmpty() && model.state.value.conversations.isEmpty() && model.state.value.selected == null)
        check(client.streams.size == 1 && client.streams.single().closed)
    }
}
