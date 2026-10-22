package one.agents.mobile

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
class MobileConversationManagementTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private lateinit var model: MobileViewModel
    private val limits = Limits(100, 50000, 262144, 86400000, 7, 100000, 300000)
    private fun owner(manage: Boolean = true) = OwnerSpace("owner-1", "space-1", "Owner", "desktop", true, false, false, "Asia/Shanghai", listOf("conversation:read") + if (manage) listOf("conversation:manage") else emptyList(), limits, "epoch-1")
    private fun conversation(title: String = "Original", revision: String = "1") = Conversation("original", "runtime_conversation", title, "runtime-1", pinned = false, archived = false, revision = revision, lastMessageSeq = "0", lastReadMessageSeq = "0", activity = "idle", activeRunIds = emptyList(), createdAt = "2026-10-06T00:00:00Z", updatedAt = "2026-10-06T00:00:00Z", allowedActions = listOf("read", "manage"))
    private fun receipt(key: String) = OperationReceipt("operation-1", key, "phone-1", "patchConversation", ResourceRef("conversation", "original"), "applied", createdAt = "2026-10-06T00:00:00Z", updatedAt = "2026-10-06T00:00:00Z")
    private data class Write(val binding: OwnerBinding, val suffix: List<String>, val body: JsonObject?, val key: String, val revision: String?, val method: String)
    private inner class Client : MobileControlClient("https://owner.example", { "fake-token" }) {
        var manageable = true
        var epoch = "epoch-1"
        var ownerId = "owner-1"
        var original = conversation()
        val writes = CopyOnWriteArrayList<Write>()
        val lookups = CopyOnWriteArrayList<Map<String, String>>()
        var response: (Write) -> JsonElement = { Json.encodeToJsonElement(receipt(it.key)) }
        var lookup: (String) -> JsonElement = { Json.encodeToJsonElement(OperationReceiptPage(listOf(receipt(it)), null, "1")) }
        override fun streamEvents(binding: OwnerBinding, cursor: String?, lastEventId: String?, consume: (StreamEvent) -> Unit, failed: (MobileApiException) -> Unit, opened: () -> Unit) = MobileEventSubscription {}
        override fun read(binding: OwnerBinding, suffix: List<String>, query: Map<String, String>): JsonElement = when (suffix) {
            listOf("bootstrap") -> Json.encodeToJsonElement(Bootstrap(MOBILE_PROTOCOL, owner(manageable).copy(ownerId = ownerId, dataEpoch = epoch), "1", "2026-10-06T00:00:00Z", epoch, owner(manageable).capabilities, limits, "anchor"))
            listOf("conversations") -> Json.encodeToJsonElement(ConversationPage(listOf(original), null, "1"))
            listOf("conversations", "original") -> Json.encodeToJsonElement(original)
            listOf("conversations", "original", "messages") -> Json.encodeToJsonElement(MessagePage(emptyList(), false, "messages", "1"))
            listOf("projects") -> Json.encodeToJsonElement(ProjectPage(listOf(Project("p1", "First project", emptyList()), Project("p2", "Second project", emptyList())), null, "1"))
            listOf("snapshots") -> Json.encodeToJsonElement(Snapshot(listOf(original), emptyList(), emptyList(), "snapshot", "1", epoch, null))
            listOf("operations") -> if (query["clientMutationId"] != null) { lookups.add(query); lookup(query["clientMutationId"]!!) } else Json.encodeToJsonElement(OperationReceiptPage(emptyList(), null, "1"))
            else -> Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"1"}""")
        }
        override fun write(binding: OwnerBinding, suffix: List<String>, body: JsonObject?, mutationId: String, revision: String?, method: String): JsonElement {
            val request = Write(binding, suffix, body, mutationId, revision, method); writes.add(request); return response(request)
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
        perform { model.selectOwner(owner(client.manageable)) }; perform { model.openConversation(model.state.value.conversations.single()) }
    }
    private fun openActions() { ui.onNodeWithTag("conversation-actions").performClick() }
    private fun editTitle(value: String) {
        openActions()
        ui.onNodeWithText("Rename").performClick(); ui.onNodeWithText("Title").performTextClearance(); ui.onNodeWithText("Title").performTextInput(value)
    }

    // @lat: [[mobile-data#Mobile data#Android project change original CAS]]
    @Test fun projectChoiceUsesOriginalPatchRevisionAndOnlyOriginalRefreshChangesBinding() {
        val client = Client(); connect(client)
        openActions(); ui.onNodeWithText("Change project").performClick()
        ui.onNodeWithText("Second project").performScrollTo().performClick()
        ui.onNodeWithText("Save").performClick(); waitFor { !model.state.value.busy && client.writes.size == 1 }
        val write = client.writes.single()
        check(write.binding == OwnerBinding("owner-1", "space-1") && write.suffix == listOf("conversations", "original") && write.method == "PATCH" && write.revision == "1")
        check(write.body == buildJsonObject { put("projectId", "p2") } && model.state.value.selected?.projectId == null)
        client.original = client.original.copy(projectId = "p2", revision = "2")
        perform { model.refreshConversation() }
        check(model.state.value.selected?.projectId == "p2" && model.state.value.selected?.revision == "2")
    }
    // @lat: [[mobile-data#Mobile data#Android project clear Chinese null contract]]
    @Test fun chineseProjectClearSendsExplicitNullWithoutOptimisticReplacement() {
        val client = Client(); client.original = conversation().copy(projectId = "p1"); connect(client); perform { model.language("zh-CN") }
        openActions(); ui.onNodeWithText("更改项目").performClick(); ui.onNodeWithText("无项目").performClick(); ui.onNodeWithText("保存").performClick()
        waitFor { !model.state.value.busy && client.writes.size == 1 }
        check(client.writes.single().body == buildJsonObject { put("projectId", JsonNull) })
        check(model.state.value.selected?.projectId == "p1")
    }
    // @lat: [[mobile-data#Mobile data#Android project conflict draft preservation]]
    @Test fun projectRevisionConflictPreservesDraftAndCapturedVersion() {
        val client = Client(); connect(client)
        openActions(); ui.onNodeWithText("Change project").performClick(); ui.onNodeWithText("First project").performClick()
        client.original = conversation("Desktop changed", "2"); perform { model.refreshConversation() }
        client.response = { throw MobileApiException("revision_conflict", 409, "project-cas-original-52") }
        ui.onNodeWithText("Save").performClick(); waitFor { !model.state.value.busy && model.state.value.error == "revision_conflict" }
        check(client.writes.single().revision == "1")
        ui.onNode(hasText(ui.activity.getString(R.string.error_revision_conflict)) and hasAnyAncestor(isDialog())).performScrollTo().assertIsDisplayed()
        ui.onNode(hasText("Request ID: project-cas-original-52") and hasAnyAncestor(isDialog())).performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("First project").assertExists(); ui.onNodeWithText("Save").assertIsEnabled()
        check(model.state.value.selected?.title == "Desktop changed" && model.state.value.selected?.projectId == null)
    }
    // @lat: [[mobile-data#Mobile data#Android project change current authority admission]]
    @Test fun runningUnsupportedMissingAndRevokedProjectChangesDoNotWrite() {
        val client = Client(); client.original = conversation().copy(activeRunIds = listOf("original-run")); connect(client)
        openActions(); ui.onNodeWithText("Change project").assertIsNotEnabled()
        perform { model.changeConversationProject(conversation(), "p1") }; check(model.state.value.error == "run_active" && client.writes.isEmpty())
        client.original = conversation(); perform { model.refreshConversation() }
        perform { model.changeConversationProject(model.state.value.selected!!, "missing") }; check(model.state.value.error == "resource_not_found" && client.writes.isEmpty())
        perform { model.changeConversationProject(model.state.value.selected!!, "../invalid") }; check(model.state.value.error == "invalid_input" && client.writes.isEmpty())
        client.original = conversation().copy(sourceKind = "quick_chat"); perform { model.refreshConversation() }
        ui.onNodeWithText("Change project").assertDoesNotExist()
        perform { model.changeConversationProject(model.state.value.selected!!, "p1") }; check(model.state.value.error == "requires_owner_action" && client.writes.isEmpty())
        perform { model.forget() }; client.manageable = false; client.original = conversation(); connect(client)
        ui.onNodeWithText("Change project").assertDoesNotExist()
        perform { model.changeConversationProject(model.state.value.selected!!, "p1") }; check(model.state.value.error == "scope_denied" && client.writes.isEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Original conversation rename contract]]
    @Test fun renameUsesOriginalIdentityAndRevisionWithoutOptimisticTitleReplacement() {
        val client = Client(); connect(client); editTitle("  中文标题 English  "); ui.onNodeWithText("Save").performClick(); waitFor { !model.state.value.busy && client.writes.size == 1 }
        val request = client.writes.single()
        check(request.binding == OwnerBinding("owner-1", "space-1") && request.suffix == listOf("conversations", "original") && request.method == "PATCH" && request.revision == "1")
        check(request.body?.keys == setOf("title") && request.body?.get("title")?.jsonPrimitive?.content == "中文标题 English")
        check(model.state.value.selected?.title == "Original" && model.state.value.operations.single().status == "applied")
        ui.onNodeWithText("Rename conversation").assertDoesNotExist()
        client.original = conversation("中文标题 English", "2"); perform { model.refreshConversation() }; check(model.state.value.selected?.title == "中文标题 English")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Rename bilingual draft preservation]]
    @Test fun languageChangeKeepsOriginalRenameDraftAndLocalizedActions() {
        val client = Client(); connect(client); editTitle("草稿 Draft")
        perform { model.language("zh-CN") }; ui.onNodeWithText("重命名对话").assertExists(); ui.onNodeWithText("草稿 Draft").assertExists(); ui.onNodeWithText("保存").assertIsEnabled()
        perform { model.language("en") }; ui.onNodeWithText("Rename conversation").assertExists(); ui.onNodeWithText("草稿 Draft").assertExists(); ui.onNodeWithText("Cancel").performClick()
        check(client.writes.isEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Rename revision conflict retains draft]]
    @Test fun conflictPreservesDraftAndOpeningRevisionAfterOwnerChanges() {
        val client = Client(); connect(client); editTitle("My preserved draft")
        client.response = { throw MobileApiException("revision_conflict", 409, "rename-cas-original-52") }
        client.original = conversation("Desktop changed", "2"); perform { model.refreshConversation() }
        ui.onNodeWithText("Save").performClick(); waitFor { !model.state.value.busy && model.state.value.error == "revision_conflict" }
        ui.onNodeWithText("My preserved draft").assertExists(); ui.onNodeWithText("Rename conversation").assertExists()
        ui.onNode(hasText(ui.activity.getString(R.string.error_revision_conflict)) and hasAnyAncestor(isDialog())).performScrollTo().assertIsDisplayed()
        ui.onNode(hasText("Request ID: rename-cas-original-52") and hasAnyAncestor(isDialog())).performScrollTo().assertIsDisplayed()
        check(client.writes.single().revision == "1" && model.state.value.selected?.title == "Desktop changed")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Conversation management capability admission]]
    @Test fun readonlyOwnerHidesRenameAndRefusesDirectManagementWithoutWriting() {
        val client = Client(); client.manageable = false; connect(client)
        ui.onNodeWithText("Rename").assertDoesNotExist()
        perform { model.renameConversation(model.state.value.selected!!, "Wrong") }; check(model.state.value.error == "scope_denied" && client.writes.isEmpty())
        perform { model.manageConversation(model.state.value.selected!!, "pinned", true) }; check(model.state.value.error == "scope_denied" && client.writes.isEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Rename timeout uses original mutation lookup]]
    @Test fun ambiguousSubmissionQueriesSameMutationOnceWithoutReplayingPatch() {
        val client = Client(); connect(client); client.response = { throw java.io.IOException("timeout") }
        var completed = false; perform { model.renameConversation(model.state.value.selected!!, "Renamed") { completed = true } }
        check(completed && client.writes.size == 1 && client.lookups.single() == mapOf("clientMutationId" to client.writes.single().key))
        check(model.state.value.operations.single().clientMutationId == client.writes.single().key && model.state.value.selected?.title == "Original")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Mutation receipt identity refusal]]
    @Test fun wrongDeviceMutationActionOrConversationReceiptCannotClearFormOrBecomeSuccess() {
        var completed = 0
        val changes: List<(OperationReceipt) -> OperationReceipt> = listOf({ it.copy(deviceId = "other-phone") }, { it.copy(clientMutationId = "other-mutation") }, { it.copy(action = "createConversation") }, { it.copy(resourceRef = ResourceRef("conversation", "foreign")) })
        for (change in changes) {
            perform { model.forget() }; val client = Client(); connect(client)
            client.response = { Json.encodeToJsonElement(change(receipt(it.key))) }
            perform { model.renameConversation(model.state.value.selected!!, "Draft") { completed++ } }
            check(model.state.value.error == "protocol_incompatible" && model.state.value.operations.isEmpty())
        }
        check(completed == 0 && model.state.value.selected?.title == "Original")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Uncertain submission retains original mutation identity]]
    @Test fun repeatedConfirmationOnlyLooksUpOriginalUnknownWriteUntilReceiptArrives() {
        val client = Client(); connect(client); client.response = { throw java.io.IOException("timeout") }; client.lookup = { Json.encodeToJsonElement(OperationReceiptPage(emptyList(), null, "1")) }
        repeat(3) { perform { model.renameConversation(model.state.value.selected!!, "Draft") }; check(model.state.value.error == "reconciliation_required") }
        check(client.writes.size == 1 && client.lookups.size == 3 && client.lookups.all { it["clientMutationId"] == client.writes.single().key })
        client.lookup = { Json.encodeToJsonElement(OperationReceiptPage(listOf(receipt(it)), null, "2")) }; var completed = false
        perform { model.renameConversation(model.state.value.selected!!, "Draft") { completed = true } }
        check(completed && client.writes.size == 1 && model.state.value.error == null)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Changed uncertain draft cannot borrow original receipt]]
    @Test fun changedDraftQueriesOldIdentityWithoutClosingNewDraftOrSendingNewPatch() {
        val client = Client(); connect(client); client.response = { throw java.io.IOException("timeout") }; client.lookup = { Json.encodeToJsonElement(OperationReceiptPage(emptyList(), null, "1")) }
        perform { model.renameConversation(model.state.value.selected!!, "Old draft") }
        client.lookup = { Json.encodeToJsonElement(OperationReceiptPage(listOf(receipt(it)), null, "2")) }; var completed = false
        perform { model.renameConversation(model.state.value.selected!!, "New draft") { completed = true } }
        check(!completed && client.writes.size == 1 && model.state.value.error == "original_submission_resolved" && model.state.value.operations.single().status == "applied")
        client.response = { Json.encodeToJsonElement(receipt(it.key)) }
        perform { model.renameConversation(model.state.value.selected!!, "New draft") { completed = true } }
        check(completed && client.writes.size == 2 && client.writes[0].key != client.writes[1].key)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Local validation precedes uncertain write tracking]]
    @Test fun localRevisionFailureDoesNotInstallUnknownSlotOrSendLookup() {
        val client = Client(); connect(client)
        perform { model.renameConversation(model.state.value.selected!!.copy(revision = "invalid"), "Draft") }
        check(model.state.value.error == "invalid_input" && client.writes.isEmpty() && client.lookups.isEmpty())
        perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        check(model.state.value.error == null && client.writes.size == 1 && client.lookups.isEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Disconnect clears only local uncertain tracking]]
    @Test fun explicitDisconnectDropsMemoryTrackingWithoutReplayingOwnerMutation() {
        val client = Client(); connect(client); client.response = { throw java.io.IOException("timeout") }; client.lookup = { Json.encodeToJsonElement(OperationReceiptPage(emptyList(), null, "1")) }
        perform { model.renameConversation(model.state.value.selected!!, "Draft") }; val oldKey = client.writes.single().key
        perform { model.forget() }; check(model.state.value.owner == null && client.writes.size == 1)
        connect(client); client.response = { Json.encodeToJsonElement(receipt(it.key)) }; perform { model.renameConversation(model.state.value.selected!!, "New explicit intent") }
        check(client.writes.size == 2 && client.writes.last().key != oldKey && client.lookups.size == 1)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Invalid write response retains reconciliation identity]]
    @Test fun wrongWriteReceiptCannotCauseSecondWriteOnConfirmation() {
        val client = Client(); connect(client); client.response = { Json.encodeToJsonElement(receipt("wrong-mutation")) }
        perform { model.renameConversation(model.state.value.selected!!, "Draft") }; check(model.state.value.error == "protocol_incompatible")
        perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        check(client.writes.size == 1 && client.lookups.single()["clientMutationId"] == client.writes.single().key && model.state.value.error == null)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Definite rejection releases uncertain slot]]
    @Test fun definiteRevisionRejectionAllowsReviewedNewIntent() {
        val client = Client(); connect(client)
        for (code in listOf("revision_conflict", "unverified_policy", "policy_revoked")) {
            client.response = { throw MobileApiException(code, 409) }; perform { model.renameConversation(model.state.value.selected!!, "Draft") }
            client.response = { Json.encodeToJsonElement(receipt(it.key)) }; perform { model.renameConversation(model.state.value.selected!!, "Revised draft") }
            check(client.writes.takeLast(2).map { it.key }.distinct().size == 2 && client.lookups.isEmpty())
        }
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Uncertain mutation survives Owner refresh and restore epoch]]
    @Test fun refreshingOwnerKeepsPendingIdentityAndChangedEpochCannotReplayIt() {
        val client = Client(); connect(client); client.response = { throw java.io.IOException("timeout") }; client.lookup = { Json.encodeToJsonElement(OperationReceiptPage(emptyList(), null, "1")) }
        perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        perform { model.refresh() }; perform { model.openConversation(model.state.value.conversations.single()) }; perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        check(client.writes.size == 1 && client.lookups.size == 2)
        client.epoch = "epoch-2"; perform { model.refresh() }; perform { model.openConversation(model.state.value.conversations.single()) }; perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        check(client.writes.size == 1 && client.lookups.size == 2 && model.state.value.error == "reconciliation_required")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Uncertain mutation Owner isolation]]
    @Test fun anotherOwnerDoesNotConsumeOldPendingWriteAndReturningQueriesOldIdentity() {
        val client = Client(); connect(client); client.response = { throw java.io.IOException("timeout") }; client.lookup = { Json.encodeToJsonElement(OperationReceiptPage(emptyList(), null, "1")) }
        perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        client.ownerId = "owner-2"; client.response = { Json.encodeToJsonElement(receipt(it.key)) }
        perform { model.selectOwner(owner().copy(ownerId = "owner-2")) }; perform { model.openConversation(model.state.value.conversations.single()) }; perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        check(client.writes.size == 2 && client.writes.last().binding.ownerId == "owner-2")
        client.ownerId = "owner-1"; perform { model.selectOwner(owner()) }; perform { model.openConversation(model.state.value.conversations.single()) }; perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        check(client.writes.size == 2 && client.lookups.last()["clientMutationId"] == client.writes.first().key && model.state.value.error == "reconciliation_required")
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Mutation lookup revocation propagation]]
    @Test fun revokedCredentialDuringTimeoutLookupClearsConnectionInsteadOfBecomingUncertain() {
        val client = Client(); connect(client); client.response = { throw java.io.IOException("timeout") }; client.lookup = { throw MobileApiException("revoked", 403) }
        perform { model.renameConversation(model.state.value.selected!!, "Draft") }
        check(model.state.value.error == "revoked" && model.state.value.owner == null && model.state.value.selected == null && client.writes.size == 1)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Rename Unicode title bounds]]
    @Test fun titleLimitCountsUnicodeCharactersAndRejectsBlankOrOversizedWithoutWriting() {
        val client = Client(); connect(client)
        for (title in listOf("   ", "😀".repeat(161))) { perform { model.renameConversation(model.state.value.selected!!, title) }; check(model.state.value.error == "invalid_input" && client.writes.isEmpty()) }
        perform { model.renameConversation(model.state.value.selected!!, "😀".repeat(160)) }
        check(client.writes.single().body?.get("title")?.jsonPrimitive?.content == "😀".repeat(160) && model.state.value.error == null)
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Unknown rename outcome retains draft]]
    @Test fun unknownOutcomeKeepsDraftAndDoesNotAutomaticallyRetryMutation() {
        val client = Client(); connect(client); client.response = { throw java.io.IOException("timeout") }; client.lookup = { Json.encodeToJsonElement(OperationReceiptPage(emptyList(), null, "1")) }
        editTitle("Unknown outcome draft"); ui.onNodeWithText("Save").performClick(); waitFor { model.state.value.error == "reconciliation_required" && !model.state.value.busy }
        ui.onNodeWithText("Unknown outcome draft").assertExists(); check(client.writes.size == 1 && client.lookups.size == 1 && model.state.value.operations.isEmpty())
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#Late rename receipt after navigation]]
    @Test fun lateReceiptDoesNotInvokeClosedPageCallbackOrReopenConversation() {
        val client = Client(); connect(client); val entered = CountDownLatch(1); val release = CountDownLatch(1); var completed = false
        client.response = { entered.countDown(); check(release.await(10, TimeUnit.SECONDS)); Json.encodeToJsonElement(receipt(it.key)) }
        try {
            ui.runOnUiThread { model.renameConversation(model.state.value.selected!!, "Draft") { completed = true } }; waitFor { entered.count == 0L }
            ui.runOnUiThread { model.back() }; release.countDown(); waitFor { !model.state.value.busy }
            check(!completed && model.state.value.selected == null && model.state.value.operations.size == 1)
        } finally { release.countDown() }
    }

    private fun largeFontActions(language: String) {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        ui.activityRule.scenario.recreate()
        check(ui.activity.resources.configuration.fontScale == 2f)
        val client=Client();connect(client);perform { model.language(language) }
        openActions()
        val labels=if(language=="zh-CN")listOf("重命名","置顶","归档") else listOf("Rename","Pin","Archive")
        val density=ui.activity.resources.displayMetrics.density
        labels.forEach { label ->
            val button=ui.onNode(hasText(label) and hasClickAction())
            button.assertIsDisplayed()
            val bounds=button.fetchSemanticsNode().boundsInRoot
            check(bounds.width >= 48*density && bounds.height >= 48*density) { "$label button bounds=$bounds density=$density fontScale=2" }
            val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            ui.onNodeWithText(label,useUnmergedTree=true).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) {it(layouts)}
            println("native-action-layout label=$label metrics=${layouts.map { listOf(it.size, it.multiParagraph.width, it.multiParagraph.height, it.lineCount) }}")
            check(layouts.size==1 && layouts.single().let { layout -> layout.lineCount <= 2 && layout.multiParagraph.height <= layout.size.height + 1f && (0 until layout.lineCount).all { line -> !layout.isLineEllipsized(line) && layout.getLineRight(line) <= layout.size.width + 1f && layout.getLineLeft(line) >= -1f } }) { "$label text clipped at 200%: layouts=${layouts.size}, metrics=${layouts.map { listOf(it.size, it.didOverflowWidth, it.didOverflowHeight, it.lineCount, it.layoutInput.constraints) }}" }
        }
        ui.onNode(hasText(labels.first()) and hasClickAction()).performTouchInput { click() }
        ui.onNodeWithText(if(language=="zh-CN")"重命名对话" else "Rename conversation").assertIsDisplayed()
        ui.onNodeWithText(if(language=="zh-CN")"取消" else "Cancel").performClick()
        check(client.writes.isEmpty())
    }
    // @lat: [[mobile-data#Mobile data#Android conversation actions narrow large font]]
    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    fun conversationActionsRemainReadableAndTouchableAt360dpAnd200Percent(){largeFontActions("en")}
    // @lat: [[mobile-data#Mobile data#Android conversation actions Chinese landscape large font]]
    @Test @Config(sdk=[35],qualifiers="zh-rCN-w640dp-h360dp-land") @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    fun chineseLandscapeConversationActionsRetainTouchBoundsAt200Percent(){largeFontActions("zh-CN")}
}
