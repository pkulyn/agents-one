package one.agents.mobile

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModelProvider
import kotlinx.serialization.json.*
import one.agents.mobile.contract.*
import one.agents.mobile.net.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RunCancellationUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private lateinit var model: MobileViewModel
    private val limits = Limits(100, 50000, 262144, 86400000, 7, 100000, 300000)
    private val conversation = Conversation("original", "runtime_conversation", "Original", "runtime-1", pinned = false, archived = false, revision = "1", lastMessageSeq = "0", lastReadMessageSeq = "0", activity = "active", activeRunIds = listOf("run-1"), createdAt = "2026-10-07T00:00:00Z", updatedAt = "2026-10-07T00:00:00Z", allowedActions = listOf("read"))
    private fun owner(scope: Boolean) = OwnerSpace("owner-1", "space-1", "Owner", "desktop", true, false, false, "Asia/Shanghai", listOf("conversation:read") + if (scope) listOf("conversation:advance") else emptyList(), limits, "epoch-1")
    private inner class Client(val scope: Boolean = true) : MobileControlClient("https://owner.example", { "fake-token" }) {
        val writes = CopyOnWriteArrayList<List<String>>()
        var block: (() -> Unit)? = null
        var wrongRef = false
        override fun streamEvents(binding: OwnerBinding, cursor: String?, lastEventId: String?, consume: (StreamEvent) -> Unit, failed: (MobileApiException) -> Unit, opened: () -> Unit) = MobileEventSubscription {}
        override fun read(binding: OwnerBinding, suffix: List<String>, query: Map<String, String>): JsonElement = when (suffix) {
            listOf("bootstrap") -> Json.encodeToJsonElement(Bootstrap(MOBILE_PROTOCOL, owner(scope), "1", "2026-10-07T00:00:00Z", "epoch-1", owner(scope).capabilities, limits, "anchor"))
            listOf("conversations") -> Json.encodeToJsonElement(ConversationPage(listOf(conversation), null, "1"))
            listOf("conversations", "original") -> Json.encodeToJsonElement(conversation)
            listOf("conversations", "original", "messages") -> Json.encodeToJsonElement(MessagePage(emptyList(), false, "messages", "1"))
            listOf("snapshots") -> Json.encodeToJsonElement(Snapshot(listOf(conversation), listOf(Run("run-1", conversationId = "original", runtimeId = "runtime-1", status = "running", lastRunEventSeq = "1", artifacts = emptyList(), allowedActions = listOf("read", "cancel")), Run("other-run", conversationId = "original", runtimeId = "runtime-1", status = "running", lastRunEventSeq = "1", artifacts = emptyList(), allowedActions = listOf("read"))), emptyList(), "snapshot", "1", "epoch-1", null))
            else -> Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"1"}""")
        }
        override fun write(binding: OwnerBinding, suffix: List<String>, body: JsonObject?, mutationId: String, revision: String?, method: String): JsonElement {
            assertEquals(OwnerBinding("owner-1", "space-1"), binding); assertEquals("POST", method); assertEquals(JsonObject(emptyMap()), body); assertNull(revision)
            writes.add(suffix); block?.invoke()
            return Json.encodeToJsonElement(OperationReceipt("operation-1", mutationId, "phone-1", "cancelRun", status = "applied", resourceRef = ResourceRef("run", if (wrongRef) "foreign" else "run-1"), createdAt = "2026-10-07T00:00:00Z", updatedAt = "2026-10-07T00:00:00Z"))
        }
    }
    @Before fun reset() { ui.runOnUiThread { model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.forget(); model.language("en") } }
    private fun waitFor(condition: () -> Boolean) = ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50)); condition() }
    private fun perform(block: () -> Unit) { ui.runOnUiThread(block); waitFor { !model.state.value.busy } }
    private fun connect(client: Client) {
        ui.runOnUiThread {
            fun field(name: String, value: Any) { MobileViewModel::class.java.getDeclaredField(name).apply { isAccessible = true }.set(model, value) }
            field("client", client); field("token", "fake-token"); field("credentials", Credentials("phone-1", "fake-token", "2099-01-01T00:00:00Z", "fake-refresh", "2099-01-01T00:00:00Z", "1"))
        }
        perform { model.selectOwner(owner(client.scope)) }; perform { model.openConversation(conversation) }
    }
    // @lat: [[mobile-data#Mobile data#Android original Run stop action]]
    @Test fun realRunCardStopsOnlyAuthorizedRunAndKeepsRealStatusAfterAcknowledgement() {
        val client = Client(); connect(client)
        val started = CountDownLatch(1); val release = CountDownLatch(1)
        client.block = { started.countDown(); check(release.await(10, TimeUnit.SECONDS)) }
        ui.onNodeWithTag("composer-action").performClick(); waitFor { started.count == 0L }
        ui.onNodeWithTag("composer-action").assertIsNotEnabled(); ui.onNodeWithTag("run-cancel-other-run").assertDoesNotExist()
        release.countDown(); waitFor { !model.state.value.busy }
        assertEquals(listOf(listOf("runs", "run-1", "cancel")), client.writes.toList())
        assertEquals("applied", model.state.value.operations.single().status); assertTrue(model.state.value.runs.all { it.status == "running" }); assertNull(model.state.value.error)
    }
    // @lat: [[mobile-data#Mobile data#Android Run cancellation admission and receipt identity]]
    @Test fun missingScopeAndForeignReceiptCannotConfirmCancellation() {
        val denied = Client(false); connect(denied); ui.onNodeWithTag("composer-action").assertDoesNotExist()
        perform { model.cancelRun("run-1") }; assertTrue(denied.writes.isEmpty()); assertEquals("scope_denied", model.state.value.error)
        perform { model.forget() }; val wrong = Client(); wrong.wrongRef = true; connect(wrong)
        ui.onNodeWithTag("composer-action").performClick(); waitFor { !model.state.value.busy }
        assertEquals("protocol_incompatible", model.state.value.error); assertTrue(model.state.value.operations.isEmpty()); assertTrue(model.state.value.runs.all { it.status == "running" })
    }
}
