package one.agents.mobile.local

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.withTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

@Entity(tableName = "cache_namespaces")
data class CacheNamespaceEntity(
    @PrimaryKey val namespaceId: String,
    val createdAt: Long,
    val authorizationRevision: String,
)

@Entity(
    tableName = "encrypted_cache_entries",
    primaryKeys = ["namespaceId", "resourceKind", "resourceId"],
    foreignKeys = [
        ForeignKey(
            entity = CacheNamespaceEntity::class,
            parentColumns = ["namespaceId"],
            childColumns = ["namespaceId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index(value = ["namespaceId", "resourceKind", "updatedAt"])],
)
data class EncryptedCacheEntryEntity(
    val namespaceId: String,
    val resourceKind: String,
    val resourceId: String,
    val revision: String,
    val updatedAt: Long,
    val retentionClass: String,
    val encryptedPayload: ByteArray,
)

@Entity(
    tableName = "encrypted_sync_cursors",
    primaryKeys = ["namespaceId", "feedId"],
    foreignKeys = [
        ForeignKey(
            entity = CacheNamespaceEntity::class,
            parentColumns = ["namespaceId"],
            childColumns = ["namespaceId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
)
data class EncryptedSyncCursorEntity(
    val namespaceId: String,
    val feedId: String,
    val revision: String,
    val encryptedCursor: ByteArray,
    val updatedAt: Long,
)

@Dao
interface MobileCacheDao {
    @Query("SELECT EXISTS(SELECT 1 FROM cache_namespaces WHERE namespaceId = :namespaceId)")
    suspend fun namespaceExists(namespaceId: String): Boolean

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun createNamespaceIfAbsent(namespace: CacheNamespaceEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertEntries(entries: List<EncryptedCacheEntryEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertCursors(cursors: List<EncryptedSyncCursorEntity>)

    @Query("SELECT * FROM encrypted_cache_entries WHERE namespaceId = :namespaceId AND resourceKind = :resourceKind AND resourceId = :resourceId")
    suspend fun entry(namespaceId: String, resourceKind: String, resourceId: String): EncryptedCacheEntryEntity?

    @Query("SELECT * FROM encrypted_sync_cursors WHERE namespaceId = :namespaceId AND feedId = :feedId")
    suspend fun cursor(namespaceId: String, feedId: String): EncryptedSyncCursorEntity?

    @Query("SELECT COALESCE(SUM(length(encryptedPayload)), 0) FROM encrypted_cache_entries WHERE namespaceId = :namespaceId AND resourceKind != 'private_avatar'")
    suspend fun contentBytes(namespaceId: String): Long

    @Query("SELECT COALESCE(SUM(length(encryptedPayload)), 0) FROM encrypted_cache_entries WHERE namespaceId = :namespaceId AND resourceKind = 'private_avatar'")
    suspend fun avatarBytes(namespaceId: String): Long

    @Query("DELETE FROM encrypted_cache_entries WHERE namespaceId = :namespaceId AND retentionClass = 'rebuildable'")
    suspend fun clearRebuildable(namespaceId: String)

    @Query("DELETE FROM cache_namespaces WHERE namespaceId = :namespaceId")
    suspend fun deleteNamespace(namespaceId: String)
}

@Database(
    entities = [CacheNamespaceEntity::class, EncryptedCacheEntryEntity::class, EncryptedSyncCursorEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class MobileCacheDatabase : RoomDatabase() {
    abstract fun cacheDao(): MobileCacheDao

    companion object {
        const val FILE_NAME = "agents_one_mobile_cache.db"

        fun open(context: Context): MobileCacheDatabase =
            Room.databaseBuilder(context.applicationContext, MobileCacheDatabase::class.java, FILE_NAME)
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .build()
    }
}

enum class CacheResourceKind(val storageKey: String, val retention: CacheRetention) {
    CONVERSATION("conversation", CacheRetention.REBUILDABLE),
    MESSAGE("message", CacheRetention.ACTIVE_WINDOW),
    ACTIVITY("activity", CacheRetention.ACTIVE_WINDOW),
    SCHEDULE("schedule", CacheRetention.REBUILDABLE),
    DIRECTORY_ENTRY("directory_entry", CacheRetention.REBUILDABLE),
    PRIVATE_AVATAR("private_avatar", CacheRetention.REBUILDABLE),
    DRAFT("draft", CacheRetention.DURABLE_LOCAL),
    PENDING_SUBMISSION("pending_submission", CacheRetention.DURABLE_LOCAL),
}

enum class CacheRetention(val storageKey: String) {
    REBUILDABLE("rebuildable"),
    ACTIVE_WINDOW("active_window"),
    DURABLE_LOCAL("durable_local"),
}

/** Conservative encrypted-payload budgets; writes fail explicitly instead of evicting user data. */
object MobileCacheBudget {
    const val CONTENT_BYTES = 100L * 1024 * 1024
    const val PRIVATE_AVATAR_BYTES = 20L * 1024 * 1024
    const val AES_GCM_OVERHEAD_BYTES = 32L
}

data class CacheBudgetLimits(
    val contentBytes: Long = MobileCacheBudget.CONTENT_BYTES,
    val privateAvatarBytes: Long = MobileCacheBudget.PRIVATE_AVATAR_BYTES,
) {
    init {
        require(contentBytes > 0L && privateAvatarBytes > 0L)
    }
}

data class CacheEntryWrite(
    val namespaceId: String,
    val kind: CacheResourceKind,
    val resourceId: String,
    val revision: String,
    val updatedAt: Long,
    val plaintext: ByteArray,
)

data class CacheCursorWrite(
    val namespaceId: String,
    val feedId: String,
    val revision: String,
    val appliedSequence: String,
    val cursor: ByteArray,
    val updatedAt: Long,
)

data class NamespaceInitialization(val namespaceId: String, val authorizationRevision: String, val createdAt: Long)

enum class CacheBudgetKind(val storageKey: String) { CONTENT("content"), PRIVATE_AVATAR("private_avatar") }

class CacheBudgetExceeded(val budgetKind: CacheBudgetKind) : Exception("cache_budget_exceeded:${budgetKind.storageKey}")

data class CachedPagePayload(
    val plaintext: ByteArray,
    val appliedSequence: String,
    val cursor: ByteArray,
    val revision: String,
)

/** Transactional storage for ciphertext only. All queries and writes require an explicit namespace. */
class EncryptedMobileCacheStore(
    private val database: MobileCacheDatabase,
    private val cipher: CachePayloadCipher,
    private val budgets: CacheBudgetLimits = CacheBudgetLimits(),
) {
    private val dao get() = database.cacheDao()

    suspend fun commitPage(
        namespace: NamespaceInitialization,
        entries: List<CacheEntryWrite>,
        cursors: List<CacheCursorWrite> = emptyList(),
    ) = withContext(Dispatchers.IO) {
        CacheNamespaceId.requireValid(namespace.namespaceId)
        CacheNamespaceOperationLocks.forNamespace(namespace.namespaceId).withLock {
            require(entries.all { it.namespaceId == namespace.namespaceId })
            require(cursors.all { it.namespaceId == namespace.namespaceId })
            require(entries.map { it.kind.storageKey to it.resourceId }.distinct().size == entries.size)
            require(cursors.map(CacheCursorWrite::feedId).distinct().size == cursors.size)
            enforceInputBudget(entries)
            if (dao.namespaceExists(namespace.namespaceId) && !cipher.hasNamespaceKey(namespace.namespaceId)) {
                throw CacheCipherException.KeyUnavailable(IllegalStateException("cache_key_missing"))
            }

            val encryptedEntries = entries.map { entry ->
                val aad = CacheAssociatedData(entry.namespaceId, entry.kind.storageKey, entry.resourceId, entry.revision)
                EncryptedCacheEntryEntity(
                    namespaceId = entry.namespaceId,
                    resourceKind = entry.kind.storageKey,
                    resourceId = entry.resourceId,
                    revision = entry.revision,
                    updatedAt = entry.updatedAt,
                    retentionClass = entry.kind.retention.storageKey,
                    encryptedPayload = cipher.encrypt(entry.namespaceId, entry.plaintext, aad.encode()),
                )
            }
            val encryptedCursors = cursors.map { cursor ->
                val aad = CacheAssociatedData(cursor.namespaceId, "cursor", cursor.feedId, cursor.revision)
                EncryptedSyncCursorEntity(
                    namespaceId = cursor.namespaceId,
                    feedId = cursor.feedId,
                    revision = cursor.revision,
                    encryptedCursor = cipher.encrypt(cursor.namespaceId, CursorPayloadCodec.encode(cursor.appliedSequence, cursor.cursor), aad.encode()),
                    updatedAt = cursor.updatedAt,
                )
            }

            database.withTransaction {
                dao.createNamespaceIfAbsent(
                    CacheNamespaceEntity(namespace.namespaceId, namespace.createdAt, namespace.authorizationRevision),
                )
                enforceBudget(namespace.namespaceId, encryptedEntries)
                if (encryptedEntries.isNotEmpty()) dao.upsertEntries(encryptedEntries)
                if (encryptedCursors.isNotEmpty()) dao.upsertCursors(encryptedCursors)
            }
        }
    }

    suspend fun readPage(
        namespaceId: String,
        kind: CacheResourceKind,
        resourceId: String,
        feedId: String,
    ): CachedPagePayload? = withContext(Dispatchers.IO) {
        CacheNamespaceId.requireValid(namespaceId)
        CacheNamespaceOperationLocks.forNamespace(namespaceId).withLock {
            val pair = database.withTransaction {
                val entry = dao.entry(namespaceId, kind.storageKey, resourceId)
                val cursor = dao.cursor(namespaceId, feedId)
                if (entry == null || cursor == null || entry.revision != cursor.revision) null else entry to cursor
            } ?: return@withLock null
            val (entry, cursor) = pair
            val pageData = cipher.decrypt(
                entry.namespaceId,
                entry.encryptedPayload,
                CacheAssociatedData(entry.namespaceId, entry.resourceKind, entry.resourceId, entry.revision).encode(),
            )
            val (sequence, token) = CursorPayloadCodec.decode(
                cipher.decrypt(
                    cursor.namespaceId,
                    cursor.encryptedCursor,
                    CacheAssociatedData(cursor.namespaceId, "cursor", cursor.feedId, cursor.revision).encode(),
                ),
            )
            CachedPagePayload(pageData, sequence, token, entry.revision)
        }
    }

    suspend fun read(namespaceId: String, kind: CacheResourceKind, resourceId: String): ByteArray? = withContext(Dispatchers.IO) {
        CacheNamespaceId.requireValid(namespaceId)
        CacheNamespaceOperationLocks.forNamespace(namespaceId).withLock {
            val row = dao.entry(namespaceId, kind.storageKey, resourceId) ?: return@withLock null
            val aad = CacheAssociatedData(row.namespaceId, row.resourceKind, row.resourceId, row.revision)
            cipher.decrypt(row.namespaceId, row.encryptedPayload, aad.encode())
        }
    }

    suspend fun readCursor(namespaceId: String, feedId: String): Pair<String, ByteArray>? = withContext(Dispatchers.IO) {
        CacheNamespaceId.requireValid(namespaceId)
        CacheNamespaceOperationLocks.forNamespace(namespaceId).withLock {
            val row = dao.cursor(namespaceId, feedId) ?: return@withLock null
            val aad = CacheAssociatedData(row.namespaceId, "cursor", row.feedId, row.revision)
            CursorPayloadCodec.decode(cipher.decrypt(row.namespaceId, row.encryptedCursor, aad.encode()))
        }
    }

    suspend fun contentBytes(namespaceId: String): Long = withContext(Dispatchers.IO) { dao.contentBytes(namespaceId) }
    suspend fun avatarBytes(namespaceId: String): Long = withContext(Dispatchers.IO) { dao.avatarBytes(namespaceId) }

    suspend fun clearRebuildable(namespaceId: String) = withContext(Dispatchers.IO) {
        CacheNamespaceId.requireValid(namespaceId)
        CacheNamespaceOperationLocks.forNamespace(namespaceId).withLock { dao.clearRebuildable(namespaceId) }
    }

    suspend fun forgetNamespace(namespaceId: String) = withContext(Dispatchers.IO) {
        CacheNamespaceId.requireValid(namespaceId)
        CacheNamespaceOperationLocks.forNamespace(namespaceId).withLock {
            database.withTransaction { dao.deleteNamespace(namespaceId) }
            cipher.deleteNamespaceKey(namespaceId)
        }
    }

    private suspend fun enforceBudget(namespaceId: String, replacements: List<EncryptedCacheEntryEntity>) {
        var contentBytes = dao.contentBytes(namespaceId)
        var avatarBytes = dao.avatarBytes(namespaceId)
        replacements.forEach { replacement ->
            val previous = dao.entry(namespaceId, replacement.resourceKind, replacement.resourceId)
            val previousBytes = previous?.encryptedPayload?.size?.toLong() ?: 0L
            val nextBytes = replacement.encryptedPayload.size.toLong()
            if (replacement.resourceKind == CacheResourceKind.PRIVATE_AVATAR.storageKey)
                avatarBytes += nextBytes - previousBytes
            else
                contentBytes += nextBytes - previousBytes
        }
        if (contentBytes > budgets.contentBytes) throw CacheBudgetExceeded(CacheBudgetKind.CONTENT)
        if (avatarBytes > budgets.privateAvatarBytes) throw CacheBudgetExceeded(CacheBudgetKind.PRIVATE_AVATAR)
    }

    private fun enforceInputBudget(entries: List<CacheEntryWrite>) {
        val contentBytes = entries.asSequence()
            .filter { it.kind != CacheResourceKind.PRIVATE_AVATAR }
            .sumOf { it.plaintext.size.toLong() + MobileCacheBudget.AES_GCM_OVERHEAD_BYTES }
        val avatarBytes = entries.asSequence()
            .filter { it.kind == CacheResourceKind.PRIVATE_AVATAR }
            .sumOf { it.plaintext.size.toLong() + MobileCacheBudget.AES_GCM_OVERHEAD_BYTES }
        if (contentBytes > budgets.contentBytes) throw CacheBudgetExceeded(CacheBudgetKind.CONTENT)
        if (avatarBytes > budgets.privateAvatarBytes) throw CacheBudgetExceeded(CacheBudgetKind.PRIVATE_AVATAR)
    }
}

private object CursorPayloadCodec {
    fun encode(sequence: String, cursor: ByteArray): ByteArray {
        require(sequence.isNotBlank())
        val sequenceBytes = sequence.toByteArray(Charsets.UTF_8)
        return java.io.ByteArrayOutputStream(4 + sequenceBytes.size + cursor.size).use { buffer ->
            java.io.DataOutputStream(buffer).use { output ->
                output.writeInt(sequenceBytes.size)
                output.write(sequenceBytes)
                output.write(cursor)
            }
            buffer.toByteArray()
        }
    }

    fun decode(value: ByteArray): Pair<String, ByteArray> {
        val input = java.io.DataInputStream(value.inputStream())
        val sequenceLength = input.readInt()
        require(sequenceLength in 1..value.size - 4)
        val sequenceBytes = ByteArray(sequenceLength).also(input::readFully)
        val cursor = ByteArray(input.available()).also(input::readFully)
        val sequence = sequenceBytes.toString(Charsets.UTF_8)
        require(sequence.isNotBlank())
        return sequence to cursor
    }
}

private object CacheNamespaceOperationLocks {
    private val locks = ConcurrentHashMap<String, Mutex>()

    fun forNamespace(namespaceId: String): Mutex = locks.computeIfAbsent(namespaceId) { Mutex() }
}
