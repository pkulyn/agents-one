package one.agents.mobile

import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import one.agents.mobile.local.AesGcmCacheCipher
import one.agents.mobile.local.CacheCursorWrite
import one.agents.mobile.local.CacheEntryWrite
import one.agents.mobile.local.CacheNamespaceId
import one.agents.mobile.local.CachePayloadCipher
import one.agents.mobile.local.CacheResourceKind
import one.agents.mobile.local.EncryptedMobileCacheStore
import one.agents.mobile.local.MobileCacheDatabase
import one.agents.mobile.local.NamespaceInitialization
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

internal data class MobileCachePageKey(val resourceId: String, val feedId: String, val kind: CacheResourceKind = CacheResourceKind.DIRECTORY_ENTRY)

internal data class MobileCachePage(
    val payload: JsonElement,
    val revision: String,
    val appliedSequence: String,
    val nextCursor: String?,
)

/**
 * Stores only validated Owner DTO pages in the encrypted, namespace-scoped local module.
 * Page identities are opaque hashes, so search text and server cursors never become SQL keys.
 */
internal class MobileCacheRepository(context: Context, cipher: CachePayloadCipher = AesGcmCacheCipher()) {
    private val database = MobileCacheDatabase.open(context)
    private val store = EncryptedMobileCacheStore(database, cipher)
    private val json = Json { ignoreUnknownKeys = true }

    fun namespace(endpoint: String, ownerId: String, spaceId: String, deviceId: String, grantRevision: String): String =
        CacheNamespaceId.from(endpoint, ownerId, spaceId, deviceId, grantRevision).value

    fun pageKey(
        namespaceId: String,
        dataEpoch: String,
        section: String,
        query: String,
        filters: List<Pair<String, String>>,
        requestedCursor: String?,
        kind: CacheResourceKind = CacheResourceKind.DIRECTORY_ENTRY,
    ): MobileCachePageKey {
        require(dataEpoch.isNotBlank() && section.isNotBlank())
        val fields = buildList {
            add("agents-one-mobile-page-v1")
            add(namespaceId)
            add(dataEpoch)
            add(section)
            add(query)
            filters.sortedBy { it.first }.forEach { (key, value) -> add(key); add(value) }
            add(if (requestedCursor == null) "first-page" else "cursor-page")
            requestedCursor?.let(::add)
        }
        val encoded = ByteArrayOutputStream().use { bytes ->
            DataOutputStream(bytes).use { output ->
                fields.forEach { field ->
                    val raw = field.toByteArray(Charsets.UTF_8)
                    output.writeInt(raw.size)
                    output.write(raw)
                }
            }
            bytes.toByteArray()
        }
        val hash = MessageDigest.getInstance("SHA-256").digest(encoded).joinToString("") { "%02x".format(it) }
        val id = "$section:$hash"
        return MobileCachePageKey(id, id, kind)
    }

    suspend fun readPage(namespaceId: String, key: MobileCachePageKey): MobileCachePage? {
        val cached = store.readPage(namespaceId, key.kind, key.resourceId, key.feedId)
            ?: return null
        val payload = runCatching { json.parseToJsonElement(cached.plaintext.toString(Charsets.UTF_8)) }
            .getOrElse { throw IllegalStateException("mobile_cache_page_invalid", it) }
        val objectValue = payload as? JsonObject ?: throw IllegalStateException("mobile_cache_page_invalid")
        val revision = objectValue["snapshotRevision"]?.jsonPrimitive?.contentOrNull
            ?: throw IllegalStateException("mobile_cache_page_revision_missing")
        val sequence = objectValue["snapshotCursor"]?.jsonPrimitive?.contentOrNull ?: revision
        val next = objectValue["nextCursor"]?.let { value ->
            if (value === JsonNull) null else value.jsonPrimitive.contentOrNull
        }
        val storedNext = cached.cursor.takeIf { it.isNotEmpty() }?.toString(Charsets.UTF_8)
        if (revision != cached.revision || sequence != cached.appliedSequence || next != storedNext)
            throw IllegalStateException("mobile_cache_page_cursor_mismatch")
        return MobileCachePage(payload, revision, sequence, next)
    }

    suspend fun writePage(
        namespaceId: String,
        grantRevision: String,
        key: MobileCachePageKey,
        payload: JsonElement,
        revision: String,
        appliedSequence: String,
        nextCursor: String?,
        updatedAt: Long,
    ) {
        require(revision.isNotBlank() && appliedSequence.isNotBlank())
        val plaintext = payload.toString().toByteArray(Charsets.UTF_8)
        val next = nextCursor?.toByteArray(Charsets.UTF_8) ?: byteArrayOf()
        store.commitPage(
            NamespaceInitialization(namespaceId, grantRevision, updatedAt),
            entries = listOf(
                CacheEntryWrite(
                    namespaceId = namespaceId,
                    kind = key.kind,
                    resourceId = key.resourceId,
                    revision = revision,
                    updatedAt = updatedAt,
                    plaintext = plaintext,
                ),
            ),
            cursors = listOf(
                CacheCursorWrite(
                    namespaceId = namespaceId,
                    feedId = key.feedId,
                    revision = revision,
                    appliedSequence = appliedSequence,
                    cursor = next,
                    updatedAt = updatedAt,
                ),
            ),
        )
    }

    fun close() = database.close()
}
