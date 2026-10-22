package one.agents.mobile

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import one.agents.mobile.net.MobileControlClient
import kotlinx.serialization.json.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class MobileUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Before fun reset() {
        ui.runOnUiThread {
            val model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            model.forget()
            model.language("en")
        }
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Ambiguous credential exchange]]
    @Test fun credentialExchangeRetryKeepsItsOriginalIdentity() {
        val keys = java.util.concurrent.CopyOnWriteArrayList<String>()
        lateinit var model: MobileViewModel
        ui.runOnUiThread {
            model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            model.createApi = { _, _ -> object : MobileControlClient("https://owner.example", { null }) {
                override fun claimPairing(body: JsonObject) = Json.parseToJsonElement("""{"id":"claim-3","state":"approved","expiresAt":"2099-01-01T00:00:00Z","verificationPhrase":"approved","claimProof":"proof"}""")
                override fun exchangeClaim(id: String, proof: String, mutationId: String): JsonElement {
                    keys.add(mutationId)
                    if (keys.size == 1) throw java.io.IOException("ambiguous response")
                    throw one.agents.mobile.net.MobileApiException("owner_offline", 503)
                }
            } }
            model.pair("https://owner.example", "invitation", "Phone")
        }
        ui.waitUntil(5_000) { org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(400)); keys.size == 2 }
        check(keys[0] == keys[1])
        ui.runOnUiThread { model.forget() }
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Language and draft preservation]]
    @Test fun languageSwitchRetainsConnectionDraft() {
        ui.onAllNodesWithText("Account").onLast().performClick()
        ui.onNodeWithTag("field:Owner HTTPS address").performScrollTo().performTextInput("https://owner.example")
        ui.onNodeWithText("Language").performScrollTo().performClick(); ui.onNodeWithText("简体中文").performClick()
        ui.onNodeWithText("语言").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("https://owner.example").assertExists()
        ui.onNodeWithText("语言").performScrollTo().performClick(); ui.onNodeWithText("English").performClick()
        ui.onNodeWithText("Language").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("https://owner.example").assertExists()
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Read-only sample navigation]]
    @Test fun samplePreviewHasSchedulesAndReadOnlyConversation() {
        ui.onAllNodesWithText("Account").onLast().performClick()
        ui.onNodeWithText("Preview with sample data").performScrollTo().performClick()
        ui.onNodeWithText("SAMPLE PREVIEW · no Owner connected").assertIsDisplayed()
        ui.onAllNodesWithText("Schedules").onLast().performClick()
        ui.onNodeWithText("每日工作摘要").assertIsDisplayed()
        ui.onAllNodesWithText("Enabled").onLast().assertExists()
        ui.onNodeWithText("Run once").assertDoesNotExist()
        ui.onAllNodesWithText("Conversations").onLast().performClick()
        ui.onNodeWithText("移动端实施契约").performClick()
        ui.onNodeWithText("View only · continue on Owner").assertIsDisplayed()
        ui.onNodeWithContentDescription("Send").assertDoesNotExist()
        ui.runOnUiThread {
            val model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            check(model.state.value.owner == null && model.state.value.operations.isEmpty())
        }
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Sample search]]
    @Test fun sampleSearchFiltersAndClearingRestoresWithoutOwner() {
        ui.runOnUiThread { ViewModelProvider(ui.activity)[MobileViewModel::class.java].demo() }
        ui.onNodeWithTag("list-search").performTextInput("本周")
        ui.onNodeWithTag("list-search").performImeAction()
        ui.onNodeWithText("本周项目进度").assertIsDisplayed()
        ui.onNodeWithText("移动端实施契约").assertDoesNotExist()
        ui.onNodeWithTag("list-search").performTextClearance()
        ui.onNodeWithTag("list-search").performImeAction()
        ui.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("移动端实施契约"))
        ui.onNodeWithText("移动端实施契约").assertIsDisplayed()
        ui.runOnUiThread { check(ViewModelProvider(ui.activity)[MobileViewModel::class.java].state.value.error == null) }
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Late response cancellation]]
    @Test fun forgettingConnectionRejectsLatePairingResponse() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val finished = CountDownLatch(1)
        lateinit var model: MobileViewModel
        ui.runOnUiThread {
            model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            model.createApi = { _, _ -> object : MobileControlClient("https://owner.example", { null }) {
                override fun claimPairing(body: JsonObject): JsonElement {
                    started.countDown()
                    try { check(release.await(5, TimeUnit.SECONDS)); return Json.parseToJsonElement("""{"id":"claim-1","state":"pending","expiresAt":"2026-10-04T03:05:00Z","verificationPhrase":"test phrase","claimProof":"proof"}""") }
                    finally { finished.countDown() }
                }
            } }
            model.pair("https://owner.example", "invitation", "Phone")
        }
        check(started.await(5, TimeUnit.SECONDS))
        ui.runOnUiThread { model.forget(); check(!model.state.value.busy) }
        release.countDown(); check(finished.await(5, TimeUnit.SECONDS))
        ui.waitForIdle()
        ui.runOnUiThread { check(model.state.value.claim == null && !model.state.value.paired && !model.state.value.busy) }
    }

    // @lat: [[mobile-mac-roadmap#Native preview checks#Pending pairing cancellation]]
    @Test fun pairingCanBeCancelledWhileWaitingForApproval() {
        lateinit var model: MobileViewModel
        ui.runOnUiThread {
            model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            model.createApi = { _, _ -> object : MobileControlClient("https://owner.example", { null }) {
                override fun claimPairing(body: JsonObject) = Json.parseToJsonElement("""{"id":"claim-2","state":"pending","expiresAt":"2026-10-04T03:05:00Z","verificationPhrase":"two screens","claimProof":"proof"}""")
                override fun pairingClaim(id: String, proof: String) = claimPairing(JsonObject(emptyMap()))
            } }
        }
        ui.onAllNodesWithText("Account").onLast().performClick()
        ui.runOnUiThread { model.pair("https://owner.example", "invitation", "Phone") }
        ui.waitUntil(5_000) { org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.claim != null }
        ui.onNodeWithText("Cancel").performScrollTo().performClick()
        ui.runOnUiThread { check(model.state.value.claim == null && !model.state.value.busy) }
    }
}
