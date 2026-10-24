package one.agents.mobile

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
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
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ArtifactPreparationTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private lateinit var model: MobileViewModel
    private val limits = Limits(100, 50000, 262144, 86400000, 7, 100000, 300000)
    private val artifact = Artifact("artifact-1", "run-1", "original.bin", "application/octet-stream", 4, "0".repeat(64), allowedActions = listOf("read", "download"))
    private fun owner(scope: Boolean = true) = OwnerSpace("owner-1", "space-1", "Owner", "desktop", true, false, false, "Asia/Shanghai", listOf("conversation:read") + if (scope) listOf("artifact:read") else emptyList(), limits, "epoch-1")
    private val conversation = Conversation("original", "runtime_conversation", "Original", "runtime-1", pinned = false, archived = false, revision = "1", lastMessageSeq = "0", lastReadMessageSeq = "0", activity = "idle", activeRunIds = emptyList(), createdAt = "2026-10-06T00:00:00Z", updatedAt = "2026-10-06T00:00:00Z", allowedActions = listOf("read"))
    private inner class Client(val scope: Boolean = true) : MobileControlClient("https://owner.example", { "fake-token" }) {
        var fresh = artifact.copy(name = "fresh.bin")
        var metadataReads = 0; var downloads = 0
        var consume: ((StreamEvent) -> Unit)? = null
        var deliver: (OutputStream) -> Unit = { it.write(byteArrayOf(1,2,3,4)) }
        override fun streamEvents(binding: OwnerBinding, cursor: String?, lastEventId: String?, consume: (StreamEvent) -> Unit, failed: (MobileApiException) -> Unit, opened: () -> Unit): MobileEventSubscription { this.consume = consume; opened(); return MobileEventSubscription {} }
        override fun read(binding: OwnerBinding, suffix: List<String>, query: Map<String, String>): JsonElement = when (suffix) {
            listOf("bootstrap") -> Json.encodeToJsonElement(Bootstrap(MOBILE_PROTOCOL, owner(scope), "1", "2026-10-06T00:00:00Z", "epoch-1", owner(scope).capabilities, limits, "anchor"))
            listOf("conversations") -> Json.encodeToJsonElement(ConversationPage(listOf(conversation), null, "1"))
            listOf("conversations", "original") -> Json.encodeToJsonElement(conversation)
            listOf("conversations", "original", "messages") -> Json.encodeToJsonElement(MessagePage(emptyList(), false, "messages", "1"))
            listOf("snapshots") -> Json.encodeToJsonElement(Snapshot(listOf(conversation), listOf(Run("run-1", conversationId = "original", runtimeId = "runtime-1", status = "succeeded", lastRunEventSeq = "0", artifacts = listOf(artifact), allowedActions = listOf("read"))), emptyList(), "snapshot", "1", "epoch-1", null))
            listOf("artifacts", "artifact-1") -> { metadataReads++; Json.encodeToJsonElement(fresh) }
            else -> Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"1"}""")
        }
        override fun downloadArtifact(binding: OwnerBinding, artifact: Artifact, staging: OutputStream) {
            assertEquals(OwnerBinding("owner-1", "space-1"), binding)
            assertEquals(fresh, artifact); downloads++; deliver(staging)
        }
    }
    @Before fun reset() { ui.runOnUiThread { model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.forget() } }
    private fun waitFor(condition: () -> Boolean) = ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50)); condition() }
    private fun perform(block: () -> Unit) { ui.runOnUiThread(block); waitFor { !model.state.value.busy } }
    private fun stagedFiles(): Array<java.io.File> {
        val root = java.io.File(model.getApplication<android.app.Application>().cacheDir, "artifact-transfers")
        assertTrue("Production artifact cache exists: $root", root.isDirectory)
        return checkNotNull(root.listFiles())
    }
    private fun connect(client: Client) {
        ui.runOnUiThread {
            fun field(name: String, value: Any) { MobileViewModel::class.java.getDeclaredField(name).apply { isAccessible = true }.set(model, value) }
            field("client", client); field("token", "fake-token"); field("credentials", Credentials("phone-1", "fake-token", "2099-01-01T00:00:00Z", "fake-refresh", "2099-01-01T00:00:00Z", "1"))
        }
        perform { model.selectOwner(owner(client.scope)) }; perform { model.openConversation(conversation) }
    }
    @Test fun preparesUsingFreshOriginalMetadataAndDiscardsOnConnectionLoss() {
        val client = Client(); connect(client)
        var prepared: PreparedArtifact? = null
        perform { model.prepareArtifact(artifact) { prepared = it } }
        assertEquals(1, client.metadataReads); assertEquals(1, client.downloads)
        assertEquals("fresh.bin", prepared!!.metadata.name)
        assertTrue(prepared!!.current()); assertTrue(prepared!!.file.exists())
        perform { model.forget() }
        assertFalse(prepared!!.current()); assertFalse(prepared!!.file.exists())
    }
    @Test fun failureCleansPartialStagingAndNeverCallsDelivery() {
        val client = Client(); connect(client)
        client.deliver = { it.write(1); throw MobileApiException("protocol_incompatible", 200) }
        var delivered = false
        perform { model.prepareArtifact(artifact) { delivered = true } }
        assertFalse(delivered); assertEquals("protocol_incompatible", model.state.value.error)
        assertTrue(stagedFiles().isEmpty())
    }
    @Test fun deletingOriginalRunInvalidatesPreparedFileBeforeExternalDelivery() {
        val client = Client(); connect(client)
        perform { model.observeForeground(true) }; waitFor { client.consume != null }
        var prepared: PreparedArtifact? = null
        perform { model.prepareArtifact(artifact) { prepared = it } }
        assertTrue(prepared!!.current())
        val payload = buildJsonObject { put("eventId", "epoch-1:1"); put("spaceChangeSeq", "1"); put("dataEpoch", "epoch-1"); put("type", "resource.deleted"); put("resourceRef", Json.encodeToJsonElement(ResourceRef("run", "run-1"))); put("resourceRevision", "1"); put("createdAt", "2026-10-06T00:00:00Z"); put("payload", buildJsonObject { put("kind", "run"); put("id", "run-1") }) }
        ui.runOnUiThread { client.consume!!(StreamEvent("epoch-1:1", "resource.deleted", payload.toString())) }
        waitFor { model.state.value.runs.isEmpty() }
        assertFalse(prepared!!.current()); assertEquals("original", model.state.value.selected?.id)
        perform { model.discardArtifact(prepared!!) }; assertFalse(prepared!!.file.exists())
    }
    @Test fun noScopeAndChangedOriginalIdentityNeverDownload() {
        val denied = Client(false); connect(denied)
        perform { model.prepareArtifact(artifact) { error("Unexpected delivery") } }
        assertEquals(0, denied.metadataReads); assertEquals(0, denied.downloads)
        perform { model.forget() }
        val mismatch = Client(); connect(mismatch); mismatch.fresh = artifact.copy(runId = "other-run")
        perform { model.prepareArtifact(artifact) { error("Unexpected delivery") } }
        assertEquals(1, mismatch.metadataReads); assertEquals(0, mismatch.downloads)
        assertEquals("protocol_incompatible", model.state.value.error)
    }
    @Test fun navigationDuringDownloadDoesNotPublishOldResult() {
        val client = Client(); connect(client)
        val started = CountDownLatch(1); val release = CountDownLatch(1)
        client.deliver = { it.write(1); started.countDown(); check(release.await(10, TimeUnit.SECONDS)) }
        var delivered = false
        ui.runOnUiThread { model.prepareArtifact(artifact) { delivered = true } }
        waitFor { started.count == 0L }
        ui.runOnUiThread { model.back() }
        release.countDown(); waitFor { !model.state.value.busy }
        assertFalse(delivered)
        assertTrue(stagedFiles().isEmpty())
    }
    @Test fun realPageLaunchesSystemPickerAndCancelCleansStaging() {
        connect(Client())
        ui.onNodeWithTag("artifact-save-artifact-1").performClick()
        var request: org.robolectric.shadows.ShadowActivity.IntentForResult? = null
        waitFor { request = Shadows.shadowOf(ui.activity).nextStartedActivityForResult; request != null }
        assertEquals(android.content.Intent.ACTION_CREATE_DOCUMENT, request!!.intent.action)
        assertEquals("fresh.bin", request!!.intent.getStringExtra(android.content.Intent.EXTRA_TITLE))
        assertEquals(1, stagedFiles().size)
        ui.runOnUiThread {
            ui.activity.activityResultRegistry.dispatchResult(request!!.requestCode, android.app.Activity.RESULT_CANCELED, null)
        }
        waitFor { stagedFiles().isEmpty() }
        assertNull(model.state.value.error)
    }
}
