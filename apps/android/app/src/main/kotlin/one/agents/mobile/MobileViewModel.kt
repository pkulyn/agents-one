package one.agents.mobile

import android.app.Application
import android.graphics.Bitmap
import android.os.SystemClock
import android.util.LruCache
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import one.agents.mobile.contract.*
import one.agents.mobile.net.*

data class MobileState(
    val language: String = "en", val appearance: String = "system", val busy: Boolean = false, val error: String? = null,
    val owner: OwnerSpace? = null, val owners: List<OwnerSpace> = emptyList(),
    val conversations: List<Conversation> = emptyList(), val schedules: List<ScheduleSummary> = emptyList(),
    val runtimes: List<Runtime> = emptyList(), val policies: List<ExecutionPolicy> = emptyList(),
    val messages: List<Message> = emptyList(), val selected: Conversation? = null,
    val composerDraft: String = "",
    val pendingMessages: List<PendingUserMessage> = emptyList(),
    val operations: List<OperationReceipt> = emptyList(), val claim: PairingClaim? = null,
    val demo: Boolean = false, val paired: Boolean = false,
    val selectedSchedule: Schedule? = null, val preview: SchedulePreview? = null,
    val conversationCursor: String? = null, val scheduleCursor: String? = null,
    val conversationError: String? = null, val scheduleError: String? = null,
    val conversationQuery: String = "", val scheduleQuery: String = "",
    val conversationSelection: MobileListSelection = MobileListSelection(), val scheduleSelection: MobileListSelection = MobileListSelection(),
    val projects: List<Project> = emptyList(), val projectError: String? = null,
    val viewedSchedule: Schedule? = null, val scheduleExecutions: List<ScheduleExecution> = emptyList(),
    val historyCursor: String? = null, val historySnapshotRevision: String? = null, val historyError: String? = null,
    val openingDetail: Boolean = false,
    val hasOlderMessages: Boolean = false, val messageCursor: String? = null,
    val messageSnapshotRevision: String? = null, val messageError: String? = null,
    val readError: String? = null,
    val syncError: String? = null,
    val runs: List<Run> = emptyList(), val runError: String? = null,
    val failureTraces: Map<String, FailureTrace> = emptyMap(),
)

/** A process-memory-only echo of a submitted turn, reconciled with Owner messages. */
data class PendingUserMessage(
    val id: String,
    val conversationId: String,
    val afterMessageSeq: String,
    val text: String,
    val createdAt: String,
    val delivery: String,
)

class MobileViewModel(application: Application) : AndroidViewModel(application) {
    val preferences = DevicePreferences(application)
    private var credentials = preferences.credentials()
    internal var createApi: (String, () -> String?) -> MobileControlClient = { endpoint, token -> MobileControlClient(endpoint, token) }
    private var actionJob: Job? = null
    private var generation = 0
    private var navigationVersion = 0
    private var openingConversation = false
    private val credentialMutex = Mutex()
    private var readJob: Job? = null
    private var desiredRead: String? = null
    private var attemptedRead: String? = null
    private fun resetReadObservation() {
        readJob?.cancel(); readJob = null; desiredRead = null; attemptedRead = null
        mutable.update { it.copy(readError = null) }
    }
    private var sampleConversations = emptyList<Conversation>()
    private var sampleSchedules = emptyList<ScheduleSummary>()
    private var refreshRotationId: String? = preferences.rotationId
    private var token = credentials?.accessToken
    private val json = Json { ignoreUnknownKeys = true }
    private val mutable = MutableStateFlow(MobileState(language = preferences.language, appearance = preferences.appearance, paired = credentials != null))
    val state = mutable.asStateFlow()
    private var client: MobileControlClient? = null
    private var previewCandidate: JsonObject? = null
    private var foreground = false
    private var eventJob: Job? = null
    private var observationVersion = 0
    private var eventCursor: EventCursor? = null
    private var eventAnchor: String? = null
    private var recoverEvents = false
    private var conversationSearchDirty = false
    private var scheduleSearchDirty = false
    private var observedGrantRevision: String? = null
    private var receiptsDirty = false
    private var lastReceiptRefreshAt = 0L
    private val receiptRefreshIntervalMs = 30_000L
    private data class PendingMutation(val key: String, val binding: OwnerBinding, val deviceId: String, val epoch: String, val suffix: List<String>, val body: JsonObject?, val revision: String?, val method: String, val action: String)
    private val pendingMutations = mutableMapOf<String, PendingMutation>()
    private var createdDraft: Pair<String, String>? = null
    private val artifactFiles = ArtifactFiles(application.cacheDir)
    private val avatarReads = kotlinx.coroutines.sync.Semaphore(2)
    private val avatarCache = object : LruCache<String, Bitmap>(8 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int =
            (value.allocationByteCount / 1024).coerceAtLeast(1)
    }

    internal fun runtimeAvatarSource(): List<Any?> = listOf(generation, client, credentials?.deviceId, credentials?.grantRevision, observedGrantRevision, state.value.owner?.ownerId, state.value.owner?.spaceId, state.value.owner?.dataEpoch)
    internal suspend fun loadRuntimeAvatar(runtime: Runtime): android.graphics.Bitmap? {
        val source = runtimeAvatarSource()
        val owner = state.value.owner ?: return null
        val api = client ?: return null
        val reference = runtime.avatar ?: return null
        val cacheKey = listOf(generation, credentials?.deviceId, credentials?.grantRevision, observedGrantRevision, owner.ownerId, owner.spaceId, owner.dataEpoch, runtime.id, reference).joinToString("\u0000")
        fun current() = !state.value.demo && credentials != null && runtimeAvatarSource() == source && state.value.runtimes.any { it.id == runtime.id && it.avatar == reference }
        if (!current()) return null
        avatarCache.get(cacheKey)?.let { return if (current()) it else null }
        avatarReads.acquire()
        try {
            if (!current()) return null
            avatarCache.get(cacheKey)?.let { return if (current()) it else null }
            ensureCredentials()
            if (!current()) return null
            val result = call { decodeRuntimeAvatar(api.runtimeAvatar(OwnerBinding(owner.ownerId, owner.spaceId), runtime.id, reference)) }
            if (!current()) return null
            if (result != null) avatarCache.put(cacheKey, result)
            return result
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current() && authenticationFailure(e)) clearConnection()
            return null
        } finally { avatarReads.release() }
    }

    internal fun prepareArtifact(artifact: Artifact, ready: (PreparedArtifact) -> Unit) = action {
        val owner = state.value.owner ?: throw MobileApiException("owner_offline", 0)
        if (state.value.demo || "artifact:read" !in owner.capabilities || "download" !in artifact.allowedActions)
            throw MobileApiException("scope_denied", 403)
        if (state.value.runs.none { run -> run.artifacts.any { it.id == artifact.id && it.runId == artifact.runId } })
            throw MobileApiException("resource_not_found", 404)
        val version = generation; val navigation = navigationVersion
        val device = credentials?.deviceId ?: throw MobileApiException("credential_expired", 401)
        val grant = observedGrantRevision ?: throw MobileApiException("protocol_incompatible", 0)
        val bound = OwnerBinding(owner.ownerId, owner.spaceId)
        val api = client ?: throw MobileApiException("credential_expired", 401)
        val current = { generation == version && navigationVersion == navigation && client === api && credentials?.deviceId == device && observedGrantRevision == grant && state.value.runs.any { run -> run.artifacts.any { it.id == artifact.id && it.runId == artifact.runId } } && state.value.owner?.let { it.ownerId == bound.ownerId && it.spaceId == bound.spaceId && it.dataEpoch == owner.dataEpoch && "artifact:read" in it.capabilities } == true }
        val raw = call { api.read(bound, listOf("artifacts", artifact.id)) }
        validateMobileSchema("Artifact", raw)
        val fresh = json.decodeFromJsonElement<Artifact>(raw)
        if (fresh.id != artifact.id || fresh.runId != artifact.runId) throw MobileApiException("protocol_incompatible", 0)
        if (!current()) throw CancellationException("Artifact binding changed")
        var staged: java.io.File? = null
        try {
            call { artifactFiles.stage { api.downloadArtifact(bound, fresh, it) }.also { staged = it } }
            if (!current()) throw CancellationException("Artifact binding changed")
            ready(PreparedArtifact(staged!!, fresh, current))
            staged = null
        } finally { staged?.let(artifactFiles::discard) }
    }
    internal fun discardArtifact(artifact: PreparedArtifact) { artifactFiles.discard(artifact.file) }

    fun observeForeground(active: Boolean) {
        foreground = active
        if (active) startEventObservation() else stopEventObservation()
    }
    private fun stopEventObservation() { observationVersion++; eventJob?.cancel(); eventJob = null }
    fun retryEventObservation() { stopEventObservation(); startEventObservation() }
    private fun startEventObservation() {
        val owner = state.value.owner ?: return
        val api = client ?: return
        if (!foreground || credentials == null || state.value.demo || eventJob?.isActive == true || eventCursor == null) return
        val b = OwnerBinding(owner.ownerId, owner.spaceId)
        val version = observationVersion
        eventJob = viewModelScope.launch {
            var failures = 0
            while (isActive && foreground && version == observationVersion) {
                try {
                    state.first { !it.busy }
                    ensureCredentials()
                    if (recoverEvents) recoverEventSnapshot(api, b, version)
                    refreshEventSearches(api, b, version)
                    val queue = Channel<StreamEvent>(32)
                    val currentToken = token
                    val subscription = api.streamEvents(b, if (eventCursor!!.lastEventId == null) eventAnchor else null, eventCursor!!.lastEventId,
                        { event -> if (queue.trySend(event).isFailure) queue.close(MobileApiException("cursor_expired", 410)) },
                        { error -> queue.close(error) },
                        { viewModelScope.launch { if (version == observationVersion && foreground) mutable.update { it.copy(syncError = null, owner = it.owner?.copy(online = true)) } } })
                    try {
                        while (isActive && version == observationVersion) {
                            val event = withTimeoutOrNull(60000) { queue.receive() }
                            state.first { !it.busy }
                            if (event == null) { ensureCredentials(); if (token != currentToken) break; continue }
                            eventCursor!!.accept(event) { applyOwnerEvent(it) }
                            failures = 0
                            refreshEventSearches(api, b, version)
                        }
                    } finally { subscription.close(); queue.cancel() }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) {
                    if (version != observationVersion) return@launch
                    val code = errorCode(e)
                    if (authenticationFailure(e)) { clearConnection(); mutable.update { it.copy(error = code).withFailure("global", code, (e as? MobileApiException)?.requestId) }; return@launch }
                    mutable.update { it.copy(syncError = code, owner = if (code == "owner_offline" || (e as? MobileApiException)?.status == 503) it.owner?.copy(online = false) else it.owner).withFailure("sync", code, (e as? MobileApiException)?.requestId) }
                    if (code == "cursor_expired") { recoverEvents = true; delay(200); continue }
                    if (code in setOf("protocol_incompatible", "payload_too_large", "scope_denied", "requires_owner_action")) return@launch
                    failures = minOf(failures + 1, 5)
                    delay(minOf(30000L, 1000L shl (failures - 1)))
                }
            }
        }
    }
    private fun applyOwnerEvent(event: JsonObject) {
        val payload = event["payload"]!!.jsonObject
        val ref = json.decodeFromJsonElement<ResourceRef>(event["resourceRef"]!!)
        fun identity(type: String, id: String) { if (ref.type != type || ref.id != id) throw MobileApiException("protocol_incompatible", 0) }
        fun permitted(scope: String) { if (scope !in (state.value.owner?.capabilities ?: emptyList())) throw MobileApiException("scope_denied", 403) }
        when (event["type"]!!.jsonPrimitive.content) {
            "conversation.updated" -> {
                permitted("conversation:read")
                val row = json.decodeFromJsonElement<Conversation>(payload); identity("conversation", row.id)
                if (row.revision != event["resourceRevision"]!!.jsonPrimitive.content) throw MobileApiException("protocol_incompatible", 0)
                mutable.update { current ->
                    val existing = current.conversations.find { it.id == row.id }
                    val selected = current.selected
                    val accepted = existing == null || row.revision.toBigInteger() >= existing.revision.toBigInteger()
                    current.copy(conversations = if (current.conversationQuery.isEmpty() && accepted) (current.conversations.filter { it.id != row.id } + if (current.conversationSelection.matches(row)) listOf(row) else emptyList()).sortedWith(compareByDescending<Conversation> { it.pinned }.thenByDescending { it.updatedAt }.thenBy { it.id }) else current.conversations,
                        selected = if (selected?.id == row.id && row.revision.toBigInteger() >= selected.revision.toBigInteger()) row.copy(lastReadMessageSeq = maxSequence(row.lastReadMessageSeq, selected.lastReadMessageSeq)) else selected)
                }
                conversationSearchDirty = conversationListRestricted()
            }
            "message.upsert" -> {
                permitted("conversation:read")
                val row = json.decodeFromJsonElement<Message>(payload); identity("conversation", row.conversationId)
                if (row.messageRevision != event["resourceRevision"]!!.jsonPrimitive.content) throw MobileApiException("protocol_incompatible", 0)
                val loaded = state.value.messages
                if (state.value.selected?.id == row.conversationId && loaded.isNotEmpty() && loaded.none { it.messageSeq == row.messageSeq } && row.messageSeq.toBigInteger() < loaded.first().messageSeq.toBigInteger()) throw MobileApiException("cursor_expired", 410)
                mutable.update { current ->
                    val remainingPending = reconcilePending(current.pendingMessages, listOf(row))
                    if (current.selected?.id != row.conversationId) current.copy(pendingMessages = remainingPending) else {
                        val old = current.messages.find { it.messageSeq == row.messageSeq || (row.id != null && it.id == row.id) }
                        if (old != null && (old.messageSeq != row.messageSeq || old.id != row.id)) throw MobileApiException("protocol_incompatible", 0)
                        if (old?.messageRevision != null && old.messageRevision!!.toBigInteger() > row.messageRevision!!.toBigInteger()) current.copy(pendingMessages = remainingPending)
                        else current.copy(messages = (current.messages.filter { it.messageSeq != row.messageSeq } + row).sortedBy { it.messageSeq.toBigInteger() }, pendingMessages = remainingPending)
                    }
                }
                conversationSearchDirty = conversationListRestricted()
            }
            "schedule.updated" -> {
                permitted("schedule:read")
                val row = json.decodeFromJsonElement<Schedule>(payload); identity("schedule", row.id)
                if (row.revision != event["resourceRevision"]!!.jsonPrimitive.content) throw MobileApiException("protocol_incompatible", 0)
                val summary = json.decodeFromJsonElement<ScheduleSummary>(payload)
                mutable.update { current ->
                    val existing = current.schedules.find { it.id == row.id }
                    val accepted = existing == null || row.revision.toBigInteger() >= existing.revision.toBigInteger()
                    current.copy(schedules = if (current.scheduleQuery.isEmpty() && accepted) (current.schedules.filter { it.id != row.id } + if (current.scheduleSelection.matches(summary)) listOf(summary) else emptyList()).sortedBy { it.name } else current.schedules,
                        viewedSchedule = if (current.viewedSchedule?.id == row.id && row.revision.toBigInteger() >= current.viewedSchedule.revision.toBigInteger()) row else current.viewedSchedule)
                }
                scheduleSearchDirty = scheduleListRestricted()
            }
            "schedule.execution.updated" -> {
                permitted("schedule:read")
                val row = json.decodeFromJsonElement<ScheduleExecution>(payload); identity("schedule", row.scheduleId)
                mutable.update { current -> if (current.viewedSchedule?.id != row.scheduleId) current else current.copy(scheduleExecutions = (current.scheduleExecutions.filter { it.id != row.id } + row).sortedWith(compareByDescending<ScheduleExecution> { it.triggeredAt }.thenBy { it.id })) }
            }
            "resource.deleted" -> {
                val kind = payload["kind"]!!.jsonPrimitive.content; val id = payload["id"]!!.jsonPrimitive.content
                permitted(if (kind in setOf("schedule", "schedule_execution")) "schedule:read" else "conversation:read")
                val parent = if (kind == "message") payload["conversationId"]!!.jsonPrimitive.content else if (kind == "schedule_execution") payload["scheduleId"]!!.jsonPrimitive.content else id
                identity(if (kind == "run") "run" else if (kind in setOf("schedule", "schedule_execution")) "schedule" else "conversation", parent)
                if (kind == "message" && state.value.selected?.id == parent) throw MobileApiException("cursor_expired", 410)
                if ((kind == "conversation" && state.value.selected?.id == id) || (kind == "schedule" && state.value.viewedSchedule?.id == id)) { resetReadObservation(); navigationVersion++ }
                mutable.update { current -> when (kind) {
                    "conversation" -> current.copy(conversations = current.conversations.filter { it.id != id }, selected = current.selected?.takeUnless { it.id == id }, messages = if (current.selected?.id == id) emptyList() else current.messages, runs = current.runs.filter { it.conversationId != id }, openingDetail = false)
                    "message" -> current.copy(messages = if (current.selected?.id == parent) current.messages.filter { it.id != id } else current.messages)
                    "schedule" -> current.copy(schedules = current.schedules.filter { it.id != id }, viewedSchedule = current.viewedSchedule?.takeUnless { it.id == id }, scheduleExecutions = if (current.viewedSchedule?.id == id) emptyList() else current.scheduleExecutions, openingDetail = false)
                    "run" -> current.copy(runs = current.runs.filter { it.runId != id })
                    else -> current.copy(scheduleExecutions = current.scheduleExecutions.filter { it.scheduleId != parent || it.id != id })
                } }
                conversationSearchDirty = conversationListRestricted(); scheduleSearchDirty = scheduleListRestricted()
            }
            "permission.changed" -> {
                val change = json.decodeFromJsonElement<PermissionChange>(payload)
                if (change.deviceId != credentials?.deviceId) throw MobileApiException("protocol_incompatible", 0)
                if (change.revoked) throw MobileApiException("revoked", 403)
                if (observedGrantRevision != null && change.grantRevision.toBigInteger() <= observedGrantRevision!!.toBigInteger()) return
                observedGrantRevision = change.grantRevision
                avatarCache.evictAll()
                val allowed = state.value.owner!!.capabilities.intersect(change.scopes.toSet()).toList()
                if ("conversation:read" !in allowed) { resetReadObservation(); navigationVersion++ }
                mutable.update { it.copy(owner = it.owner!!.copy(capabilities = allowed), composerDraft = if ("conversation:read" in allowed) it.composerDraft else "", pendingMessages = if ("conversation:read" in allowed) it.pendingMessages else emptyList(), conversations = if ("conversation:read" in allowed) it.conversations else emptyList(), selected = if ("conversation:read" in allowed) it.selected else null, messages = if ("conversation:read" in allowed) it.messages else emptyList(), runs = if ("conversation:read" in allowed) it.runs.map { run -> run.copy(allowedActions = listOf("read")) } else emptyList(), schedules = if ("schedule:read" in allowed) it.schedules else emptyList(), viewedSchedule = if ("schedule:read" in allowed) it.viewedSchedule else null, scheduleExecutions = if ("schedule:read" in allowed) it.scheduleExecutions else emptyList(), policies = emptyList(), projects = emptyList()) }
                throw MobileApiException("cursor_expired", 410)
            }
            "owner.status" -> {
                val owner = json.decodeFromJsonElement<OwnerSpace>(payload)
                identity("owner", owner.ownerId)
                if (owner.ownerId != state.value.owner?.ownerId || owner.spaceId != state.value.owner?.spaceId) throw MobileApiException("protocol_incompatible", 0)
                if (owner.dataEpoch != state.value.owner?.dataEpoch || owner.capabilities.toSet() != state.value.owner?.capabilities?.toSet()) throw MobileApiException("cursor_expired", 410)
                mutable.update { it.copy(owner = owner) }
            }
            "run.updated" -> {
                permitted("conversation:read")
                validateMobileSchema("Run", payload)
                val row = json.decodeFromJsonElement<Run>(payload); identity("run", row.runId)
                if (event["runId"]?.jsonPrimitive?.content != row.runId || event["runEventSeq"]?.jsonPrimitive?.content != row.lastRunEventSeq) throw MobileApiException("protocol_incompatible", 0)
                mutable.update { current -> current.copy(runs = mergeRun(current.runs, row)) }
                receiptsDirty = true
            }
            "artifact.created" -> throw MobileApiException("cursor_expired", 410)
            else -> throw MobileApiException("protocol_incompatible", 0)
        }
    }
    private fun maxSequence(a: String, b: String) = if (a.toBigInteger() > b.toBigInteger()) a else b
    private fun conversationListRestricted() = state.value.conversationQuery.isNotEmpty() || state.value.conversationSelection != MobileListSelection()
    private fun scheduleListRestricted() = state.value.scheduleQuery.isNotEmpty() || state.value.scheduleSelection != MobileListSelection()
    private fun mergeRun(rows: List<Run>, row: Run): List<Run> {
        val previous = rows.find { it.runId == row.runId }
        if (previous != null && (previous.conversationId != row.conversationId || previous.runtimeId != row.runtimeId)) throw MobileApiException("protocol_incompatible", 0)
        if (previous != null && previous.lastRunEventSeq.toBigInteger() >= row.lastRunEventSeq.toBigInteger()) return rows
        if (previous?.status in setOf("succeeded", "failed", "cancelled", "timed_out") && row.status != previous?.status) throw MobileApiException("protocol_incompatible", 0)
        return (rows.filter { it.runId != row.runId } + row).sortedWith(compareByDescending<Run> { it.startedAt }.thenBy { it.runId })
    }
    private fun mergeReceipts(rows: List<OperationReceipt>, current: List<OperationReceipt>): List<OperationReceipt> {
        if (rows.any { it.deviceId != credentials?.deviceId } || rows.distinctBy { it.operationId }.size != rows.size) throw MobileApiException("protocol_incompatible", 0)
        // Current Owner observations replace the same identity even when timestamps tie.
        return (rows + current.filter { old -> rows.none { it.operationId == old.operationId } }).sortedByDescending { it.updatedAt }
    }
    private fun stagePendingMessage(conversationId: String, text: String): PendingUserMessage {
        val afterMessageSeq = state.value.messages
            .filter { it.conversationId == conversationId }
            .maxOfOrNull { it.messageSeq.toBigInteger() }
            ?.toString() ?: "0"
        val pending = PendingUserMessage(UUID.randomUUID().toString(), conversationId, afterMessageSeq, text, Instant.now().toString(), "sending")
        mutable.update { it.copy(pendingMessages = it.pendingMessages + pending) }
        return pending
    }
    private fun reconcilePending(pending: List<PendingUserMessage>, authoritative: List<Message>): List<PendingUserMessage> =
        pending.filterNot { local -> authoritative.any { row ->
            row.conversationId == local.conversationId && row.kind == "user" && row.visibleToUser && row.content == local.text &&
                runCatching { row.messageSeq.toBigInteger() > local.afterMessageSeq.toBigInteger() }.getOrDefault(false)
        } }
    private fun markPendingMessage(id: String, delivery: String) {
        mutable.update { current -> current.copy(pendingMessages = current.pendingMessages.map { if (it.id == id) it.copy(delivery = delivery) else it }) }
    }
    fun restorePendingMessage(id: String) {
        val pending = state.value.pendingMessages.firstOrNull { it.id == id } ?: return
        if (pending.delivery != "failed" || state.value.selected?.id != pending.conversationId) return
        mutable.update { it.copy(composerDraft = pending.text, pendingMessages = it.pendingMessages.filterNot { row -> row.id == id }) }
    }
    private suspend fun refreshEventSearches(api: MobileControlClient, b: OwnerBinding, version: Int) {
        if (receiptsDirty && SystemClock.elapsedRealtime() - lastReceiptRefreshAt >= receiptRefreshIntervalMs) {
            val receipts = readEventPages(api, b, "operations", "OperationReceiptPage").map { json.decodeFromJsonElement<OperationReceipt>(it) }
            state.first { !it.busy }
            if (version != observationVersion) return
            mutable.update { it.copy(operations = mergeReceipts(receipts, it.operations)) }
            lastReceiptRefreshAt = SystemClock.elapsedRealtime()
            receiptsDirty = false
        }
        if (conversationSearchDirty) {
            val query = state.value.conversationQuery
            val selection = state.value.conversationSelection
            if (!conversationListRestricted()) conversationSearchDirty = false else {
                val response = json.decodeFromJsonElement<ConversationPage>(listPage(false, query, selection = selection, api = api, owner = b))
                state.first { !it.busy }
                if (version == observationVersion && state.value.conversationQuery == query && state.value.conversationSelection == selection) { applyListPage(false, json.encodeToJsonElement(response), query, selection); conversationSearchDirty = false }
            }
        }
        if (scheduleSearchDirty) {
            val query = state.value.scheduleQuery
            val selection = state.value.scheduleSelection
            if (!scheduleListRestricted()) scheduleSearchDirty = false else {
                val response = json.decodeFromJsonElement<ScheduleSummaryPage>(listPage(true, query, selection = selection, api = api, owner = b))
                state.first { !it.busy }
                if (version == observationVersion && state.value.scheduleQuery == query && state.value.scheduleSelection == selection) { applyListPage(true, json.encodeToJsonElement(response), query, selection); scheduleSearchDirty = false }
            }
        }
    }
    private suspend fun recoverEventSnapshot(api: MobileControlClient, b: OwnerBinding, version: Int) {
        val bootRaw = call { api.read(b, listOf("bootstrap")) }; validateMobileSchema("Bootstrap", bootRaw)
        val boot = json.decodeFromJsonElement<Bootstrap>(bootRaw)
        if (boot.ownerSpace.ownerId != b.ownerId || boot.ownerSpace.spaceId != b.spaceId || boot.dataEpoch != boot.ownerSpace.dataEpoch || !Regex("^mobile-control/1\\.(0|[1-9][0-9]*)$").matches(boot.protocolVersion)) throw MobileApiException("protocol_incompatible", 0)
        if (observedGrantRevision != null && boot.grantRevision.toBigInteger() < observedGrantRevision!!.toBigInteger()) throw MobileApiException("protocol_incompatible", 0)
        val capabilities = boot.capabilities.intersect(boot.ownerSpace.capabilities.toSet()).toList()
        val conversations = mutableListOf<Conversation>(); val schedules = mutableListOf<Schedule>(); val runs = mutableListOf<Run>()
        var pageCursor: String? = null; var anchor: String? = null; var revision: String? = null
        val seenCursors = mutableSetOf<String>()
        do {
            val raw = call { api.read(b, listOf("snapshots"), pageCursor?.let { mapOf("cursor" to it) } ?: emptyMap()) }; validateMobileSchema("Snapshot", raw)
            val page = json.decodeFromJsonElement<Snapshot>(raw)
            if (page.dataEpoch != boot.dataEpoch || (anchor != null && (page.snapshotCursor != anchor || page.snapshotRevision != revision))) throw MobileApiException("protocol_incompatible", 0)
            val count = page.conversations.size + page.schedules.size + page.runs.size
            if (count > 100 || (count == 0 && page.nextCursor != null)) throw MobileApiException("protocol_incompatible", 0)
            anchor = page.snapshotCursor; revision = page.snapshotRevision
            conversations.addAll(page.conversations); schedules.addAll(page.schedules); runs.addAll(page.runs)
            pageCursor = page.nextCursor
            if (pageCursor != null && !seenCursors.add(pageCursor)) throw MobileApiException("protocol_incompatible", 0)
        } while (pageCursor != null)
        if (conversations.distinctBy { it.id }.size != conversations.size || schedules.distinctBy { it.id }.size != schedules.size || runs.distinctBy { it.runId }.size != runs.size || ("conversation:read" !in capabilities && (conversations.isNotEmpty() || runs.isNotEmpty())) || ("schedule:read" !in capabilities && schedules.isNotEmpty())) throw MobileApiException("protocol_incompatible", 0)
        state.first { !it.busy }
        if (version != observationVersion) return
        val epochChanged = boot.dataEpoch != state.value.owner?.dataEpoch
        if (epochChanged) { resetReadObservation(); navigationVersion++; previewCandidate = null }
        val selectedId = state.value.selected?.id; val scheduleId = state.value.viewedSchedule?.id
        val navigation = navigationVersion
        val selected = selectedId?.let { id -> conversations.find { it.id == id } }
        val viewed = scheduleId?.let { id -> schedules.find { it.id == id } }
        if ((selectedId != null && selected == null) || (scheduleId != null && viewed == null)) { resetReadObservation(); navigationVersion++ }
        mutable.update { current ->
            val conversationSelection = if (epochChanged) MobileListSelection() else current.conversationSelection
            val scheduleSelection = if (epochChanged) MobileListSelection() else current.scheduleSelection
            current.copy(failureTraces = if (epochChanged) emptyMap() else current.failureTraces - setOf("conversation", "schedule", "run"), owner = boot.ownerSpace.copy(capabilities = capabilities), runs = runs, runError = null,
            conversationSelection = conversationSelection, scheduleSelection = scheduleSelection, projects = emptyList(),
            conversations = if ("conversation:read" !in capabilities) emptyList() else if (current.conversationQuery.isEmpty()) conversations.filter(conversationSelection::matches) else if (epochChanged) emptyList() else current.conversations,
            schedules = if ("schedule:read" !in capabilities) emptyList() else if (current.scheduleQuery.isEmpty()) schedules.map { json.decodeFromJsonElement<ScheduleSummary>(json.encodeToJsonElement(it)) }.filter(scheduleSelection::matches) else if (epochChanged) emptyList() else current.schedules,
            selected = selected, viewedSchedule = viewed, messages = if (selected == null || epochChanged) emptyList() else current.messages,
            scheduleExecutions = if (viewed == null || epochChanged) emptyList() else current.scheduleExecutions,
            selectedSchedule = if (epochChanged) null else current.selectedSchedule, preview = if (epochChanged) null else current.preview,
            hasOlderMessages = if (selected == null || epochChanged) false else current.hasOlderMessages, messageCursor = if (selected == null || epochChanged) null else current.messageCursor, messageSnapshotRevision = if (selected == null || epochChanged) null else current.messageSnapshotRevision,
            historyCursor = if (viewed == null || epochChanged) null else current.historyCursor, historySnapshotRevision = if (viewed == null || epochChanged) null else current.historySnapshotRevision,
            conversationCursor = null, scheduleCursor = null,
            conversationError = if ("conversation:read" in capabilities) null else "requires_owner_action", scheduleError = if ("schedule:read" in capabilities) null else "requires_owner_action") }
        if (selectedId != null && selected != null && navigation == navigationVersion) {
            val raw = call { api.read(b, listOf("conversations", selectedId, "messages")) }; validateMobileSchema("MessagePage", raw)
            val page = json.decodeFromJsonElement<MessagePage>(raw); validateMessagePage(selectedId, page)
            if (version == observationVersion && navigation == navigationVersion) mutable.update { it.copy(messages = page.items, hasOlderMessages = page.hasMoreBefore, messageCursor = page.snapshotCursor, messageSnapshotRevision = page.snapshotRevision, messageError = null) }
        }
        if (scheduleId != null && viewed != null && navigation == navigationVersion) {
            val raw = call { api.read(b, listOf("schedules", scheduleId, "executions")) }; validateMobileSchema("ScheduleExecutionPage", raw)
            val page = json.decodeFromJsonElement<ScheduleExecutionPage>(raw)
            if (page.items.any { it.scheduleId != scheduleId } || page.items.distinctBy { it.id }.size != page.items.size) throw MobileApiException("protocol_incompatible", 0)
            if (version == observationVersion && navigation == navigationVersion) mutable.update { it.copy(scheduleExecutions = page.items, historyCursor = page.nextCursor, historySnapshotRevision = page.snapshotRevision, historyError = null) }
        }
        val runtimes = readRuntimes(api, b)
        val projects = readSection({ code, requestId -> mutable.update { it.copy(projectError = code).withFailure("project", code, requestId) } }) { readProjects(api, b) }
        val policies = if (capabilities.any { it in setOf("conversation:create", "conversation:advance", "schedule:manage", "schedule:trigger") }) readPolicies(api, b) else emptyList()
        val receipts = readEventPages(api, b, "operations", "OperationReceiptPage").map { json.decodeFromJsonElement<OperationReceipt>(it) }
        state.first { !it.busy }
        if (version != observationVersion) return
        if (receipts.any { it.deviceId != credentials?.deviceId } || receipts.distinctBy { it.operationId }.size != receipts.size) throw MobileApiException("protocol_incompatible", 0)
        mutable.update { it.copy(operations = mergeReceipts(receipts, if (epochChanged) emptyList() else it.operations), runtimes = runtimes, projects = projects ?: emptyList(), projectError = if (projects != null) null else it.projectError, policies = policies, syncError = null) }
        conversationSearchDirty = conversationListRestricted() && "conversation:read" in capabilities
        scheduleSearchDirty = scheduleListRestricted() && "schedule:read" in capabilities
        lastReceiptRefreshAt = SystemClock.elapsedRealtime()
        eventCursor = EventCursor(boot.dataEpoch); eventAnchor = anchor; recoverEvents = false; observedGrantRevision = boot.grantRevision; receiptsDirty = false
    }
    private suspend fun readEventPages(api: MobileControlClient, b: OwnerBinding, name: String, schema: String): List<JsonElement> {
        val rows = mutableListOf<JsonElement>(); val cursors = mutableSetOf<String>(); var cursor: String? = null; var revision: String? = null
        do {
            val raw = call { api.read(b, listOf(name), cursor?.let { mapOf("cursor" to it) } ?: emptyMap()) }; validateMobileSchema(schema, raw)
            val page = raw.jsonObject; val next = page["nextCursor"]!!.jsonPrimitive.contentOrNull; val current = page["snapshotRevision"]!!.jsonPrimitive.content
            if (revision != null && current != revision) throw MobileApiException("protocol_incompatible", 0)
            revision = current; val items = page["items"]!!.jsonArray
            if (next != null && (items.isEmpty() || !cursors.add(next))) throw MobileApiException("protocol_incompatible", 0)
            rows.addAll(items); cursor = next
        } while (cursor != null)
        return rows
    }
    init {
        if (token != null && preferences.endpoint.isNotEmpty()) action {
            client = createApi(preferences.endpoint, { token })
            ensureCredentials()
            val owners = json.decodeFromJsonElement<OwnerSpacePage>(call { client!!.listOwners() }).items
            mutable.update { it.copy(owners = owners) }
            if (owners.size == 1) loadOwner(owners.single())
        }
    }
    fun language(value: String) { preferences.language = value; mutable.update { it.copy(language = value) } }
    fun appearance(value: String) { preferences.appearance = value; mutable.update { it.copy(appearance = value) } }
    fun dismissError() { mutable.update { it.copy(error = null, failureTraces = it.failureTraces - "global") } }
    private fun binding(): OwnerBinding {
        val owner = state.value.owner ?: throw MobileApiException("owner_offline", 0)
        return OwnerBinding(owner.ownerId, owner.spaceId)
    }
    private suspend fun <T> call(block: () -> T): T = withContext(Dispatchers.IO) { block() }
    private fun errorCode(e: Exception): String = (e as? MobileApiException)?.code ?: when (e) {
        is kotlinx.serialization.SerializationException -> "protocol_incompatible"
        is IllegalArgumentException -> "invalid_input"
        else -> "owner_offline"
    }
    private fun authenticationFailure(e: Exception): Boolean = errorCode(e) in setOf("revoked", "refresh_reused", "credential_expired") || (e as? MobileApiException)?.status == 401
    private suspend fun <T> readSection(onError: (String, String?) -> Unit, block: suspend () -> T): T? = try { block() }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            val code = errorCode(e)
            if (authenticationFailure(e)) throw e
            onError(code, (e as? MobileApiException)?.requestId)
            null
        }
    private suspend fun ensureCredentials() = credentialMutex.withLock {
        val api = client ?: return@withLock
        val connection = generation
        val current = credentials ?: return@withLock
        if (Instant.parse(current.accessExpiresAt).isAfter(Instant.now().plusSeconds(30))) return@withLock
        if (!Instant.parse(current.refreshExpiresAt).isAfter(Instant.now())) throw MobileApiException("credential_expired", 401)
        // Retain this key after an ambiguous timeout so a retry cannot revoke its own family.
        val rotationId = refreshRotationId ?: MobileControlClient.newMutationId().also { preferences.rotationId = it; refreshRotationId = it }
        val next = json.decodeFromJsonElement<Credentials>(call { api.refreshCredential(buildJsonObject { put("refreshCredential", current.refreshCredential); put("rotationId", rotationId) }) })
        if (generation != connection || client !== api || credentials !== current) throw CancellationException("Credential connection changed")
        preferences.saveCredentials(next); credentials = next; token = next.accessToken; refreshRotationId = null
    }
    private fun action(block: suspend () -> Unit) {
        if (state.value.busy) return
        val version = generation
        mutable.update { it.copy(busy = true, error = null, failureTraces = it.failureTraces - "global") }
        actionJob = viewModelScope.launch {
            try { ensureCredentials(); block() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (version == generation) {
                    val code = errorCode(e)
                    if (code in setOf("revoked", "refresh_reused", "credential_expired")) clearConnection()
                    mutable.update { it.copy(error = code, claim = null).withFailure("global", code, (e as? MobileApiException)?.requestId) }
                }
            }
            finally { if (version == generation) mutable.update { it.copy(busy = false) } }
        }
    }
    fun pair(endpoint: String, invitation: String, deviceLabel: String) = action {
        require(!state.value.paired) { "Forget the current connection before pairing another Owner" }
        val api = createApi(endpoint.trim(), { token }); client?.close(); client = api
        var claim = json.decodeFromJsonElement<PairingClaim>(call { api.claimPairing(buildJsonObject { put("invitation", invitation.trim()); put("deviceLabel", deviceLabel.trim()) }) })
        mutable.update { it.copy(claim = claim) }
        val proof = claim.claimProof ?: throw MobileApiException("protocol_incompatible", 0)
        val exchangeId = MobileControlClient.newMutationId()
        repeat(150) {
            if (claim.state == "approved") {
                // Only credential exchange is retried, always with the same identity.
                // Business mutations continue to reconcile receipts without replay.
                val response = try { call { api.exchangeClaim(claim.id, proof, exchangeId) } }
                    catch (e: java.io.IOException) {
                        if (e is MobileApiException) throw e
                        delay(300)
                        call { api.exchangeClaim(claim.id, proof, exchangeId) }
                    }
                val accepted = json.decodeFromJsonElement<Credentials>(response)
                preferences.saveCredentials(accepted, endpoint.trim()); credentials = accepted; token = accepted.accessToken
                mutable.update { it.copy(paired = true, demo = false, claim = null) }
                val owners = json.decodeFromJsonElement<OwnerSpacePage>(call { api.listOwners() }).items
                mutable.update { it.copy(claim = null, owners = owners) }
                if (owners.size == 1) loadOwner(owners.single())
                return@action
            }
            if (claim.state in setOf("rejected", "expired")) throw MobileApiException(if (claim.state == "rejected") "claim_rejected" else "invitation_expired", 0)
            delay(2000)
            claim = json.decodeFromJsonElement(call { api.pairingClaim(claim.id, proof) }); mutable.update { it.copy(claim = claim) }
        }
        throw MobileApiException("invitation_expired", 0)
    }
    fun selectOwner(owner: OwnerSpace) = action { loadOwner(owner) }
    fun refreshConnection() = action {
        val api = client ?: throw MobileApiException("credential_expired", 401)
        val owners = json.decodeFromJsonElement<OwnerSpacePage>(call { api.listOwners() }).items
        mutable.update { it.copy(owners = owners) }
        if (owners.size == 1) loadOwner(owners.single())
    }
    private suspend fun loadOwner(owner: OwnerSpace) {
        stopEventObservation(); resetReadObservation()
        val api = client ?: throw MobileApiException("credential_expired", 401)
        val b = OwnerBinding(owner.ownerId, owner.spaceId)
        val boot = json.decodeFromJsonElement<Bootstrap>(call { api.read(b, listOf("bootstrap")) })
        validateMobileSchema("Bootstrap", json.encodeToJsonElement(boot))
        if (!Regex("^mobile-control/1\\.(0|[1-9][0-9]*)$").matches(boot.protocolVersion)) throw MobileApiException("protocol_incompatible", 0)
        if (boot.ownerSpace.ownerId != b.ownerId || boot.ownerSpace.spaceId != b.spaceId) throw MobileApiException("protocol_incompatible", 0)
        val capabilities = boot.capabilities.intersect(boot.ownerSpace.capabilities.toSet())
        if (boot.dataEpoch != boot.ownerSpace.dataEpoch) throw MobileApiException("protocol_incompatible", 0)
        val sameSource = state.value.owner?.let { it.ownerId == b.ownerId && it.spaceId == b.spaceId && it.dataEpoch == boot.dataEpoch } == true
        if (!sameSource) {
            createdDraft = null
            avatarCache.evictAll()
            mutable.update { it.copy(composerDraft = "", pendingMessages = emptyList()) }
        }
        val conversationSelection = if (sameSource) state.value.conversationSelection else MobileListSelection()
        val scheduleSelection = if (sameSource) state.value.scheduleSelection else MobileListSelection()
        val conversationQuery = if (sameSource) state.value.conversationQuery else ""
        val scheduleQuery = if (sameSource) state.value.scheduleQuery else ""
        eventCursor = EventCursor(boot.dataEpoch); eventAnchor = boot.snapshotCursor; recoverEvents = false; conversationSearchDirty = false; scheduleSearchDirty = false; observedGrantRevision = boot.grantRevision
        previewCandidate = null; navigationVersion++
        receiptsDirty = false
        mutable.update { it.copy(failureTraces = emptyMap(), owner = boot.ownerSpace.copy(capabilities = capabilities.toList()), conversations = emptyList(), schedules = emptyList(), runtimes = emptyList(), projects = emptyList(), projectError = null, policies = emptyList(), operations = emptyList(), runs = emptyList(), runError = null, selected = null, messages = emptyList(), pendingMessages = if (sameSource) it.pendingMessages else emptyList(), hasOlderMessages = false, messageCursor = null, messageSnapshotRevision = null, messageError = null, selectedSchedule = null, preview = null, viewedSchedule = null, scheduleExecutions = emptyList(), historyCursor = null, historySnapshotRevision = null, historyError = null, openingDetail = false, demo = false, conversationCursor = null, scheduleCursor = null, conversationQuery = conversationQuery, scheduleQuery = scheduleQuery, conversationSelection = conversationSelection, scheduleSelection = scheduleSelection, conversationError = if ("conversation:read" in capabilities) null else "requires_owner_action", scheduleError = if ("schedule:read" in capabilities) null else "requires_owner_action") }
        if ("conversation:read" in capabilities) {
            readSection({ code, requestId -> mutable.update { it.copy(conversationError = code).withFailure("conversation", code, requestId) } }) {
                applyListPage(false, listPage(false, conversationQuery, selection = conversationSelection, api = api, owner = b), conversationQuery, conversationSelection)
            }
        }
        if ("schedule:read" in capabilities) {
            readSection({ code, requestId -> mutable.update { it.copy(scheduleError = code).withFailure("schedule", code, requestId) } }) {
                applyListPage(true, listPage(true, scheduleQuery, selection = scheduleSelection, api = api, owner = b), scheduleQuery, scheduleSelection)
            }
        }
        readSection({ code, requestId -> mutable.update { it.copy(error = code).withFailure("global", code, requestId) } }) {
            readRuntimes(api, b)
        }?.let { rows -> mutable.update { it.copy(runtimes = rows) } }
        readSection({ code, requestId -> mutable.update { it.copy(projectError = code).withFailure("project", code, requestId) } }) { readProjects(api, b) }
            ?.let { rows -> mutable.update { it.copy(projects = rows, projectError = null) } }
        if (capabilities.any { it in setOf("conversation:create", "conversation:advance", "schedule:manage", "schedule:trigger") }) {
            readSection({ code, requestId -> mutable.update { it.copy(error = code).withFailure("global", code, requestId) } }) {
                readPolicies(api, b)
            }?.let { rows -> mutable.update { it.copy(policies = rows) } }
        }
        lastReceiptRefreshAt = SystemClock.elapsedRealtime()
        readSection({ code, requestId -> mutable.update { it.copy(error = code).withFailure("global", code, requestId) } }) {
            json.decodeFromJsonElement<OperationReceiptPage>(call { api.read(b, listOf("operations")) }).items
        }?.let { rows -> mutable.update { it.copy(operations = rows) } }
        startEventObservation()
    }
    fun refresh() = state.value.owner?.let { owner -> action { loadOwner(owner) } }
    fun openConversation(conversation: Conversation) = action {
        mutable.update { it.copy(composerDraft = "") }
        val version = beginDetail(true)
        mutable.update { it.copy(selected = null, messages = emptyList(), hasOlderMessages = false, messageCursor = null, messageSnapshotRevision = null, messageError = null, viewedSchedule = null, scheduleExecutions = emptyList(), historyCursor = null, historySnapshotRevision = null, historyError = null) }
        try {
        if (state.value.demo) {
            val messages = listOf(
                Message("${conversation.id}-user", conversation.id, "1", kind = "user", content = "请梳理移动端的开发进展。", visibleToUser = true, createdAt = "2026-10-04T03:00:00Z"),
                Message("${conversation.id}-assistant", conversation.id, "2", kind = "assistant", content = "本页使用内存示例。已完成协议与原生基础工程，真实 Owner 服务仍在开发中。任务数据最终保存在桌面端或服务器。", visibleToUser = true, createdAt = "2026-10-04T03:01:00Z"),
            )
            if (version == navigationVersion) mutable.update { it.copy(selected = conversation, messages = messages) }; return@action
        }
        loadConversationDetail(conversation.id, version)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (version == navigationVersion || authenticationFailure(e)) throw e }
        finally { endDetail(version) }
    }
    private fun beginDetail(conversation: Boolean = false): Int {
        resetReadObservation()
        navigationVersion++
        openingConversation = conversation
        mutable.update { it.copy(openingDetail = true) }
        return navigationVersion
    }
    private fun endDetail(version: Int) {
        if (version == navigationVersion) mutable.update { it.copy(openingDetail = false) }
    }
    private suspend fun loadConversationDetail(id: String, version: Int) {
        requireListCapability(false)
        val detail = json.decodeFromJsonElement<Conversation>(call { client!!.read(binding(), listOf("conversations", id)) })
        val page = json.decodeFromJsonElement<MessagePage>(call { client!!.read(binding(), listOf("conversations", id, "messages")) })
        if (version != navigationVersion) return
        if (detail.id != id) throw MobileApiException("protocol_incompatible", 0)
        validateMessagePage(id, page)
        mutable.update { current -> current.copy(selected = detail, messages = page.items, pendingMessages = reconcilePending(current.pendingMessages, page.items), hasOlderMessages = page.hasMoreBefore, messageCursor = page.snapshotCursor, messageSnapshotRevision = page.snapshotRevision, messageError = null, runError = null) }
        loadConversationRuns(id, version)
    }
    private suspend fun loadConversationRuns(id: String, version: Int) {
        readSection({ code, requestId -> if (version == navigationVersion && state.value.selected?.id == id) mutable.update { it.copy(runError = code).withFailure("run", code, requestId) } }) {
            val rows = mutableListOf<Run>(); var cursor: String? = null; var anchor: String? = null; var revision: String? = null
            val seen = mutableSetOf<String>(); val epoch = state.value.owner?.dataEpoch
            do {
                val raw = call { client!!.read(binding(), listOf("snapshots"), mapOf("conversationId" to id) + (cursor?.let { mapOf("cursor" to it) } ?: emptyMap())) }
                validateMobileSchema("Snapshot", raw)
                val page = json.decodeFromJsonElement<Snapshot>(raw)
                val count = page.conversations.size + page.runs.size + page.schedules.size
                if (page.dataEpoch != epoch || count > 100 || (count == 0 && page.nextCursor != null) || (anchor != null && (page.snapshotCursor != anchor || page.snapshotRevision != revision)) || page.runs.any { it.conversationId != id }) throw MobileApiException("protocol_incompatible", 0)
                anchor = page.snapshotCursor; revision = page.snapshotRevision; rows.addAll(page.runs)
                cursor = page.nextCursor
                if (cursor != null && !seen.add(cursor)) throw MobileApiException("protocol_incompatible", 0)
            } while (cursor != null)
            if (rows.distinctBy { it.runId }.size != rows.size) throw MobileApiException("protocol_incompatible", 0)
            if (version != navigationVersion || state.value.selected?.id != id) return@readSection
            mutable.update { it.copy(runs = it.runs.filter { row -> row.conversationId != id } + rows, runError = null) }
        }
    }
    fun refreshRunStatus() = action {
        val id = state.value.selected?.id ?: return@action
        requireListCapability(false)
        loadConversationRuns(id, navigationVersion)
    }
    fun refreshOperations() = action {
        if (SystemClock.elapsedRealtime() - lastReceiptRefreshAt < receiptRefreshIntervalMs) return@action
        lastReceiptRefreshAt = SystemClock.elapsedRealtime()
        val rows = readEventPages(client!!, binding(), "operations", "OperationReceiptPage").map { json.decodeFromJsonElement<OperationReceipt>(it) }
        mutable.update { it.copy(operations = mergeReceipts(rows, it.operations)) }
    }
    private fun validateMessagePage(id: String, page: MessagePage) {
        val rows = page.items
        val decimal = Regex("^(0|[1-9][0-9]{0,63})$")
        if (page.snapshotCursor.isBlank() || page.snapshotCursor.length > 4096 || !decimal.matches(page.snapshotRevision) || rows.size > 100 || (page.hasMoreBefore && rows.isEmpty()) ||
            rows.any { it.conversationId != id || !decimal.matches(it.messageSeq) } ||
            rows.zipWithNext().any { (a, b) -> a.messageSeq.toBigInteger() >= b.messageSeq.toBigInteger() } ||
            rows.mapNotNull { it.id }.distinct().size != rows.mapNotNull { it.id }.size) throw MobileApiException("protocol_incompatible", 0)
    }
    fun refreshConversation() = action {
        val id = state.value.selected?.id ?: return@action
        if (state.value.demo) return@action
        val version = beginDetail(true)
        try { loadConversationDetail(id, version) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (version == navigationVersion || authenticationFailure(e)) throw e }
        finally { endDetail(version) }
    }
    fun olderMessages() = action {
        val id = state.value.selected?.id ?: return@action
        if (state.value.demo || !state.value.hasOlderMessages) return@action
        requireListCapability(false)
        val cursor = state.value.messageCursor ?: throw MobileApiException("protocol_incompatible", 0)
        val boundary = state.value.messages.firstOrNull()?.messageSeq ?: throw MobileApiException("protocol_incompatible", 0)
        val version = navigationVersion
        readSection({ code, requestId -> if (version == navigationVersion && state.value.selected?.id == id) mutable.update { it.copy(messageError = code).withFailure("message", code, requestId) } }) {
            var replace = false
            val page = try {
                json.decodeFromJsonElement<MessagePage>(call { client!!.read(binding(), listOf("conversations", id, "messages"), mapOf("cursor" to cursor, "beforeSeq" to boundary)) })
            } catch (e: MobileApiException) {
                if (e.code != "cursor_expired" || e.status != 410) throw e
                replace = true
                if (version == navigationVersion) mutable.update { it.copy(hasOlderMessages = false, messageCursor = null) }
                json.decodeFromJsonElement<MessagePage>(call { client!!.read(binding(), listOf("conversations", id, "messages")) })
            }
            if (version != navigationVersion || state.value.selected?.id != id) return@readSection
            validateMessagePage(id, page)
            val combined = if (replace) page.items else page.items + state.value.messages
            if (!replace && (page.snapshotRevision != state.value.messageSnapshotRevision || page.items.isEmpty() || page.items.last().messageSeq.toBigInteger() >= boundary.toBigInteger() || page.snapshotCursor == cursor)) throw MobileApiException("protocol_incompatible", 0)
            if (combined.mapNotNull { it.id }.distinct().size != combined.mapNotNull { it.id }.size) throw MobileApiException("protocol_incompatible", 0)
            mutable.update { it.copy(messages = combined, hasOlderMessages = page.hasMoreBefore, messageCursor = page.snapshotCursor, messageSnapshotRevision = page.snapshotRevision, messageError = null) }
        }
    }
    fun back() {
        resetReadObservation()
        navigationVersion++
        mutable.update {
            if (it.selected != null || (it.openingDetail && openingConversation)) it.copy(selected = null, messages = emptyList(), openingDetail = false, hasOlderMessages = false, messageCursor = null, messageSnapshotRevision = null, messageError = null)
            else it.copy(selected = null, messages = emptyList(), viewedSchedule = null, scheduleExecutions = emptyList(), historyCursor = null, historySnapshotRevision = null, historyError = null, openingDetail = false, hasOlderMessages = false, messageCursor = null, messageSnapshotRevision = null, messageError = null)
        }
        openingConversation = false
    }
    fun acknowledgeVisible(conversationId: String, sequences: List<String>) {
        val current = state.value
        val selected = current.selected ?: return
        if (current.demo || current.busy || selected.id != conversationId || "conversation:read" !in current.owner?.capabilities.orEmpty()) return
        val visible = current.messages.filter { it.visibleToUser && it.conversationId == conversationId }.map { it.messageSeq }.toSet()
        val decimal = Regex("^(0|[1-9][0-9]{0,63})$")
        if (sequences.isEmpty() || sequences.any { !decimal.matches(it) || it !in visible } || !decimal.matches(selected.lastReadMessageSeq)) return
        val boundary = sequences.maxBy { it.toBigInteger() }
        if (boundary.toBigInteger() <= selected.lastReadMessageSeq.toBigInteger() || attemptedRead?.let { boundary.toBigInteger() <= it.toBigInteger() } == true) return
        if (desiredRead == null || boundary.toBigInteger() > desiredRead!!.toBigInteger()) desiredRead = boundary
        if (readJob?.isActive == true) return
        val version = navigationVersion
        val connection = generation
        val ownerBinding = binding()
        val api = client ?: return
        readJob = viewModelScope.launch {
            while (version == navigationVersion && connection == generation && state.value.selected?.id == conversationId) {
                val sequence = desiredRead ?: break
                desiredRead = null; attemptedRead = sequence
                try {
                    ensureCredentials()
                    if (version != navigationVersion || connection != generation) break
                    val position = json.decodeFromJsonElement<ReadPosition>(call { api.markRead(ownerBinding, conversationId, sequence) })
                    if (version != navigationVersion || connection != generation) break
                    if (position.conversationId != conversationId || !decimal.matches(position.lastReadMessageSeq) || position.lastReadMessageSeq.toBigInteger() < sequence.toBigInteger()) throw MobileApiException("protocol_incompatible", 0)
                    mutable.update { old ->
                        fun updated(value: Conversation): Conversation = if (value.id == conversationId && position.lastReadMessageSeq.toBigInteger() > value.lastReadMessageSeq.toBigInteger()) value.copy(lastReadMessageSeq = position.lastReadMessageSeq) else value
                        old.copy(selected = old.selected?.let(::updated), conversations = old.conversations.map(::updated), readError = null)
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) {
                    if (version != navigationVersion || connection != generation) break
                    if (authenticationFailure(e)) { clearConnection(); mutable.update { it.copy(error = errorCode(e)).withFailure("global", errorCode(e), (e as? MobileApiException)?.requestId) }; break }
                    mutable.update { it.copy(readError = errorCode(e)).withFailure("read", errorCode(e), (e as? MobileApiException)?.requestId) }
                    desiredRead = null; break
                }
            }
        }
    }
    fun retryRead(conversationId: String, sequences: List<String>) {
        if (state.value.readError == null || readJob?.isActive == true) return
        attemptedRead = null
        acknowledgeVisible(conversationId, sequences)
    }
    fun stopReadObservation() { resetReadObservation() }
    fun openSchedule(schedule: ScheduleSummary) = action {
        requireListCapability(true)
        val version = beginDetail()
        try { loadScheduleDetail(schedule.id, version) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (version == navigationVersion || authenticationFailure(e)) throw e }
        finally { endDetail(version) }
    }
    fun refreshViewedSchedule() = action {
        val id = state.value.viewedSchedule?.id ?: return@action
        requireListCapability(true)
        val version = beginDetail()
        try { loadScheduleDetail(id, version) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (version == navigationVersion || authenticationFailure(e)) throw e }
        finally { endDetail(version) }
    }
    private suspend fun loadScheduleDetail(id: String, version: Int) {
        val detail = json.decodeFromJsonElement<Schedule>(call { client!!.read(binding(), listOf("schedules", id)) })
        if (version != navigationVersion) return
        if (detail.id != id) throw MobileApiException("protocol_incompatible", 0)
        mutable.update { it.copy(viewedSchedule = detail, selected = null, messages = emptyList(), scheduleExecutions = emptyList(), historyCursor = null, historySnapshotRevision = null, historyError = null, openingDetail = false) }
        loadScheduleHistory(id, null, version)
    }
    fun moreScheduleHistory() = action {
        val id = state.value.viewedSchedule?.id ?: return@action
        val cursor = state.value.historyCursor ?: return@action
        requireListCapability(true)
        loadScheduleHistory(id, cursor, navigationVersion)
    }
    private suspend fun loadScheduleHistory(id: String, cursor: String?, version: Int) {
        var replace = cursor == null
        readSection({ code, requestId -> if (version == navigationVersion && state.value.viewedSchedule?.id == id) mutable.update { it.copy(historyError = code).withFailure("history", code, requestId) } }) {
            suspend fun page(value: String?) = json.decodeFromJsonElement<ScheduleExecutionPage>(call {
                client!!.read(binding(), listOf("schedules", id, "executions"), if (value == null) emptyMap() else mapOf("cursor" to value))
            })
            val response = try { page(cursor) } catch (e: MobileApiException) {
                if (cursor == null || e.code != "cursor_expired" || e.status != 410) throw e
                replace = true
                if (version == navigationVersion) mutable.update { it.copy(historyCursor = null) }
                page(null)
            }
            if (version != navigationVersion || state.value.viewedSchedule?.id != id) return@readSection
            val combined = if (replace) response.items else state.value.scheduleExecutions + response.items
            if (response.items.any { it.scheduleId != id } || combined.map { it.id }.distinct().size != combined.size || (!replace && response.snapshotRevision != state.value.historySnapshotRevision)) throw MobileApiException("protocol_incompatible", 0)
            mutable.update { it.copy(scheduleExecutions = combined, historyCursor = response.nextCursor, historySnapshotRevision = response.snapshotRevision, historyError = null) }
        }
    }
    fun openExecutionConversation(execution: ScheduleExecution) = action {
        val schedule = state.value.viewedSchedule ?: throw MobileApiException("resource_not_found", 404)
        val original = state.value.scheduleExecutions.find { it.id == execution.id && it.scheduleId == schedule.id } ?: throw MobileApiException("resource_not_found", 404)
        val id = original.conversationId ?: throw MobileApiException("requires_owner_action", 409)
        requireListCapability(false)
        val version = beginDetail(true)
        try { loadConversationDetail(id, version) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (version == navigationVersion || authenticationFailure(e)) throw e }
        finally { endDetail(version) }
    }
    fun search(query: String, schedules: Boolean) = action {
        require(query.codePointCount(0, query.length) <= 200)
        val effectiveQuery = if (query.isBlank()) "" else query
        val selection = if (schedules) state.value.scheduleSelection else state.value.conversationSelection
        if (state.value.demo) {
            applySampleList(schedules, effectiveQuery, selection)
            return@action
        }
        requireListCapability(schedules)
        val response = listPage(schedules, effectiveQuery, selection = selection)
        applyListPage(schedules, response, effectiveQuery, selection)
    }
    fun selectListFilters(selection: MobileListSelection, schedules: Boolean, onApplied: () -> Unit = {}) = action {
        require(selection.state in if (schedules) setOf("all", "enabled", "paused", "running", "blocked") else setOf("all", "active", "attention", "idle"))
        require(!schedules || !selection.archived)
        selection.projectId?.let { checkId(it); if (state.value.projects.none { project -> project.id == it }) throw MobileApiException("requires_owner_action", 409) }
        val query = if (schedules) state.value.scheduleQuery else state.value.conversationQuery
        if (state.value.demo) applySampleList(schedules, query, selection)
        else { requireListCapability(schedules); applyListPage(schedules, listPage(schedules, query, selection = selection), query, selection) }
        onApplied()
    }
    private fun applySampleList(schedules: Boolean, query: String, selection: MobileListSelection) {
        mutable.update { if (schedules) it.copy(schedules = sampleSchedules.filter { row -> selection.matches(row) && row.name.contains(query.trim(), true) }, scheduleQuery = query, scheduleSelection = selection)
            else it.copy(conversations = sampleConversations.filter { row -> selection.matches(row) && row.title.contains(query.trim(), true) }, conversationQuery = query, conversationSelection = selection) }
    }
    private fun applyListPage(schedules: Boolean, response: JsonElement, query: String, selection: MobileListSelection, append: Boolean = false) {
        if (schedules) {
            val page = json.decodeFromJsonElement<ScheduleSummaryPage>(response)
            if (page.items.any { !selection.matches(it) } || page.items.distinctBy { it.id }.size != page.items.size) throw MobileApiException("protocol_incompatible", 0)
            mutable.update { it.copy(schedules = (if (append) it.schedules + page.items else page.items).distinctBy { row -> row.id }, scheduleCursor = page.nextCursor, scheduleError = null, scheduleQuery = query, scheduleSelection = selection) }
        } else {
            val page = json.decodeFromJsonElement<ConversationPage>(response)
            if (page.items.any { !selection.matches(it) } || page.items.distinctBy { it.id }.size != page.items.size) throw MobileApiException("protocol_incompatible", 0)
            mutable.update { it.copy(conversations = (if (append) it.conversations + page.items else page.items).distinctBy { row -> row.id }, conversationCursor = page.nextCursor, conversationError = null, conversationQuery = query, conversationSelection = selection) }
        }
    }
    private suspend fun readProjects(api: MobileControlClient, owner: OwnerBinding): List<Project> {
        val rows = readEventPages(api, owner, "projects", "ProjectPage").map { json.decodeFromJsonElement<Project>(it) }
        if (rows.distinctBy { it.id }.size != rows.size) throw MobileApiException("protocol_incompatible", 0)
        return rows
    }
    private suspend fun readRuntimes(api: MobileControlClient, owner: OwnerBinding): List<Runtime> {
        val rows = readEventPages(api, owner, "runtimes", "RuntimePage").map { json.decodeFromJsonElement<Runtime>(it) }
        if (rows.distinctBy { it.id }.size != rows.size) throw MobileApiException("protocol_incompatible", 0)
        return rows
    }
    private suspend fun readPolicies(api: MobileControlClient, owner: OwnerBinding): List<ExecutionPolicy> {
        val rows = readEventPages(api, owner, "execution-policies", "ExecutionPolicyPage").map { json.decodeFromJsonElement<ExecutionPolicy>(it) }
        if (rows.distinctBy { it.id }.size != rows.size) throw MobileApiException("protocol_incompatible", 0)
        return rows
    }
    fun refreshProjects() = action {
        if (state.value.demo) return@action
        readSection({ code, requestId -> mutable.update { it.copy(projectError = code).withFailure("project", code, requestId) } }) {
            readProjects(client ?: throw MobileApiException("credential_expired", 401), binding())
        }?.let { rows -> mutable.update { it.copy(projects = rows, projectError = null) } }
    }
    private fun requireListCapability(schedules: Boolean) {
        val scope = if (schedules) "schedule:read" else "conversation:read"
        if (scope !in (state.value.owner?.capabilities ?: emptyList())) throw MobileApiException("scope_denied", 403)
    }
    private suspend fun listPage(schedules: Boolean, query: String, cursor: String? = null, selection: MobileListSelection = if (schedules) state.value.scheduleSelection else state.value.conversationSelection, api: MobileControlClient = client!!, owner: OwnerBinding = binding()): JsonElement {
        val name = if (schedules) "schedules" else "conversations"
        val arguments = JsonObject(selection.arguments(schedules) + (cursor?.let { mapOf("cursor" to JsonPrimitive(it)) } ?: emptyMap()))
        return if (query.isEmpty()) call { api.read(owner, listOf(name), arguments.mapValues { it.value.jsonPrimitive.content }) }
        else call { api.search(owner, listOf(name, "search"), JsonObject(arguments + ("query" to JsonPrimitive(query)))) }
    }
    fun more(schedules: Boolean) = action {
        requireListCapability(schedules)
        val cursor = if (schedules) state.value.scheduleCursor else state.value.conversationCursor
        if (cursor == null) return@action
        val query = if (schedules) state.value.scheduleQuery else state.value.conversationQuery
        val selection = if (schedules) state.value.scheduleSelection else state.value.conversationSelection
        var replace = false
        val response = try { listPage(schedules, query, cursor, selection) } catch (e: MobileApiException) {
            if (e.code != "cursor_expired" || e.status != 410) throw e
            replace = true
            if (schedules) mutable.update { it.copy(scheduleCursor = null) } else mutable.update { it.copy(conversationCursor = null) }
            listPage(schedules, query, selection = selection)
        }
        applyListPage(schedules, response, query, selection, append = !replace)
    }
    fun editSchedule(schedule: ScheduleSummary, onLoaded: () -> Unit = {}) = action {
        val detail = json.decodeFromJsonElement<Schedule>(call { client!!.read(binding(), listOf("schedules", schedule.id)) })
        previewCandidate = null
        mutable.update { it.copy(selectedSchedule = detail, preview = null) }; onLoaded()
    }
    fun matchesPreview(candidate: JsonObject): Boolean = state.value.preview != null && candidate == previewCandidate
    fun clearSchedule() { previewCandidate = null; mutable.update { it.copy(selectedSchedule = null, preview = null) } }
    fun previewSchedule(candidate: JsonObject) = action {
        val preview = json.decodeFromJsonElement<SchedulePreview>(call { client!!.search(binding(), listOf("schedules", "preview"), candidate) })
        previewCandidate = candidate
        mutable.update { it.copy(preview = preview) }
    }
    fun saveSchedule(candidate: JsonObject, onSubmitted: () -> Unit) = action {
        val preview = state.value.preview ?: throw MobileApiException("preview_expired", 422)
        if (candidate != previewCandidate) throw MobileApiException("preview_expired", 422)
        val selected = state.value.selectedSchedule
        val body = JsonObject(candidate + ("previewRevision" to JsonPrimitive(preview.previewRevision)))
        submit(listOf("schedules") + if (selected == null) emptyList() else listOf(selected.id), body, selected?.revision, if (selected == null) "POST" else "PATCH", if (selected == null) "createSchedule" else "patchSchedule")
        clearSchedule()
        withContext(Dispatchers.Main) { onSubmitted() }
    }
    fun createConversation(title: String, policy: ExecutionPolicy, onSubmitted: () -> Unit = {}) = createConversation(title, "", policy, onSubmitted)
    fun createConversation(title: String, prompt: String, policy: ExecutionPolicy, onSubmitted: () -> Unit = {}) = action {
        if (prompt.isNotBlank()) {
            try { validateMobileSchema("CreateTurnInput", buildJsonObject { put("text", prompt); put("executionPolicyId", policy.id) }) } catch (_: MobileApiException) { throw MobileApiException("invalid_input", 422) }
        }
        val submittedTitle = title.trim().ifBlank { prompt.trim().lineSequence().firstOrNull().orEmpty().take(80).trimEnd { Character.isHighSurrogate(it) } }
        val body = buildJsonObject { put("title", submittedTitle); put("runtimeId", policy.runtimeId); put("executionPolicyId", policy.id); policy.projectId?.let { put("projectId", it) } }
        val draftKey = listOf(binding().ownerId, binding().spaceId, state.value.owner?.dataEpoch, body.toString(), prompt).joinToString("\u0000")
        if (createdDraft != null && createdDraft!!.first != draftKey) throw MobileApiException("original_submission_resolved", 409)
        val receipt = if (createdDraft == null) submit(listOf("conversations"), body, expectedAction = "createConversation") else null
        if (prompt.isNotBlank()) {
            if (receipt != null && (receipt.status != "applied" || receipt.resourceRef?.type != "conversation")) throw MobileApiException("reconciliation_required", 409)
            val id = createdDraft?.second ?: receipt?.resourceRef?.id ?: throw MobileApiException("protocol_incompatible", 0)
            createdDraft = draftKey to id
            val version = beginDetail(true)
            // Close the create form once the original conversation exists. A failed
            // first Turn remains visible as a draft in that conversation, not a
            // second create attempt that could duplicate the task.
            try {
                loadConversationDetail(id, version)
                val detail = state.value.selected ?: throw MobileApiException("reconciliation_required", 409)
                val pending = stagePendingMessage(id, prompt)
                mutable.update { it.copy(composerDraft = "") }
                onSubmitted()
                createdDraft = null
                try {
                    submit(listOf("conversations", id, "turns"), buildJsonObject { put("text", prompt); put("executionPolicyId", policy.id); policy.projectId?.let { put("projectId", it) } }, detail.revision, expectedAction = "createTurn")
                    markPendingMessage(pending.id, "accepted")
                } catch (e: Exception) {
                    markPendingMessage(pending.id, if (errorCode(e) == "reconciliation_required") "uncertain" else "failed")
                    throw e
                }
                loadConversationDetail(id, version)
            } finally { endDetail(version) }
            return@action
        }
        onSubmitted()
    }
    fun composerDraft(text: String) { mutable.update { it.copy(composerDraft = text) } }
    fun advance(text: String, policy: ExecutionPolicy, onSubmitted: () -> Unit = {}) {
        val current = state.value
        val selected = current.selected ?: return
        if (current.busy || text.isBlank() || selected.activeRunIds.isNotEmpty()) return
        val pending = stagePendingMessage(selected.id, text)
        mutable.update { it.copy(composerDraft = "") }
        onSubmitted()
        action {
            try {
                val body = buildJsonObject { put("text", text); put("executionPolicyId", policy.id); policy.projectId?.let { put("projectId", it) } }
                submit(listOf("conversations", selected.id, "turns"), body, selected.revision, expectedAction = "createTurn")
                markPendingMessage(pending.id, "accepted")
            } catch (e: Exception) {
                markPendingMessage(pending.id, if (errorCode(e) == "reconciliation_required") "uncertain" else "failed")
                throw e
            }
        }
    }
    fun manageConversation(conversation: Conversation, field: String, value: Boolean) = action {
        require(field in setOf("pinned", "archived"))
        requireConversationManagement(conversation)
        submit(listOf("conversations", conversation.id), buildJsonObject { put(field, value) }, conversation.revision, "PATCH", "patchConversation")
    }
    private fun requireConversationManagement(conversation: Conversation) {
        val selected = state.value.selected
        if (selected?.id != conversation.id || "manage" !in selected.allowedActions || "conversation:manage" !in state.value.owner?.capabilities.orEmpty()) throw MobileApiException("scope_denied", 403)
    }
    fun renameConversation(conversation: Conversation, title: String, onSubmitted: () -> Unit = {}) = action {
        requireConversationManagement(conversation)
        val value = title.trim()
        if (value.isBlank() || value.codePointCount(0, value.length) !in 1..160) throw MobileApiException("invalid_input", 422)
        val navigation = navigationVersion
        submit(listOf("conversations", conversation.id), buildJsonObject { put("title", value) }, conversation.revision, "PATCH", "patchConversation")
        if (navigation == navigationVersion && state.value.selected?.id == conversation.id) onSubmitted()
    }
    fun changeConversationProject(conversation: Conversation, projectId: String?, onSubmitted: () -> Unit = {}) = action {
        requireConversationManagement(conversation)
        val current = state.value.selected!!
        if (current.sourceKind != "runtime_conversation") throw MobileApiException("requires_owner_action", 403)
        if (current.activeRunIds.isNotEmpty()) throw MobileApiException("run_active", 409)
        if (projectId == conversation.projectId) throw MobileApiException("invalid_input", 422)
        projectId?.let { id ->
            try { checkId(id) } catch (_: IllegalArgumentException) { throw MobileApiException("invalid_input", 422) }
            if (state.value.projects.none { it.id == id }) throw MobileApiException("resource_not_found", 404)
        }
        val navigation = navigationVersion
        submit(listOf("conversations", conversation.id), buildJsonObject { put("projectId", projectId?.let(::JsonPrimitive) ?: JsonNull) }, conversation.revision, "PATCH", "patchConversation")
        if (navigation == navigationVersion && state.value.selected?.id == conversation.id) onSubmitted()
    }
    fun cancelRun(runId: String) = action {
        if (state.value.owner?.capabilities?.none { it in setOf("conversation:advance", "schedule:cancel") } != false) throw MobileApiException("scope_denied", 403)
        if (state.value.runs.none { it.runId == runId && "cancel" in it.allowedActions } && state.value.viewedSchedule?.let { runId in it.activeRunIds && "cancel" in it.allowedActions } != true) throw MobileApiException("requires_owner_action", 403)
        submit(listOf("runs", runId, "cancel"), JsonObject(emptyMap()), expectedAction = "cancelRun")
    }
    fun scheduleAction(schedule: ScheduleSummary, actionName: String) = action {
        require(actionName in setOf("pause", "resume", "trigger", "discard-pending", "delete"))
        submit(listOf("schedules", schedule.id) + if (actionName == "delete") emptyList() else listOf(actionName), if (actionName == "delete") null else JsonObject(emptyMap()), schedule.revision, if (actionName == "delete") "DELETE" else "POST", "${actionName.replace('-', '_')}Schedule")
    }
    private suspend fun submit(suffix: List<String>, body: JsonObject?, revision: String? = null, method: String = "POST", expectedAction: String): OperationReceipt {
        if (state.value.demo) throw MobileApiException("requires_owner_action", 0)
        if (revision != null && !Regex("^(0|[1-9][0-9]{0,63})$").matches(revision)) throw MobileApiException("invalid_input", 422)
        try { suffix.forEach(::checkId) } catch (_: IllegalArgumentException) { throw MobileApiException("invalid_input", 422) }
        val serialized = body?.toString()
        if ((serialized?.toByteArray(Charsets.UTF_8)?.size ?: 0).toLong() > minOf(262144L, state.value.owner?.limits?.maxRequestBytes ?: 262144L)) throw MobileApiException("payload_too_large", 422)
        if (body != null) {
            val schema = if (expectedAction in setOf("createConversation", "patchConversation", "createTurn", "createSchedule", "patchSchedule")) expectedAction.replaceFirstChar { it.uppercase() } + "Input" else "ActionInput"
            try { validateMobileSchema(schema, body) } catch (_: MobileApiException) { throw MobileApiException("invalid_input", 422) }
        }
        val owner = binding(); val device = credentials?.deviceId ?: throw MobileApiException("credential_expired", 401)
        val epoch = state.value.owner!!.dataEpoch
        val slot = JsonArray(listOf(owner.ownerId, owner.spaceId, device, method, expectedAction).map(::JsonPrimitive) + suffix.map(::JsonPrimitive)).toString()
        val previous = pendingMutations[slot]
        if (previous != null && previous.epoch != epoch) throw MobileApiException("reconciliation_required", 409)
        if (previous == null && pendingMutations.size >= 32) throw MobileApiException("reconciliation_required", 409)
        val pending = previous ?: PendingMutation(MobileControlClient.newMutationId(), owner, device, epoch, suffix.toList(), serialized?.let { json.parseToJsonElement(it).jsonObject }, revision, method, expectedAction).also { pendingMutations[slot] = it }
        val mutationId = pending.key
        val receipt = if (previous != null) lookupMutation(pending) else try {
            val raw = call { client!!.write(owner, suffix, pending.body, mutationId, revision, method) }
            validateMobileSchema("OperationReceipt", raw)
            json.decodeFromJsonElement<OperationReceipt>(raw)
        }
        catch (e: java.io.IOException) {
            if (e is MobileApiException) {
                if (e.code in setOf("revision_conflict", "invalid_input", "revision_required", "scope_denied", "resource_not_found", "run_active", "project_binding_conflict", "unverified_policy", "policy_revoked")) pendingMutations.remove(slot)
                throw e
            }
            // A timeout never changes the key or replays the mutation.
            lookupMutation(pending)
        }
        if (receipt.clientMutationId != mutationId || receipt.deviceId != credentials?.deviceId || receipt.action != expectedAction) throw MobileApiException("protocol_incompatible", 0)
        if (expectedAction == "patchConversation" && (receipt.resourceRef?.type != "conversation" || receipt.resourceRef?.id != suffix[1])) throw MobileApiException("protocol_incompatible", 0)
        if (expectedAction == "cancelRun" && (receipt.resourceRef?.type != "run" || receipt.resourceRef?.id != suffix[1])) throw MobileApiException("protocol_incompatible", 0)
        mutable.update { it.copy(operations = listOf(receipt) + it.operations.filter { old -> old.operationId != receipt.operationId }) }
        if (receipt.status in setOf("accepted", "applying", "applied", "rejected")) pendingMutations.remove(slot)
        if (receipt.status == "rejected") throw MobileApiException(receipt.error?.code ?: "requires_owner_action", 422, receipt.error?.requestId)
        if (receipt.status == "reconciliation_required") throw MobileApiException("reconciliation_required", 409)
        if (previous != null && (pending.body != body || pending.revision != revision)) throw MobileApiException("original_submission_resolved", 409)
        return receipt
    }
    private suspend fun lookupMutation(pending: PendingMutation): OperationReceipt {
        val page = try {
            val raw = call { client!!.read(pending.binding, listOf("operations"), mapOf("clientMutationId" to pending.key)) }
            validateMobileSchema("OperationReceiptPage", raw)
            json.decodeFromJsonElement<OperationReceiptPage>(raw)
        } catch (failure: java.io.IOException) {
            if (failure is MobileApiException && (authenticationFailure(failure) || failure.code == "protocol_incompatible")) throw failure
            throw MobileApiException("reconciliation_required", 0)
        }
        if (page.items.size > 1 || page.items.any { it.clientMutationId != pending.key }) throw MobileApiException("protocol_incompatible", 0)
        return page.items.singleOrNull() ?: throw MobileApiException("reconciliation_required", 0)
    }
    private fun clearConnection() {
        createdDraft = null
        pendingMutations.clear()
        stopEventObservation(); eventCursor = null; eventAnchor = null; recoverEvents = false; conversationSearchDirty = false; scheduleSearchDirty = false; observedGrantRevision = null
        receiptsDirty = false; lastReceiptRefreshAt = 0L; avatarCache.evictAll()
        resetReadObservation()
        navigationVersion++
        token = null; credentials = null; refreshRotationId = null; client?.close(); client = null; preferences.forgetCredentials()
        artifactFiles.clear()
        previewCandidate = null; sampleConversations = emptyList(); sampleSchedules = emptyList()
        mutable.value = MobileState(language = preferences.language, appearance = preferences.appearance)
    }
    fun forget() { generation++; actionJob?.cancel(); clearConnection() }
    fun cancelPairing() = forget()
    fun revoke() = action { call { client!!.revokeDevice() }; clearConnection() }
    override fun onCleared() { stopEventObservation(); client?.close(); avatarCache.evictAll(); artifactFiles.clear(); super.onCleared() }
    fun demo() {
        if (!BuildConfig.DEBUG || state.value.busy || state.value.paired) return
        val now = "2026-10-04T03:00:00Z"
        val conversations = listOf("移动端实施契约", "本周项目进度", "运行状态复核").mapIndexed { index, title -> Conversation("demo-$index", "runtime_conversation", title, "demo-runtime", pinned = index == 0, archived = false, revision = "1", lastMessageSeq = "0", lastReadMessageSeq = "0", activity = "idle", activeRunIds = emptyList(), createdAt = now, updatedAt = now, allowedActions = listOf("read")) }
        val schedules = listOf("每日工作摘要", "每周项目回顾", "远程运行巡检").mapIndexed { index, name ->
            ScheduleSummary("demo-schedule-$index", name, "demo-runtime", scheduleExpression = if (index == 1) "0 17 * * 5" else "0 9 * * 1-5", schedulerTimeZone = "Asia/Shanghai", enabled = index != 1, effectiveState = listOf("enabled", "paused", "blocked")[index], concurrencyPolicy = "skip", timeoutMs = 300_000, activeRunIds = emptyList(), pendingCount = 0, revision = "1", allowedActions = listOf("read"))
        }
        val runtimes = listOf(Runtime("demo-runtime", "Agents One", "local", healthy = false, capabilities = emptyList(), allowedActions = listOf("read")))
        sampleConversations = conversations; sampleSchedules = schedules
        mutable.update { MobileState(language = it.language, appearance = it.appearance, demo = true, conversations = conversations, schedules = schedules, runtimes = runtimes) }
    }
}
