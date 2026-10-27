package one.agents.mobile

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.*
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import kotlinx.serialization.json.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import one.agents.mobile.contract.*
import one.agents.mobile.local.CachePayloadCipher
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
    private class TestCacheCipher(private val key: javax.crypto.SecretKey) : CachePayloadCipher {
        private val random = java.security.SecureRandom()
        override fun hasNamespaceKey(namespaceId: String) = true
        override fun encrypt(namespaceId: String, plaintext: ByteArray, associatedData: ByteArray): ByteArray {
            val iv = ByteArray(12).also(random::nextBytes)
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key, javax.crypto.spec.GCMParameterSpec(128, iv))
            cipher.updateAAD(associatedData)
            return iv + cipher.doFinal(plaintext)
        }
        override fun decrypt(namespaceId: String, envelope: ByteArray, associatedData: ByteArray): ByteArray {
            require(envelope.size >= 28)
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, key, javax.crypto.spec.GCMParameterSpec(128, envelope.copyOfRange(0, 12)))
            cipher.updateAAD(associatedData)
            return cipher.doFinal(envelope.copyOfRange(12, envelope.size))
        }
        override fun deleteNamespaceKey(namespaceId: String) = Unit
    }
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
    private fun messagePage(sequences: List<String>, more: Boolean = false, cursor: String = "message-cursor", revision: String = "1", conversationId: String = "initial") = Json.encodeToJsonElement(MessagePage(sequences.map { Message(id = "message-$it", conversationId = conversationId, messageSeq = it, kind = "assistant", content = "Original body $it", visibleToUser = true, createdAt = "2026-10-05T00:00:00Z") }, more, cursor, revision))
    private data class Request(val method: String, val suffix: List<String>, val query: Map<String, String> = emptyMap(), val body: JsonObject? = null)
    private inner class Client : MobileControlClient("https://owner.example", { null }) {
        val calls = CopyOnWriteArrayList<Request>()
        var revokeCalls = 0
        var handleListOwners: (() -> JsonElement)? = null
        var capabilities = listOf("conversation:read", "schedule:read")
        var bootstrapOwnerId = "owner-1"
        var handleRead: ((List<String>, Map<String, String>) -> JsonElement?)? = null
        var handleSearch: ((List<String>, JsonObject) -> JsonElement)? = null
        var handleMarkRead: ((String, String) -> JsonElement)? = null
        var handleAvatar: ((OwnerBinding, String, String) -> RuntimeAvatarBytes)? = null
        override fun runtimeAvatar(binding: OwnerBinding, runtimeId: String, avatarId: String): RuntimeAvatarBytes = handleAvatar?.invoke(binding, runtimeId, avatarId) ?: error("Unexpected avatar request")
        override fun currentDevice(): JsonElement = throw java.io.IOException("Device label unavailable in synthetic offline fixture")
        override fun listOwners(): JsonElement = handleListOwners?.invoke() ?: error("Unexpected Owner directory request")
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
        override fun revokeDevice() { revokeCalls++ }
    }
    @Before fun reset() {
        ui.runOnUiThread { model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]; model.forget(); model.language("en") }
    }
    @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    @Test fun coldStartupRendersEncryptedOwnerPagesBeforeOfflineOwnerDirectoryCompletes() {
        val application = ui.activity.application
        val endpoint = "https://127.0.0.1:1"
        val key = javax.crypto.spec.SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")
        val preferences = DevicePreferences(application) { key }
        val credentials = Credentials("opt010-cache-device", "cached-access", "2099-01-01T00:00:00Z", "cached-refresh", "2099-01-01T00:00:00Z", "7")
        val owner = owner(listOf("conversation:read", "conversation:manage", "schedule:read"))
        preferences.saveCredentials(credentials, endpoint)
        preferences.saveLastOwnerContext(owner, credentials.grantRevision, credentials)

        val testCipher = TestCacheCipher(key)
        val repository = MobileCacheRepository(application, testCipher)
        val namespace = repository.namespace(endpoint, owner.ownerId, owner.spaceId, credentials.deviceId, credentials.grantRevision)
        val selection = MobileListSelection()
        fun filters(schedules: Boolean) = selection.arguments(schedules).toSortedMap().map { (name, value) -> name to value.toString() }
        val cachedConversation = conversation("cached-conversation").copy(allowedActions = listOf("read", "manage"))
        val cachedConversationPage = Json.encodeToJsonElement(ConversationPage(listOf(cachedConversation) + (1..5).map { conversation("legacy-quick-$it").copy(sourceKind = "quick_chat", createdAt = "2026-07-21T00:00:00Z") }, null, "snapshot-1"))
        kotlinx.coroutines.runBlocking {
            listOf(false to cachedConversationPage, true to schedules(listOf("cached-schedule"))).forEach { (isSchedule, payload) ->
                val section = if (isSchedule) "schedules" else "conversations"
                val key = repository.pageKey(namespace, owner.dataEpoch, section, "", filters(isSchedule), null)
                val objectValue = payload.jsonObject
                val revision = objectValue["snapshotRevision"]!!.jsonPrimitive.content
                val sequence = objectValue["snapshotCursor"]?.jsonPrimitive?.contentOrNull ?: revision
                val next = objectValue["nextCursor"]?.let { if (it === JsonNull) null else it.jsonPrimitive.contentOrNull }
                repository.writePage(namespace, credentials.grantRevision, key, payload, revision, sequence, next, System.currentTimeMillis())
            }
        }
        val cachedMessagePage = messagePage(listOf("1", "2"), conversationId = "cached-conversation")
        val conversationDetailKey = repository.pageKey(namespace, owner.dataEpoch, "conversation-detail", "cached-conversation", emptyList(), null, one.agents.mobile.local.CacheResourceKind.MESSAGE)
        val conversationBundle = buildJsonObject {
            put("detail", Json.encodeToJsonElement(cachedConversation))
            put("messagePage", cachedMessagePage)
            put("snapshotCursor", "message-cursor")
            put("snapshotRevision", "1")
            put("nextCursor", JsonNull)
        }
        kotlinx.coroutines.runBlocking {
            repository.writePage(namespace, credentials.grantRevision, conversationDetailKey, conversationBundle, "1", "message-cursor", null, System.currentTimeMillis())
        }

        val cachedSchedule = scheduleDetail("cached-schedule")
        val scheduleDetailKey = repository.pageKey(namespace, owner.dataEpoch, "schedule-detail", "cached-schedule", emptyList(), null, one.agents.mobile.local.CacheResourceKind.SCHEDULE)
        val scheduleBundle = buildJsonObject {
            put("detail", cachedSchedule)
            put("snapshotCursor", "9")
            put("snapshotRevision", "9")
            put("nextCursor", JsonNull)
        }
        kotlinx.coroutines.runBlocking {
            repository.writePage(namespace, credentials.grantRevision, scheduleDetailKey, scheduleBundle, "9", "9", null, System.currentTimeMillis())
        }

        val avatarPng = java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII=")
        fun avatarHash(prefix: ByteArray = byteArrayOf()) = java.security.MessageDigest.getInstance("SHA-256").apply { update(prefix); update(avatarPng) }.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        val avatarId = "ava-" + avatarHash("image/png\u0000".toByteArray())
        val cachedRuntime = Runtime("runtime-1", "Original avatar agent", "local", avatar = avatarId, healthy = true, capabilities = emptyList(), allowedActions = listOf("read", "advance"))
        val avatar = RuntimeAvatar(avatarId, cachedRuntime.id, "image/png", avatarPng.size.toLong(), avatarHash(), java.util.Base64.getEncoder().encodeToString(avatarPng))
        kotlinx.coroutines.runBlocking {
            listOf("runtime-directory" to JsonArray(listOf(Json.encodeToJsonElement(cachedRuntime))), "avatar-" + cachedRuntime.id + "-" + avatarId to JsonArray(listOf(Json.encodeToJsonElement(avatar)))).forEach { (section, items) ->
                val kind = if(section.startsWith("avatar-")) one.agents.mobile.local.CacheResourceKind.PRIVATE_AVATAR else one.agents.mobile.local.CacheResourceKind.DIRECTORY_ENTRY
                val key = repository.pageKey(namespace, owner.dataEpoch, section, "", emptyList(), null, kind)
                val payload = buildJsonObject { put("items", items); put("snapshotRevision", "0"); put("snapshotCursor", "0"); put("nextCursor", JsonNull) }
                repository.writePage(namespace, credentials.grantRevision, key, payload, "0", "0", null, System.currentTimeMillis())
            }
        }

        repository.close()
        val requestStarted = CountDownLatch(1)
        val releaseRequest = CountDownLatch(1)
        val offlineClient = Client().also { client ->
            client.handleListOwners = {
                requestStarted.countDown()
                check(releaseRequest.await(10, TimeUnit.SECONDS))
                throw java.io.IOException("simulated offline Owner")
            }
        }
        val store = ViewModelStore()
        val offlineModel = MobileViewModel(application, preferences, { _, _ -> offlineClient }) { app -> MobileCacheRepository(app, testCipher) }
        store.put("offline-cache-test", offlineModel)
        try {
            ui.waitUntil(10000) {
                Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
                requestStarted.count == 0L && offlineModel.state.value.conversations.any { it.id == "cached-conversation" } &&
                    offlineModel.state.value.schedules.any { it.id == "cached-schedule" }
            }
            val loading = offlineModel.state.value
            check(loading.ownerCacheOnly && loading.busy && loading.ownerDataRefreshing)
            check(loading.owner?.online == false && loading.owner?.executionAvailable == false)
            check(loading.conversationCacheStale && loading.scheduleCacheStale)
            check(loading.conversations.single().id == "cached-conversation" && loading.schedules.single().id == "cached-schedule")

            releaseRequest.countDown()
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !offlineModel.state.value.busy && !offlineModel.state.value.ownerDataRefreshing }
            val offline = offlineModel.state.value
            check(offline.ownerCacheOnly && offline.paired && offline.error == null)
            check(offline.conversations.single().id == "cached-conversation" && offline.schedules.single().id == "cached-schedule")
            check(offlineModel.state.value.runtimes.single().id == cachedRuntime.id)
            check(offlineModel.state.value.runtimes.single().allowedActions == listOf("read"))
            val offlineAvatar = kotlinx.coroutines.runBlocking { offlineModel.loadRuntimeAvatar(offlineModel.state.value.runtimes.single()) }
            check(offlineAvatar != null && offlineAvatar.width == 2 && offlineAvatar.getPixel(0,0) == android.graphics.Color.rgb(243,112,33))


            ui.runOnUiThread { offlineModel.openConversation(offline.conversations.single()) }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !offlineModel.state.value.busy && !offlineModel.state.value.openingDetail }
            check(offlineModel.state.value.selected?.id == "cached-conversation")
            check(offlineModel.state.value.messages.map { it.content } == listOf("Original body 1", "Original body 2"))

            val offlinePolicy = ExecutionPolicy("offline-policy", "runtime-1", mode = "inspect", enforced = true, unattendedApproved = false, allowedActions = listOf("create", "advance"))
            val callsBeforeConversationWrites = offlineClient.calls.size
            ui.runOnUiThread { offlineModel.advance("offline continuation", offlinePolicy) }
            ui.waitUntil(10000) {
                Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
                !offlineModel.state.value.busy && offlineModel.state.value.pendingMessages.any { it.text == "offline continuation" && it.delivery == "failed" }
            }
            ui.runOnUiThread { offlineModel.createConversation("offline create", "offline first prompt", offlinePolicy) }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !offlineModel.state.value.busy }
            val selectedForManagement = offlineModel.state.value.selected ?: error("Cached conversation was not selected")
            ui.runOnUiThread { offlineModel.manageConversation(selectedForManagement, "pinned", true) }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !offlineModel.state.value.busy }
            ui.runOnUiThread { offlineModel.renameConversation(selectedForManagement, "offline rename") }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !offlineModel.state.value.busy }
            check(offlineClient.calls.drop(callsBeforeConversationWrites).none { it.method in setOf("POST", "PATCH", "DELETE") })

            ui.runOnUiThread { offlineModel.openSchedule(offline.schedules.single()) }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !offlineModel.state.value.busy && !offlineModel.state.value.openingDetail }
            check(offlineModel.state.value.viewedSchedule?.id == "cached-schedule")
            check(offlineModel.state.value.viewedSchedule?.revision == "9")

            val readsBeforeMutationAttempts = offlineClient.calls.size
            ui.runOnUiThread { offlineModel.scheduleAction(offline.schedules.single(), "pause") }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !offlineModel.state.value.busy }
            ui.runOnUiThread { offlineModel.revoke() }
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !offlineModel.state.value.busy }
            check(offlineClient.revokeCalls == 0)
            check(offlineClient.calls.drop(readsBeforeMutationAttempts).none { it.method in setOf("POST", "PATCH", "DELETE") })
            check(offlineClient.calls.none { it.suffix == listOf("conversations", "cached-conversation") || it.suffix == listOf("conversations", "cached-conversation", "messages") || it.suffix == listOf("schedules", "cached-schedule") })

            val ownerListStarted = CountDownLatch(1)
            val releaseOwnerList = CountDownLatch(1)
            val removedOwnerClient = Client().also { client ->
                client.handleListOwners = {
                    ownerListStarted.countDown()
                    check(releaseOwnerList.await(10, TimeUnit.SECONDS))
                    Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"2"}""")
                }
            }
            val removedOwnerStore = ViewModelStore()
            val removedOwnerModel = MobileViewModel(application, preferences, { _, _ -> removedOwnerClient }) { app -> MobileCacheRepository(app, testCipher) }
            removedOwnerStore.put("removed-owner-cache-test", removedOwnerModel)
            try {
                ui.waitUntil(10000) {
                    Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
                    ownerListStarted.count == 0L && removedOwnerModel.state.value.conversations.any { it.id == "cached-conversation" }
                }
                check(removedOwnerModel.state.value.ownerCacheOnly)
                releaseOwnerList.countDown()
                ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !removedOwnerModel.state.value.busy && !removedOwnerModel.state.value.ownerDataRefreshing }
                check(removedOwnerModel.state.value.owner == null && !removedOwnerModel.state.value.ownerCacheOnly)
                check(removedOwnerModel.state.value.conversations.isEmpty() && removedOwnerModel.state.value.schedules.isEmpty())
                check(removedOwnerModel.state.value.runtimes.isEmpty())
                check(preferences.lastOwnerContext(credentials) == null)
            } finally {
                releaseOwnerList.countDown()
                removedOwnerStore.clear()
            }

            val retainedCacheRepository = MobileCacheRepository(application, testCipher)
            try {
                val retainedConversationKey = retainedCacheRepository.pageKey(namespace, owner.dataEpoch, "conversations", "", filters(false), null)
                check(kotlinx.coroutines.runBlocking { retainedCacheRepository.readPage(namespace, retainedConversationKey) } != null)
            } finally {
                retainedCacheRepository.close()
            }

            preferences.saveCredentials(credentials, endpoint)
            preferences.saveLastOwnerContext(owner, credentials.grantRevision, credentials)
            check(preferences.lastOwnerContext(credentials) != null)
            val changedCredentials = credentials.copy(grantRevision = "8")
            preferences.saveCredentials(changedCredentials, endpoint)
            check(preferences.lastOwnerContext(changedCredentials) == null)
            val grantChangedClient = Client().also { client ->
                client.handleListOwners = { Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"3"}""") }
            }
            val grantChangedStore = ViewModelStore()
            val grantChangedModel = MobileViewModel(application, preferences, { _, _ -> grantChangedClient }) { app -> MobileCacheRepository(app, testCipher) }
            grantChangedStore.put("changed-grant-cache-test", grantChangedModel)
            try {
                check(!grantChangedModel.state.value.ownerCacheOnly)
                check(grantChangedModel.state.value.conversations.isEmpty() && grantChangedModel.state.value.schedules.isEmpty())
                ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !grantChangedModel.state.value.busy }
                check(grantChangedModel.state.value.owner == null && grantChangedModel.state.value.conversations.isEmpty() && grantChangedModel.state.value.schedules.isEmpty())
            } finally {
                grantChangedStore.clear()
            }
        } finally {
            releaseRequest.countDown()
            store.clear()
        }
    }
    private fun avatarClient(): Client = Client().also { client ->
        client.handleRead = { suffix, _ -> if (suffix == listOf("runtimes")) Json.encodeToJsonElement(RuntimePage(listOf(Runtime("runtime-1", "Original agent", "local", avatar = "ava-1b4d3cd3392295481b6e62e72f15318c53f82fba43616f651d62fe062bcf5708", color = "#F37021", healthy = true, capabilities = emptyList(), allowedActions = listOf("read"))), null, "1")) else null }
        ui.runOnUiThread { MobileViewModel::class.java.getDeclaredField("credentials").apply { isAccessible = true }.set(model, Credentials("phone-1", "test-token", "2099-01-01T00:00:00Z", "test-refresh", "2099-01-01T00:00:00Z", "1")) }
    }
    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE) fun originalListReadsOnlyCurrentRuntimeReferenceAndKeepsTaskStateIndependent() {
        val client = avatarClient()
        val requests = CopyOnWriteArrayList<List<Any>>()
        client.handleAvatar = { binding, runtime, avatar ->
            requests.add(listOf(binding, runtime, avatar))
            RuntimeAvatarBytes("image/png", java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII="))
        }
        connect(client)
        check(model.state.value.runtimes.single().avatar == "ava-1b4d3cd3392295481b6e62e72f15318c53f82fba43616f651d62fe062bcf5708")
        try { ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50)); ui.onAllNodesWithTag("runtime-avatar-image", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() } } catch (error: androidx.compose.ui.test.ComposeTimeoutException) { error("Avatar not shown: requests=${requests.size}, ownerOnline=${model.state.value.owner?.online}, ownerCacheOnly=${model.state.value.ownerCacheOnly}, error=${model.state.value.error}, conversations=${model.state.value.conversations.size}") }
        check(requests.single() == listOf(OwnerBinding("owner-1","space-1"), "runtime-1", "ava-1b4d3cd3392295481b6e62e72f15318c53f82fba43616f651d62fe062bcf5708"))
        check(model.state.value.error == null && !model.state.value.busy)
        ui.onNodeWithTag("runtime-avatar-image", useUnmergedTree = true).assertIsDisplayed()
    }
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
    @Test fun revokedImageReadClearsOriginalConnectionAndDoesNotBecomeTaskFailure() {
        val client = avatarClient()
        client.handleAvatar = { _, _, _ -> throw MobileApiException("revoked",403) }
        connect(client)
        ui.waitUntil(10000) { model.state.value.owner == null }
        check(model.state.value.runtimes.isEmpty() && model.state.value.error == null)
    }
    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE) fun authorizedOriginalPreviewUsesOneEllipsizedLineAtNarrowWidth() {
        val client = Client(); val preview = "原消息 excerpt " + "long original text ".repeat(10)
        client.handleRead = { suffix, _ -> if (suffix == listOf("conversations")) Json.encodeToJsonElement(ConversationPage(listOf(conversation("preview").copy(lastMessagePreview = preview)),null,"1")) else null }
        connect(client)
        val layouts = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        ui.onNodeWithText(preview,useUnmergedTree=true).assertIsDisplayed().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
        check(layouts.single().lineCount == 1 && layouts.single().isLineEllipsized(0))
        check(model.state.value.conversations.single().lastMessagePreview == preview && model.state.value.selected == null)
    }
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
    @Test fun taskDirectoryExcludesLegacyQuickChatsAcrossReadSearchAndMoreWithoutDateCutoff() {
        val client = Client()
        val oldTask = conversation("real-july-task").copy(createdAt = "2026-07-01T00:00:00Z", updatedAt = "2026-07-01T00:00:00Z")
        val legacy = (1..5).map { conversation("legacy-quick-$it").copy(sourceKind = "quick_chat") }
        client.handleRead = { suffix, query -> if (suffix == listOf("conversations")) Json.encodeToJsonElement(ConversationPage(if(query["cursor"] == null) listOf(oldTask) + legacy else listOf(conversation("next-task")) + legacy, if(query["cursor"] == null) "next-page" else null, "1")) else null }
        connect(client)
        check(model.state.value.conversations.map { it.id } == listOf(oldTask.id))
        check(model.state.value.conversationCursor == "next-page" && model.state.value.conversationError == null)
        perform { model.more(false) }
        check(model.state.value.conversations.map { it.id } == listOf(oldTask.id, "next-task"))
        client.handleSearch = { _, _ -> Json.encodeToJsonElement(ConversationPage(listOf(oldTask) + legacy, null, "2")) }
        perform { model.search("task", false) }
        check(model.state.value.conversations.map { it.id } == listOf(oldTask.id) && model.state.value.conversationError == null)
        ui.runOnUiThread { model.language("zh-CN") }
        ui.waitForIdle()
        ui.onAllNodesWithText("任务").assertCountEquals(3)
        ui.onAllNodesWithText("对话", substring = false).assertCountEquals(0)
    }
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
    @Test fun failedFilterLeavesTheOriginalQueryAndCursorAndCatalogFailureIsIndependent() {
        val client = Client()
        client.handleRead = { suffix, _ -> if (suffix == listOf("projects")) Json.encodeToJsonElement(ProjectPage(listOf(Project("p1", "First", emptyList())), null, "1")) else null }
        client.handleSearch = { _, body ->
            if (body["projectId"] != null) throw MobileApiException("owner_offline", 503)
            conversations(listOf(if (body["cursor"] == null) "old" else "more"), if (body["cursor"] == null) "old-cursor" else null)
        }
        connect(client); perform { model.search("original", false) }; perform { model.selectListFilters(MobileListSelection("p1"), false) }
        check(model.state.value.conversationSelection == MobileListSelection() && model.state.value.conversationQuery == "original" && model.state.value.conversationCursor == "old-cursor") { "selection=${model.state.value.conversationSelection}, query=${model.state.value.conversationQuery}, cursor=${model.state.value.conversationCursor}, error=${model.state.value.conversationError}" }
        perform { model.more(false) }
        check(client.calls.last().body!!["projectId"] == null && client.calls.last().body!!["query"]!!.jsonPrimitive.content == "original")
        client.handleRead = { suffix, _ -> if (suffix == listOf("projects")) throw MobileApiException("owner_offline", 503) else null }
        perform { model.refresh() }
        check(model.state.value.projectError == "owner_offline" && model.state.value.conversations.isNotEmpty() && model.state.value.scheduleError == null)
    }
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
    @Test fun readBoundaryAdvancesToVisibleLatestMessageAndScrollingBackDoesNotRewindIt() {
        val client = messageClient { messagePage((1..100).map { it.toString() }) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) {
            Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            model.state.value.selected?.lastReadMessageSeq == "100" &&
                runCatching { ui.onNodeWithText("Original body 100").assertIsDisplayed() }.isSuccess
        }
        val acknowledged = model.state.value.selected!!.lastReadMessageSeq
        check(acknowledged == "100")
        check(client.calls.filter { it.suffix.last() == "read" }.any { it.body?.get("lastReadMessageSeq")?.jsonPrimitive?.content == acknowledged })
        ui.onNodeWithTag("conversation-messages").performScrollToIndex(60)
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); runCatching { ui.onNodeWithText("Original body 100").assertDoesNotExist() }.isSuccess }
        check(model.state.value.selected!!.lastReadMessageSeq == acknowledged)
    }
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
    @Test fun wrongOwnerResponseDoesNotOptimisticallyMarkRead() {
        val client = messageClient { messagePage(listOf("1")) }
        client.handleMarkRead = { _, _ -> Json.encodeToJsonElement(ReadPosition("other", "1")) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.readError == "protocol_incompatible" }
        check(model.state.value.selected!!.lastReadMessageSeq == "0")
    }
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
    @Test fun hiddenLoadedMessagesCannotBecomeReadBoundaries() {
        val client = messageClient { Json.encodeToJsonElement(MessagePage(listOf(Message(id = "hidden", conversationId = "initial", messageSeq = "99", kind = "assistant", content = "Private", visibleToUser = false, createdAt = "2026-10-05T00:00:00Z")), false, "cursor", "1")) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.runOnUiThread { model.acknowledgeVisible("initial", listOf("99")) }
        ui.waitForIdle(); check(client.calls.none { it.suffix.last() == "read" })
        check(model.state.value.selected!!.lastReadMessageSeq == "0")
    }
    @Test fun revokedReadAcknowledgementClearsOwnerAndLoadedBusinessViews() {
        val client = messageClient { messagePage(listOf("1")) }
        client.handleMarkRead = { _, _ -> throw MobileApiException("revoked", 403) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.error == "revoked" }
        check(model.state.value.owner == null && model.state.value.selected == null && model.state.value.messages.isEmpty())
    }
    private fun perform(block: () -> Unit) {
        ui.runOnUiThread(block)
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy && !model.state.value.ownerDataRefreshing }
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
    @Test fun failedSearchDoesNotBindExistingCursorToNewQueryAndClearReturnsToGet() {
        val client = Client()
        client.handleSearch = { _, body ->
            if (body["query"]?.jsonPrimitive?.content == "bad") throw MobileApiException("owner_offline", 503)
            conversations(listOf(if (body["cursor"] == null) "old" else "more"), if (body["cursor"] == null) "old-cursor" else null)
        }
        connect(client); perform { model.search("good", false) }; perform { model.search("bad", false) }; perform { model.more(false) }
        check(client.calls.last().body?.get("query")?.jsonPrimitive?.content == "good") { "lastRequest=${client.calls.last()}" }
        perform { model.search("   ", false) }
        check(client.calls.last().method == "GET" && client.calls.last().query.isEmpty())
        check(model.state.value.conversationQuery.isEmpty())
    }
    @Test fun ungrantedSchedulesAreNotRequestedAndCatalogFailureDoesNotHideConversations() {
        val client = Client(); client.capabilities = listOf("conversation:read")
        client.handleRead = { suffix, _ -> if (suffix == listOf("runtimes")) throw MobileApiException("requires_owner_action", 503) else null }
        connect(client)
        check(model.state.value.conversations.map { it.id } == listOf("initial"))
        check(model.state.value.scheduleError == "requires_owner_action")
        check(model.state.value.error == "sync_temporarily_unavailable")
        check(client.calls.none { it.suffix == listOf("schedules") || it.suffix == listOf("execution-policies") })
        ui.onNodeWithContentDescription("New conversation").assertDoesNotExist()
        val before = client.calls.size; perform { model.search("plan", true) }
        check(client.calls.size == before && model.state.value.error == "scope_denied")
    }
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
    @Test fun differentOwnerBootstrapIsRejectedBeforeBusinessReads() {
        val client = Client(); client.bootstrapOwnerId = "different-owner"
        connect(client)
        check(model.state.value.owner == null && model.state.value.error == "protocol_incompatible")
        check(client.calls.size == 1)
    }
    @Test fun revocationIsNotSwallowedAsAPartialListError() {
        val client = Client()
        client.handleRead = { suffix, _ -> if (suffix == listOf("schedules")) throw MobileApiException("revoked", 403) else null }
        connect(client)
        check(model.state.value.owner == null && model.state.value.conversations.isEmpty())
        check(model.state.value.error == "revoked" && !model.state.value.busy) { "error=${model.state.value.error}, busy=${model.state.value.busy}, owner=${model.state.value.owner}" }
    }
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
    @Test fun historyPastOneHundredRunsKeepsOriginalIdsAndFrozenRevision() {
        val client = historyClient { query -> if (query["cursor"] == null) history((1..100).map { "e$it" }, "history-cursor") else history((101..125).map { "e$it" }) }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }
        check(model.state.value.scheduleExecutions.size == 100)
        perform { model.moreScheduleHistory() }
        check(model.state.value.scheduleExecutions.size == 125 && model.state.value.historyCursor == null)
        check(model.state.value.scheduleExecutions.last().conversationId == "result-e125")
        check(client.calls.last().suffix == listOf("schedules", "initial-schedule", "executions") && client.calls.last().query == mapOf("cursor" to "history-cursor"))
    }
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
    @Test fun historyFailurePreservesDefinitionAndDisplaysAnErrorWithoutEmptySuccess() {
        val client = historyClient { throw MobileApiException("requires_owner_action", 409) }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }
        ui.onNodeWithText("Original schedule instructions").assertIsDisplayed()
        ui.onNodeWithTag("schedule-history").performScrollToNode(hasText("Continue this action on your Owner."))
        ui.onNodeWithText("Continue this action on your Owner.").assertIsDisplayed()
        ui.onNodeWithText("No executions yet").assertDoesNotExist()
        check(model.state.value.viewedSchedule?.revision == "9" && model.state.value.historyError == "requires_owner_action")
    }
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
    @Test fun allOneHundredTwentyFiveMessagesArriveInOriginalOrderAndBody() {
        val client = messageClient { query -> when (query["cursor"]) {
            null -> messagePage((76..125).map { it.toString() }, true, "before-76")
            "before-76" -> messagePage((26..75).map { it.toString() }, true, "before-26")
            "before-26" -> messagePage((1..25).map { it.toString() }, false, "start")
            else -> error("Unexpected cursor")
        } }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); model.state.value.hasOlderMessages && model.state.value.messages.size == 50 }
        ui.onNodeWithTag("conversation-messages").performScrollToIndex(0)
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
    @Test fun sequenceComparisonRetainsSixtyFourDigitValuesAndGapsWithoutNumericCoercion() {
        val big = "1" + "0".repeat(63); val previous = (big.toBigInteger() - java.math.BigInteger.ONE).toString()
        val client = messageClient { query -> if (query["cursor"] == null) messagePage(listOf(big), true, "old") else messagePage(listOf(previous)) }
        connect(client); perform { model.openConversation(model.state.value.conversations.single()) }; perform { model.olderMessages() }
        check(model.state.value.messages.map { it.messageSeq } == listOf(previous, big))
        check(client.calls.last().query["beforeSeq"] == big)
    }
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
    @Test fun refreshingOriginalResultConversationRetainsItsParentHistory() {
        val client = historyClient { history(listOf("e1")) }
        connect(client); perform { model.openSchedule(model.state.value.schedules.single()) }; perform { model.openExecutionConversation(model.state.value.scheduleExecutions.single()) }
        perform { model.refreshConversation() }
        check(model.state.value.selected?.id == "result-e1" && model.state.value.viewedSchedule?.id == "initial-schedule")
        ui.onNodeWithContentDescription("Back").performClick()
        check(model.state.value.selected == null && model.state.value.scheduleExecutions.single().id == "e1" && model.state.value.messageCursor == null)
    }

    private fun projectListClient(): Client = Client().apply {
        handleRead = { suffix, query -> when (suffix) {
            listOf("projects") -> Json.encodeToJsonElement(ProjectPage(listOf(Project("project-test", "test", emptyList())), null, "1"))
            listOf("conversations") -> {
                val projectRows = (1..3).map { conversation("project-task-$it").copy(projectId = "project-test") }
                val rows = if (query["projectId"] == "project-test") projectRows else projectRows + listOf(conversation("home-task-1"), conversation("home-task-2"))
                Json.encodeToJsonElement(ConversationPage(rows, null, "1"))
            }
            else -> when {
                suffix.size == 2 && suffix.first() == "conversations" -> Json.encodeToJsonElement(conversation(suffix[1]).copy(projectId = "project-test"))
                suffix.size == 3 && suffix.last() == "messages" -> Json.encodeToJsonElement(MessagePage(emptyList(), false, "detail-page", "1"))
                else -> null
            }
        } }
    }
    @Test fun standaloneConversationCategoryExcludesOriginalProjectTasks() {
        connect(projectListClient())
        ui.onNodeWithText("home-task-1").assertExists()
        ui.onNodeWithText("project-task-1").assertDoesNotExist()
        check(model.state.value.conversations.count { it.projectId != null } == 3)
        ui.onNodeWithTag("category:projects").performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
        ui.onNodeWithTag("project-group:project-test").performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy && model.state.value.conversationSelection.projectId == "project-test" }
        ui.onNodeWithText("project-task-1").assertExists()
        ui.onNodeWithText("home-task-1").assertDoesNotExist()
    }
    @Test fun returningFromSchedulesAndAccountAfterProjectReadRestoresStandaloneList() {
        connect(projectListClient())
        for (destination in listOf("Schedules", "Account")) {
            ui.onNodeWithTag("category:projects").performClick()
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
            ui.onNodeWithTag("project-group:project-test").performClick()
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy && model.state.value.conversationSelection.projectId == "project-test" }
            ui.onAllNodesWithText(destination).onLast().performClick()
            ui.onAllNodesWithText("Tasks").onLast().performClick()
            ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
            ui.onNodeWithText("home-task-1").assertExists()
            ui.onNodeWithText("project-task-1").assertDoesNotExist()
            check(model.state.value.conversationSelection == MobileListSelection())
        }
    }


    @Test fun openingProjectTaskAndBackKeepsItsGroupBeforeBottomNavigation() {
        connect(projectListClient())
        ui.onNodeWithTag("category:projects").performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
        ui.onNodeWithTag("project-group:project-test").performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy && model.state.value.conversationSelection.projectId == "project-test" }
        ui.onNodeWithText("project-task-1").performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy && model.state.value.selected?.id == "project-task-1" }
        ui.onNodeWithContentDescription("Back").performClick()
        ui.onNodeWithTag("project-group:project-test").assertExists()
        ui.onNodeWithText("project-task-1").assertExists()
        ui.onAllNodesWithText("Account").onLast().performClick()
        ui.onAllNodesWithText("Tasks").onLast().performClick()
        ui.waitUntil(10000) { Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); !model.state.value.busy }
        ui.onNodeWithText("home-task-1").assertExists()
        ui.onNodeWithText("project-task-1").assertDoesNotExist()
    }

}
