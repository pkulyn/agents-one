package one.agents.mobile.net

import java.io.IOException
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.time.Instant
import kotlinx.serialization.json.encodeToJsonElement
import one.agents.mobile.contract.Artifact
import one.agents.mobile.contract.validateMobileSchema
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import one.agents.mobile.contract.ErrorEnvelope
import java.util.concurrent.atomic.AtomicBoolean
import java.nio.charset.CodingErrorAction
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response

class MobileApiException(val code: String, val status: Int, val requestId: String? = null) : IOException(code)

data class OwnerBinding(val ownerId: String, val spaceId: String) {
    init { checkId(ownerId); checkId(spaceId) }
}
fun interface MobileEventSubscription : AutoCloseable { override fun close() }

fun checkId(value: String): String {
    require(Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$").matches(value) && !value.contains(".."))
    return value
}

/** No disk cache, cookie jar, redirects, automatic retries or content logging. */
open class MobileControlClient(
    endpoint: String,
    private val accessToken: () -> String?,
    private val allowLoopbackHttpForTests: Boolean = false,
) {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val base: HttpUrl = endpoint.toHttpUrl().also {
        require(it.username.isEmpty() && it.password.isEmpty() && it.query == null && it.fragment == null && it.encodedPath == "/")
        require(it.isHttps || (allowLoopbackHttpForTests && it.scheme == "http" && it.host in setOf("127.0.0.1", "localhost", "::1")))
    }
    private val http = OkHttpClient.Builder()
        .cache(null).retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    private val eventHttp by lazy { http.newBuilder().readTimeout(60, TimeUnit.SECONDS).build() }

    open fun read(binding: OwnerBinding, suffix: List<String>, query: Map<String, String> = emptyMap()): JsonElement =
        request("GET", scoped(binding, suffix), query = query)

    open fun runtimeAvatar(binding: OwnerBinding, runtimeId: String, avatarId: String): RuntimeAvatarBytes =
        verifyRuntimeAvatar(request("GET", scoped(binding, listOf("runtimes", checkId(runtimeId), "avatars", checkId(avatarId))), maxResponseBytes = 1024 * 1024), runtimeId, avatarId)

    /** Writes only to caller-owned staging output. Publish it only after this method succeeds. */
    open fun downloadArtifact(binding: OwnerBinding, artifact: Artifact, staging: OutputStream) {
        validateMobileSchema("Artifact", json.encodeToJsonElement(artifact))
        if ("download" !in artifact.allowedActions) throw MobileApiException("scope_denied", 403)
        artifact.expiresAt?.let { if (!Instant.parse(it).isAfter(Instant.now())) throw MobileApiException("resource_not_found", 404) }
        val url = base.newBuilder().addPathSegments("agents-one/mobile/v1")
        scoped(binding, listOf("artifacts", artifact.id, "content")).forEach { url.addPathSegment(it) }
        val request = Request.Builder().url(url.build()).get()
            .header("Authorization", "Bearer ${accessToken() ?: throw MobileApiException("credential_expired", 401)}")
            .header("Accept", artifact.mime).header("Accept-Encoding", "identity").header("Cache-Control", "no-store").build()
        http.newCall(request).execute().use { response ->
            if (response.code != 200) throw MobileApiException(when (response.code) { 401 -> "credential_expired"; 403 -> "scope_denied"; 404 -> "resource_not_found"; else -> "request_failed" }, response.code)
            val body = response.body ?: throw MobileApiException("protocol_incompatible", response.code)
            if (response.header("Content-Type")?.substringBefore(';')?.trim()?.equals(artifact.mime, ignoreCase = true) != true ||
                response.header("Content-Length") != artifact.sizeBytes.toString() ||
                response.header("Content-Encoding")?.let { !it.equals("identity", ignoreCase = true) } == true)
                throw MobileApiException("protocol_incompatible", response.code)
            val digest = MessageDigest.getInstance("SHA-256")
            var count = 0L
            val buffer = ByteArray(65536)
            body.byteStream().use { stream ->
                while (true) {
                    val size = stream.read(buffer)
                    if (size < 0) break
                    if (size.toLong() > artifact.sizeBytes - count) throw MobileApiException("protocol_incompatible", response.code)
                    digest.update(buffer, 0, size)
                    staging.write(buffer, 0, size)
                    count += size
                }
            }
            val actualHash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
            if (count != artifact.sizeBytes || actualHash != artifact.sha256.lowercase()) throw MobileApiException("protocol_incompatible", response.code)
            staging.flush()
        }
    }

    open fun streamEvents(binding: OwnerBinding, cursor: String? = null, lastEventId: String? = null,
        consume: (StreamEvent) -> Unit, failed: (MobileApiException) -> Unit, opened: () -> Unit = {}): MobileEventSubscription {
        require(cursor == null || (cursor.isNotBlank() && cursor.length <= 4096))
        lastEventId?.let(::checkId)
        val url = base.newBuilder().addPathSegments("agents-one/mobile/v1")
        scoped(binding, listOf("events")).forEach { url.addPathSegment(it) }
        cursor?.let { url.addQueryParameter("cursor", it) }
        val builder = Request.Builder().url(url.build()).header("Accept", "text/event-stream").header("Cache-Control", "no-store")
            .header("Authorization", "Bearer ${accessToken() ?: throw MobileApiException("credential_expired", 401)}")
        lastEventId?.let { builder.header("Last-Event-ID", it) }
        val closed = AtomicBoolean(false)
        val callbackGate = Any()
        val call = eventHttp.newCall(builder.build())
        fun failure(error: MobileApiException) { synchronized(callbackGate) { if (closed.compareAndSet(false, true)) failed(error) } }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { failure(MobileApiException("owner_offline", 0)) }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        if (closed.get()) return
                        if (!response.isSuccessful) {
                            val stream = response.body?.byteStream() ?: throw MobileApiException("protocol_incompatible", response.code)
                            val output = ByteArrayOutputStream(); val buffer = ByteArray(4096)
                            while (output.size() <= 65536) {
                                val count = stream.read(buffer, 0, minOf(buffer.size, 65537 - output.size()))
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                            val bytes = output.toByteArray()
                            if (bytes.size > 65536) throw MobileApiException("payload_too_large", response.code)
                            val error = runCatching { json.decodeFromString<ErrorEnvelope>(bytes.toString(Charsets.UTF_8)).error }.getOrNull()
                            throw MobileApiException(error?.code ?: when (response.code) { 401 -> "credential_expired"; 403 -> "scope_denied"; 410 -> "cursor_expired"; else -> "request_failed" }, response.code, error?.requestId)
                        }
                        if (response.header("Content-Type")?.substringBefore(';')?.trim() != "text/event-stream") throw MobileApiException("protocol_incompatible", response.code)
                        val input = response.body?.byteStream() ?: throw MobileApiException("protocol_incompatible", response.code)
                        synchronized(callbackGate) { if (!closed.get()) opened() }
                        val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                        java.io.InputStreamReader(input, decoder).buffered().use { reader -> readSse(reader) { synchronized(callbackGate) { if (!closed.get()) consume(it) } } }
                        failure(MobileApiException("owner_offline", 0))
                    } catch (e: Exception) {
                        call.cancel()
                        failure(e as? MobileApiException ?: MobileApiException(if (e is IOException && e !is java.nio.charset.CharacterCodingException) "owner_offline" else "protocol_incompatible", 0))
                    }
                }
            }
        })
        return MobileEventSubscription { synchronized(callbackGate) { closed.set(true) }; call.cancel() }
    }

    open fun markRead(binding: OwnerBinding, conversationId: String, sequence: String): JsonElement {
        require(Regex("^(0|[1-9][0-9]{0,63})$").matches(sequence))
        return request("POST", scoped(binding, listOf("conversations", checkId(conversationId), "read")),
            kotlinx.serialization.json.buildJsonObject { put("lastReadMessageSeq", kotlinx.serialization.json.JsonPrimitive(sequence)) })
    }

    open fun search(binding: OwnerBinding, suffix: List<String>, body: JsonObject): JsonElement {
        require(suffix == listOf("conversations", "search") || suffix == listOf("schedules", "search") || suffix == listOf("schedules", "preview"))
        return request("POST", scoped(binding, suffix), body)
    }

    open fun write(binding: OwnerBinding, suffix: List<String>, body: JsonObject?, mutationId: String, revision: String? = null, method: String = "POST"): JsonElement {
        checkId(mutationId)
        require(method in setOf("POST", "PATCH", "DELETE"))
        require(revision == null || Regex("^(0|[1-9][0-9]{0,63})$").matches(revision))
        val inBody = body?.get("clientMutationId")?.jsonPrimitive?.content
        require(inBody == null || inBody == mutationId)
        return request(method, scoped(binding, suffix), body, headers = buildMap {
            put("X-Client-Mutation-Id", mutationId); put("Idempotency-Key", mutationId)
            revision?.let { put("If-Match", "\"$it\"") }
        })
    }

    open fun claimPairing(body: JsonObject): JsonElement = request("POST", listOf("pairing", "claims"), body, authenticated = false)
    open fun pairingClaim(id: String, proof: String): JsonElement = request("GET", listOf("pairing", "claims", checkId(id)), headers = mapOf("Authorization" to "Bearer $proof"), authenticated = false)
    open fun exchangeClaim(id: String, proof: String, mutationId: String): JsonElement = request("POST", listOf("pairing", "claims", checkId(id), "exchange"), JsonObject(emptyMap()), headers = mapOf("Authorization" to "Bearer $proof", "X-Client-Mutation-Id" to checkId(mutationId), "Idempotency-Key" to mutationId), authenticated = false)
    open fun refreshCredential(body: JsonObject): JsonElement = request("POST", listOf("auth", "refresh"), body, authenticated = false)
    open fun listOwners(): JsonElement = request("GET", listOf("owners"))
    open fun revokeDevice() { request("DELETE", listOf("devices", "self")) }
    open fun close() { http.dispatcher.cancelAll(); http.connectionPool.evictAll() }

    private fun scoped(binding: OwnerBinding, suffix: List<String>): List<String> =
        listOf("owners", binding.ownerId, "spaces", binding.spaceId) + suffix.map(::checkId)

    private fun request(method: String, path: List<String>, body: JsonObject? = null, query: Map<String, String> = emptyMap(), headers: Map<String, String> = emptyMap(), authenticated: Boolean = true, maxResponseBytes: Int = 16 * 1024 * 1024): JsonElement {
        val url = base.newBuilder().addPathSegments("agents-one/mobile/v1")
        path.forEach { url.addPathSegment(it) }
        query.forEach { (key, value) -> url.addQueryParameter(key, value) }
        val bytes = body?.toString()?.toByteArray(Charsets.UTF_8)
        require((bytes?.size ?: 0) <= 262_144)
        val builder = Request.Builder().url(url.build()).header("Accept", "application/json").header("Cache-Control", "no-store")
        if (authenticated) builder.header("Authorization", "Bearer ${accessToken() ?: throw MobileApiException("credential_expired", 401)}")
        headers.forEach { (key, value) -> builder.header(key, value) }
        val requestBody = if (method in setOf("POST", "PATCH")) (bytes ?: "{}".toByteArray()).toRequestBody("application/json".toMediaType()) else bytes?.toRequestBody("application/json".toMediaType())
        builder.method(method, requestBody)
        http.newCall(builder.build()).execute().use { response ->
            if (response.code == 204) return JsonObject(emptyMap())
            val stream = response.body?.byteStream() ?: throw MobileApiException("protocol_incompatible", response.code)
            val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                if (output.size() + count > maxResponseBytes) throw MobileApiException("payload_too_large", response.code)
                output.write(buffer, 0, count)
            }
            val payload = output.toByteArray()
            if (!response.isSuccessful) {
                val error = runCatching { json.decodeFromString<ErrorEnvelope>(payload.toString(Charsets.UTF_8)).error }.getOrNull()
                throw MobileApiException(error?.code ?: when (response.code) { 401 -> "credential_expired"; 403 -> "scope_denied"; 410 -> "cursor_expired"; else -> "request_failed" }, response.code, error?.requestId)
            }
            if (response.header("Content-Type")?.substringBefore(';')?.trim() != "application/json") throw MobileApiException("protocol_incompatible", response.code)
            return try { json.parseToJsonElement(payload.toString(Charsets.UTF_8)) } catch (_: Exception) { throw MobileApiException("protocol_incompatible", response.code) }
        }
    }

    companion object { fun newMutationId(): String = UUID.randomUUID().toString() }
}
