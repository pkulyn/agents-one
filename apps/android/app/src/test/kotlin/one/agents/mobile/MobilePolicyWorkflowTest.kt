package one.agents.mobile

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import kotlinx.serialization.json.*
import one.agents.mobile.contract.*
import one.agents.mobile.net.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class MobilePolicyWorkflowTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val scopes = listOf("conversation:read", "conversation:create", "conversation:advance")
    private val limits = Limits(100, 50000, 262144, 86400000, 7, 100000, 300000)
    private val owner = OwnerSpace("owner-1", "space-1", "Owner", "desktop", true, false, false, "Asia/Shanghai", scopes, limits, "epoch-1")
    private val policy = ExecutionPolicy("original-policy", "original-runtime", "original-project", "inspect", true, false, listOf("create", "advance"))
    private val conversation = Conversation("original-conversation", "runtime_conversation", "New mobile task", "original-runtime", projectId = "original-project", pinned = false, archived = false, revision = "1", lastMessageSeq = "0", lastReadMessageSeq = "0", activity = "idle", activeRunIds = emptyList(), createdAt = "2026-10-07T00:00:00Z", updatedAt = "2026-10-07T00:00:00Z", allowedActions = listOf("read", "advance"))
    private data class Write(val binding: OwnerBinding, val suffix: List<String>, val body: JsonObject?, val revision: String?, val method: String)
    private inner class Client : MobileControlClient("https://owner.example", { "fake-token" }) {
        override fun currentDevice(): JsonElement = throw java.io.IOException("No synthetic device label")
        var creationGate: java.util.concurrent.CountDownLatch? = null
        val creationEntered = java.util.concurrent.CountDownLatch(1)
        var snapshotGate: java.util.concurrent.CountDownLatch? = null
        val snapshotEntered = java.util.concurrent.CountDownLatch(1)
        var catalogPolicies = listOf(policy)
        val writes = CopyOnWriteArrayList<Write>(); var created = false
        var rejected = false
        var uncertain = false
        var rejectTurn = false
        var lookupCount = 0
        override fun streamEvents(binding: OwnerBinding, cursor: String?, lastEventId: String?, consume: (StreamEvent) -> Unit, failed: (MobileApiException) -> Unit, opened: () -> Unit) = MobileEventSubscription {}
        override fun read(binding: OwnerBinding, suffix: List<String>, query: Map<String, String>): JsonElement = when (suffix) {
            listOf("bootstrap") -> Json.encodeToJsonElement(Bootstrap(MOBILE_PROTOCOL, owner, "1", "2026-10-07T00:00:00Z", "epoch-1", scopes, limits, "anchor"))
            listOf("runtimes") -> Json.encodeToJsonElement(RuntimePage(listOf(Runtime("original-runtime", "Original agent", "local", healthy = true, capabilities = emptyList(), allowedActions = listOf("read", "create", "advance"))), null, "1"))
            listOf("projects") -> Json.encodeToJsonElement(ProjectPage(listOf(Project("original-project", "Original project", listOf(policy.id))), null, "1"))
            listOf("execution-policies") -> Json.encodeToJsonElement(ExecutionPolicyPage(catalogPolicies, null, "1"))
            listOf("conversations") -> Json.encodeToJsonElement(ConversationPage(if (created) listOf(conversation) else emptyList(), null, "1"))
            listOf("conversations", conversation.id) -> Json.encodeToJsonElement(conversation)
            listOf("conversations", conversation.id, "messages") -> Json.encodeToJsonElement(MessagePage(emptyList(), false, "messages", "1"))
            listOf("snapshots") -> { snapshotEntered.countDown(); snapshotGate?.await(5, java.util.concurrent.TimeUnit.SECONDS); Json.encodeToJsonElement(Snapshot(listOf(conversation), emptyList(), emptyList(), "snapshot", "1", "epoch-1", null)) }
            else -> { if (suffix == listOf("operations") && query["clientMutationId"] != null) lookupCount++; Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"1"}""") }
        }
        override fun write(binding: OwnerBinding, suffix: List<String>, body: JsonObject?, mutationId: String, revision: String?, method: String): JsonElement {
            writes.add(Write(binding, suffix, body, revision, method)); val creation = suffix == listOf("conversations")
            if(creation) { creationEntered.countDown(); creationGate?.await(5, java.util.concurrent.TimeUnit.SECONDS) }
            if (!creation && rejectTurn) return Json.encodeToJsonElement(OperationReceipt("turn-rejected", mutationId, "phone-1", "createTurn", ResourceRef("conversation", conversation.id), "rejected", error = MobileError("policy_denied", "Synthetic denial", false, "turn-test"), createdAt = "2026-10-07T00:00:00Z", updatedAt = "2026-10-07T00:00:00Z"))
            if (uncertain) throw java.io.IOException("private network failure message")
            if (rejected) return Json.encodeToJsonElement(OperationReceipt("operation-rejected",mutationId,"phone-1","createConversation",ResourceRef("conversation",conversation.id),"rejected",error=MobileError("policy_denied","private owner failure details",false,"create-original-52"),createdAt="2026-10-07T00:00:00Z",updatedAt="2026-10-07T00:00:00Z"))
            if (creation) created = true
            return Json.encodeToJsonElement(OperationReceipt("operation-${writes.size}", mutationId, "phone-1", if (creation) "createConversation" else "createTurn", ResourceRef("conversation", conversation.id), if (creation) "applied" else "accepted", createdAt = "2026-10-07T00:00:00Z", updatedAt = "2026-10-07T00:00:00Z"))
        }
    }
    private fun connect(client: Client): MobileViewModel {
        lateinit var model: MobileViewModel
        ui.runOnUiThread {
            model=ViewModelProvider(ui.activity)[MobileViewModel::class.java];model.forget();model.language("en")
            fun field(name: String,value: Any){MobileViewModel::class.java.getDeclaredField(name).apply {isAccessible=true}.set(model,value)}
            field("client",client);field("token","fake-token");field("credentials",Credentials("phone-1","fake-token","2099-01-01T00:00:00Z","fake-refresh","2099-01-01T00:00:00Z","1"))
            model.selectOwner(owner)
        }
        waitForFailure { !model.state.value.busy && model.state.value.policies.size==client.catalogPolicies.size }
        return model
    }
    private fun connectForFailure(client: Client): MobileViewModel {
        val model = connect(client)
        ui.onNodeWithContentDescription("New conversation").performClick()
        ui.onNodeWithTag("field:Title").performTextInput("Preserved create draft")
        ui.onNodeWithTag("field:Task instructions").performTextInput("Task goal")
        ui.onNodeWithTag("execution-policy:original-policy").performClick()
        return model
    }
    private fun waitForFailure(condition: () -> Boolean)=ui.waitUntil(10000){Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50));condition()}
    // @lat: [[mobile-data#Mobile data#Creation navigates before network acceptance]]
    @Test fun creationShowsOriginalInputBeforeSlowReceiptWithoutInventingConversation() {
        val client = Client(); client.creationGate = java.util.concurrent.CountDownLatch(1)
        val model = connect(client)
        var closed = false
        try {
            ui.runOnUiThread { model.createConversation("Original title", "Original instruction", policy) { closed = true } }
            waitForFailure { client.creationEntered.count == 0L }
            check(closed && model.state.value.creationVisible && model.state.value.creation?.prompt == "Original instruction")
            check(model.state.value.selected == null && client.writes.size == 1 && !client.created)
            ui.onNodeWithText("Original instruction").assertExists()
        } finally { client.creationGate!!.countDown() }
        waitForFailure { !model.state.value.busy && model.state.value.selected?.id == conversation.id }
        check(client.writes.size == 2 && !model.state.value.creationVisible)
    }

    // @lat: [[mobile-data#Mobile data#First prompt survives slow initial snapshot]]
    @Test fun originalPromptVisibleWhileFirstRunSnapshotIsDelayed() {
        val client = Client(); val model = connect(client)
        client.snapshotGate = java.util.concurrent.CountDownLatch(1)
        try {
            ui.runOnUiThread { model.createConversation("Original title", "Immediate original goal", policy) }
            waitForFailure { model.state.value.selected?.id == conversation.id && client.snapshotEntered.count == 0L }
            check(model.state.value.pendingMessages.single().text == "Immediate original goal")
            ui.onNodeWithText("Immediate original goal").assertExists()
            ui.onNodeWithText("Start a conversation when Owner is ready").assertDoesNotExist()
            check(client.writes.size == 1)
        } finally { client.snapshotGate!!.countDown() }
        waitForFailure { !model.state.value.busy }
        check(client.writes.size == 2)
    }

    // @lat: [[mobile-data#Mobile data#First prompt failure preserves original conversation]]
    @Test fun initialTurnFailureKeepsDraftAndRetryTargetsTheCreatedConversation() {
        val client = Client().apply { rejectTurn = true }; val model = connect(client)
        ui.runOnUiThread { model.createConversation("", "Keep my original goal", policy) }
        waitForFailure { !model.state.value.busy && model.state.value.error != null }
        check(client.writes.size == 2 && client.writes.first().body?.get("title")?.jsonPrimitive?.content == "Keep my original goal")
        val failed = model.state.value.pendingMessages.single { it.text == "Keep my original goal" }
        check(model.state.value.selected?.id == conversation.id && failed.delivery == "failed" && model.state.value.composerDraft.isEmpty())
        ui.runOnUiThread { model.restorePendingMessage(failed.id) }
        check(model.state.value.composerDraft == "Keep my original goal" && model.state.value.pendingMessages.none { it.id == failed.id })
        client.rejectTurn = false
        ui.runOnUiThread { model.advance(model.state.value.composerDraft, policy) { model.composerDraft("") } }
        waitForFailure { !model.state.value.busy && client.writes.size == 3 }
        check(client.writes.count { it.suffix == listOf("conversations") } == 1)
        check(client.writes.last().suffix == listOf("conversations", conversation.id, "turns"))
        check(model.state.value.composerDraft.isEmpty())
    }
    // @lat: [[mobile-data#Mobile data#Android original conversation task mode recovery]]
    @Test fun originalConversationBindingStaysFixedAndChangedSelectionCannotSilentlySendAnotherMode() {
        val client = Client(); client.created = true
        val analysis = policy.copy(id = "desktop-task-analysis", mode = "desktop_analysis")
        val execution = policy.copy(id = "desktop-task-execution", mode = "desktop_execute")
        client.catalogPolicies = listOf(analysis, execution)
        val model = connect(client)
        ui.runOnUiThread { model.openConversation(conversation) }; waitForFailure { !model.state.value.busy && model.state.value.selected != null }
        ui.onNodeWithTag("continuation-mode").performClick()
        ui.onNodeWithTag("task-agent").assertIsNotEnabled()
        ui.onNodeWithTag("task-project").assertIsNotEnabled()
        ui.onNodeWithTag("task-mode").performScrollTo().performClick(); ui.onAllNodesWithText("Automatic").onLast().performClick()
        ui.onNodeWithText("Close").performClick()
        ui.onNodeWithText("Continue the conversation").performTextInput("Preserved mode draft")
        client.catalogPolicies = listOf(analysis, execution.copy(id = "desktop-task-refreshed"))
        ui.runOnUiThread {
            @Suppress("UNCHECKED_CAST")
            val flow = MobileViewModel::class.java.getDeclaredField("mutable").apply { isAccessible = true }.get(model) as kotlinx.coroutines.flow.MutableStateFlow<MobileState>
            flow.value = flow.value.copy(policies = client.catalogPolicies)
        }
        ui.onNodeWithText("Preserved mode draft").assertExists()
        ui.onNodeWithContentDescription("Send").assertIsNotEnabled()
        ui.onNodeWithTag("continuation-mode").performClick()
        ui.onNodeWithTag("task-mode").performScrollTo().performClick(); ui.onAllNodesWithText("Read only").onLast().performClick()
        ui.onNodeWithText("Close").performClick()
        ui.onNodeWithContentDescription("Send").assertIsEnabled()
        check(client.writes.isEmpty())
    }
    // @lat: [[mobile-data#Mobile data#Android create rejected receipt visible draft retry]]
    @Test fun rejectedCreateReceiptShowsSafeInlineFeedbackAndRetainsOriginalPolicyDraft(){
        val client=Client();client.rejected=true;val model=connectForFailure(client)
        ui.onNodeWithText("Create and send task").performClick();waitForFailure { !model.state.value.busy && model.state.value.error=="policy_denied" }
        ui.onNodeWithText(ui.activity.getString(R.string.error_policy_denied)).assertExists()
        ui.onNodeWithText("Request ID: create-original-52").assertExists()
        check(model.state.value.creation?.title == "Preserved create draft" && model.state.value.creationVisible)
        ui.onNodeWithText("private owner failure details").assertDoesNotExist()
        check(client.writes.size==1 && !client.created && model.state.value.conversations.isEmpty())
        check(model.state.value.operations.single().status=="rejected")
        client.rejected=false;ui.onNodeWithText("Retry").performClick();waitForFailure { !model.state.value.busy && client.writes.size==3 }
        check(client.writes.take(2).map {it.body}.distinct().size==1)
        check(client.writes.last().body?.get("executionPolicyId")?.jsonPrimitive?.content==policy.id)
        check(model.state.value.conversations.isEmpty())
        ui.onNodeWithText("Preserved create draft").assertDoesNotExist()
    }
    // @lat: [[mobile-data#Mobile data#Android create uncertain outcome inline feedback no replay]]
    @Test fun uncertainCreateKeepsDraftAndUserRetryOnlyLooksUpOriginalReceipt(){
        val client=Client();client.uncertain=true;val model=connectForFailure(client)
        ui.onNodeWithText("Create and send task").performClick();waitForFailure { !model.state.value.busy && model.state.value.error=="reconciliation_required" }
        ui.onNodeWithText(ui.activity.getString(R.string.error_reconciliation_required)).assertExists()
        ui.onNodeWithText("Preserved create draft").assertExists()
        check(client.writes.size==1 && client.lookupCount==1 && !client.created)
        ui.onNodeWithText("Retry").performClick();waitForFailure { !model.state.value.busy && client.lookupCount==2 }
        check(client.writes.size==1 && model.state.value.error=="reconciliation_required")
        ui.onNodeWithText("Preserved create draft").assertExists()
        ui.onNodeWithText("private network failure message").assertDoesNotExist()
        ui.onNodeWithContentDescription("Back").performClick();check(client.writes.size==1)
    }
    // @lat: [[mobile-data#Mobile data#Android readable policy create and advance workflow]]
    @Test fun realFormsCreateAndAdvanceWithOriginalPolicyAndSinglePolicyExplainsPermissions() {
        lateinit var model: MobileViewModel; val client = Client()
        fun waitFor(condition: () -> Boolean) = ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50)); condition() }
        fun perform(block: () -> Unit) { ui.runOnUiThread(block); waitFor { !model.state.value.busy } }
        ui.runOnUiThread {
            model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.forget(); model.language("en")
            fun field(name: String, value: Any) { MobileViewModel::class.java.getDeclaredField(name).apply { isAccessible = true }.set(model, value) }
            field("client", client); field("token", "fake-token"); field("credentials", Credentials("phone-1", "fake-token", "2099-01-01T00:00:00Z", "fake-refresh", "2099-01-01T00:00:00Z", "1"))
        }
        perform { model.selectOwner(owner) }
        ui.onNodeWithContentDescription("New conversation").performClick()
        ui.onNodeWithTag("field:Title").performTextInput("New mobile task")
        ui.onNodeWithTag("field:Task instructions").performTextInput("Initial task goal")
        ui.onNodeWithText("Read-only analysis").performScrollTo().assertIsDisplayed()
        ui.onNodeWithTag("execution-policy:original-policy").performClick()
        ui.onNodeWithText("Create and send task").performClick(); waitFor { !model.state.value.busy && client.writes.size == 2 }
        val create = client.writes.first()
        check(client.writes[1].body?.get("text")?.jsonPrimitive?.content == "Initial task goal")
        check(model.state.value.selected?.id == conversation.id)
        check(create.binding == OwnerBinding("owner-1", "space-1") && create.suffix == listOf("conversations") && create.method == "POST" && create.revision == null)
        check(create.body?.get("executionPolicyId")?.jsonPrimitive?.content == policy.id && create.body?.get("runtimeId")?.jsonPrimitive?.content == policy.runtimeId && create.body?.get("projectId")?.jsonPrimitive?.content == policy.projectId)
        check(model.state.value.conversations.isEmpty())
        ui.runOnUiThread { model.refresh() }; waitFor { !model.state.value.busy && model.state.value.conversations.isNotEmpty() }; ui.runOnUiThread { model.openConversation(model.state.value.conversations.single()) }; waitFor { !model.state.value.busy && model.state.value.selected?.id == conversation.id }
        ui.onNodeWithText("Read only").assertExists()
        ui.onNodeWithText("Continue the conversation").performTextInput("Next original task step")
        ui.onNodeWithContentDescription("Send").performClick(); waitFor { !model.state.value.busy && client.writes.size == 3 }
        val advance = client.writes.last()
        check(advance.suffix == listOf("conversations", conversation.id, "turns") && advance.revision == "1" && advance.method == "POST")
        check(advance.body?.get("executionPolicyId")?.jsonPrimitive?.content == policy.id && advance.body?.get("projectId")?.jsonPrimitive?.content == policy.projectId && advance.body?.get("text")?.jsonPrimitive?.content == "Next original task step")
        check(model.state.value.operations.first().status == "accepted" && model.state.value.messages.isEmpty())
    }
}
