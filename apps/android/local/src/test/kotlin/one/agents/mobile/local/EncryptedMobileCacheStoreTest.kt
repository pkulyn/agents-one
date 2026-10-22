package one.agents.mobile.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EncryptedMobileCacheStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val keys = TestCacheKeyProvider()
    private val cipher = AesGcmCacheCipher(keys)
    private lateinit var database: MobileCacheDatabase
    private lateinit var store: EncryptedMobileCacheStore
    private val namespace = namespace("owner-1")
    private val namespaceInit = NamespaceInitialization(namespace.value, "grant-7", 10L)

    @Before
    fun setUp() {
        database = openTestDatabase()
        store = EncryptedMobileCacheStore(database, cipher)
    }

    @After
    fun tearDown() {
        if (::database.isInitialized && database.isOpen) database.close()
        context.getSharedPreferences("connection", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun existingNamespaceWithMissingKeyCannotCreateReplacementDuringPageRefresh() = runBlocking {
        store.commitPage(
            namespaceInit,
            listOf(CacheEntryWrite(namespace.value, CacheResourceKind.DRAFT, "draft-before-key-loss", "r1", 1L, "private".toByteArray())),
        )
        keys.delete(namespace.value)

        assertThrows(CacheCipherException.KeyUnavailable::class.java) {
            runBlocking {
                store.commitPage(
                    namespaceInit,
                    listOf(CacheEntryWrite(namespace.value, CacheResourceKind.DRAFT, "draft-after-key-loss", "r2", 2L, "replacement".toByteArray())),
                )
            }
        }
        database.openHelper.readableDatabase.query("SELECT COUNT(*) FROM encrypted_cache_entries").use {
            assertTrue(it.moveToFirst())
            assertEquals(1, it.getInt(0))
        }
        assertFalse(keys.namespaces().contains(namespace.value))
    }

    @Test
    fun readPageOnlyReturnsContentAndCursorFromMatchingRevision() = runBlocking {
        val payload = "{\"items\":[]}".toByteArray()
        val nextCursor = "opaque-next-page".toByteArray()
        store.commitPage(
            namespaceInit,
            listOf(CacheEntryWrite(namespace.value, CacheResourceKind.DIRECTORY_ENTRY, "page-hash", "snapshot-8", 30L, payload)),
            listOf(CacheCursorWrite(namespace.value, "page-hash", "snapshot-8", "cut-8", nextCursor, 31L)),
        )

        val cached = store.readPage(namespace.value, CacheResourceKind.DIRECTORY_ENTRY, "page-hash", "page-hash")
        assertArrayEquals(payload, cached?.plaintext)
        assertEquals("cut-8", cached?.appliedSequence)
        assertArrayEquals(nextCursor, cached?.cursor)
        assertEquals("snapshot-8", cached?.revision)

        store.commitPage(
            namespaceInit,
            emptyList(),
            listOf(CacheCursorWrite(namespace.value, "page-hash", "snapshot-9", "cut-9", "other-cursor".toByteArray(), 32L)),
        )
        assertNull(store.readPage(namespace.value, CacheResourceKind.DIRECTORY_ENTRY, "page-hash", "page-hash"))
    }

    @Test
    fun storesEncryptedContentAndCursorPayloads() = runBlocking {
        val body = "CACHE_SENTINEL_private_conversation_body".toByteArray()
        val cursor = "CACHE_SENTINEL_private_cursor".toByteArray()
        store.commitPage(
            namespaceInit,
            listOf(
                CacheEntryWrite(namespace.value, CacheResourceKind.MESSAGE, "message-1", "rev-1", 20L, body),
                CacheEntryWrite(namespace.value, CacheResourceKind.DRAFT, "draft-1", "rev-1", 21L, "CACHE_SENTINEL_draft".toByteArray()),
            ),
            listOf(CacheCursorWrite(namespace.value, "conversation-feed", "cursor-rev-1", "109", cursor, 22L)),
        )

        val messageBlob = database.openHelper.readableDatabase
            .query("SELECT encryptedPayload FROM encrypted_cache_entries WHERE resourceId = 'message-1'").use {
                assertTrue(it.moveToFirst())
                it.getBlob(0)
            }
        val draftBlob = database.openHelper.readableDatabase
            .query("SELECT encryptedPayload FROM encrypted_cache_entries WHERE resourceId = 'draft-1'").use {
                assertTrue(it.moveToFirst())
                it.getBlob(0)
            }
        val cursorBlob = database.openHelper.readableDatabase
            .query("SELECT encryptedCursor FROM encrypted_sync_cursors WHERE feedId = 'conversation-feed'").use {
                assertTrue(it.moveToFirst())
                it.getBlob(0)
            }
        assertFalse(messageBlob.containsBytes(body))
        assertFalse(draftBlob.containsBytes("CACHE_SENTINEL_draft".toByteArray()))
        assertFalse(cursorBlob.containsBytes(cursor))
        assertFalse(cursorBlob.containsBytes("109".toByteArray()))

        assertArrayEquals(body, store.read(namespace.value, CacheResourceKind.MESSAGE, "message-1"))
        assertArrayEquals("CACHE_SENTINEL_draft".toByteArray(), store.read(namespace.value, CacheResourceKind.DRAFT, "draft-1"))
        val restoredCursor = store.readCursor(namespace.value, "conversation-feed")
        assertEquals("109", restoredCursor?.first)
        assertArrayEquals(cursor, restoredCursor?.second)
    }

    @Test
    fun recordsAreIsolatedByOwnerNamespaceAndExistingConnectionPreferencesRemainUntouched() = runBlocking {
        val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
        prefs.edit().putString("endpoint", "https://existing.example.test").putString("credentials", "ciphertext").commit()
        val other = namespace("owner-2")
        store.commitPage(
            namespaceInit,
            listOf(CacheEntryWrite(namespace.value, CacheResourceKind.CONVERSATION, "same-id", "r1", 1L, "owner one".toByteArray())),
        )
        store.commitPage(
            NamespaceInitialization(other.value, "grant-3", 2L),
            listOf(CacheEntryWrite(other.value, CacheResourceKind.CONVERSATION, "same-id", "r2", 2L, "owner two".toByteArray())),
        )

        assertArrayEquals("owner one".toByteArray(), store.read(namespace.value, CacheResourceKind.CONVERSATION, "same-id"))
        assertArrayEquals("owner two".toByteArray(), store.read(other.value, CacheResourceKind.CONVERSATION, "same-id"))
        assertEquals("https://existing.example.test", prefs.getString("endpoint", null))
        assertEquals("ciphertext", prefs.getString("credentials", null))
    }

    @Test
    fun recordAndCursorRollBackTogetherWhenCursorWriteFails() = runBlocking {
        database.openHelper.writableDatabase.execSQL(
            "CREATE TRIGGER reject_cursor BEFORE INSERT ON encrypted_sync_cursors BEGIN SELECT RAISE(ABORT, 'synthetic_cursor_rejected'); END",
        )

        assertThrows(Exception::class.java) {
            runBlocking {
                store.commitPage(
                    namespaceInit,
                    listOf(CacheEntryWrite(namespace.value, CacheResourceKind.MESSAGE, "message-1", "rev-1", 1L, "body".toByteArray())),
                    listOf(CacheCursorWrite(namespace.value, "feed", "cursor-rev-1", "17", "cursor".toByteArray(), 1L)),
                )
            }
        }

        assertNull(store.read(namespace.value, CacheResourceKind.MESSAGE, "message-1"))
        assertNull(store.readCursor(namespace.value, "feed"))
        assertEquals(0L, store.contentBytes(namespace.value))
    }

    @Test
    fun rebuildClearingPreservesDraftsAndPendingSubmissions() = runBlocking {
        store.commitPage(
            namespaceInit,
            listOf(
                CacheEntryWrite(namespace.value, CacheResourceKind.CONVERSATION, "conversation-1", "r1", 1L, "listing".toByteArray()),
                CacheEntryWrite(namespace.value, CacheResourceKind.DRAFT, "draft-1", "r1", 1L, "unsent".toByteArray()),
                CacheEntryWrite(namespace.value, CacheResourceKind.PENDING_SUBMISSION, "submission-1", "r1", 1L, "awaiting-ack".toByteArray()),
            ),
        )

        store.clearRebuildable(namespace.value)

        assertNull(store.read(namespace.value, CacheResourceKind.CONVERSATION, "conversation-1"))
        assertArrayEquals("unsent".toByteArray(), store.read(namespace.value, CacheResourceKind.DRAFT, "draft-1"))
        assertArrayEquals("awaiting-ack".toByteArray(), store.read(namespace.value, CacheResourceKind.PENDING_SUBMISSION, "submission-1"))
    }

    @Test
    fun overBudgetPageFailsBeforeContentOrCursorIsCommitted() = runBlocking {
        val constrained = EncryptedMobileCacheStore(database, cipher, CacheBudgetLimits(contentBytes = 96L, privateAvatarBytes = 64L))
        val error = assertThrows(CacheBudgetExceeded::class.java) {
            runBlocking {
                constrained.commitPage(
                    namespaceInit,
                    listOf(CacheEntryWrite(namespace.value, CacheResourceKind.MESSAGE, "message-1", "r1", 1L, ByteArray(65))),
                    listOf(CacheCursorWrite(namespace.value, "feed", "cursor-r1", "103", byteArrayOf(1), 1L)),
                )
            }
        }

        assertEquals(CacheBudgetKind.CONTENT, error.budgetKind)
        assertNull(constrained.read(namespace.value, CacheResourceKind.MESSAGE, "message-1"))
        assertNull(constrained.readCursor(namespace.value, "feed"))
    }

    @Test
    fun forgettingANamespaceRemovesItsRowsAndKeyWithoutTouchingAnotherNamespace() = runBlocking {
        val other = namespace("owner-2")
        store.commitPage(
            namespaceInit,
            listOf(CacheEntryWrite(namespace.value, CacheResourceKind.DRAFT, "draft-1", "r1", 1L, "private".toByteArray())),
        )
        store.commitPage(
            NamespaceInitialization(other.value, "grant-3", 2L),
            listOf(CacheEntryWrite(other.value, CacheResourceKind.DRAFT, "draft-1", "r2", 2L, "other".toByteArray())),
        )

        store.forgetNamespace(namespace.value)

        assertNull(store.read(namespace.value, CacheResourceKind.DRAFT, "draft-1"))
        assertArrayEquals("other".toByteArray(), store.read(other.value, CacheResourceKind.DRAFT, "draft-1"))
        assertFalse(keys.namespaces().contains(namespace.value))
        assertTrue(keys.namespaces().contains(other.value))
    }

    @Test
    fun forgettingNamespaceWaitsForInFlightCommitAndLeavesNoStaleWrite() = runBlocking {
        val encryptionStarted = CountDownLatch(1)
        val continueEncryption = CountDownLatch(1)
        val gateCipher = BlockingCacheCipher(cipher, encryptionStarted, continueEncryption)
        val gatedStore = EncryptedMobileCacheStore(database, gateCipher)
        val write = async(Dispatchers.IO) {
            gatedStore.commitPage(
                namespaceInit,
                listOf(CacheEntryWrite(namespace.value, CacheResourceKind.DRAFT, "draft-1", "r1", 1L, "draft".toByteArray())),
            )
        }
        assertTrue(withContext(Dispatchers.IO) { encryptionStarted.await(5, TimeUnit.SECONDS) })
        val forget = async(Dispatchers.IO) { gatedStore.forgetNamespace(namespace.value) }
        delay(50L)
        assertFalse(forget.isCompleted)

        continueEncryption.countDown()
        awaitAll(write, forget)

        assertNull(gatedStore.read(namespace.value, CacheResourceKind.DRAFT, "draft-1"))
        assertFalse(keys.namespaces().contains(namespace.value))
    }

    @Test
    fun endpointNormalizationAndAssociatedDataRemainDeterministic() {
        val first = namespace("owner-1")
        val second = CacheNamespaceId.from("HTTPS://CONNECT.EXAMPLE.TEST/agents-one", "owner-1", "primary-space", "device-1", "grant-7")

        assertEquals(first, second)
        assertTrue(CacheAssociatedData(first.value, "message", "message-1", "rev-1").encode().isNotEmpty())
    }

    private fun openTestDatabase(): MobileCacheDatabase =
        Room.inMemoryDatabaseBuilder(context, MobileCacheDatabase::class.java).build()

    private fun ByteArray.containsBytes(needle: ByteArray): Boolean =
        needle.isNotEmpty() && indices.any { start ->
            start + needle.size <= size && needle.indices.all { offset -> this[start + offset] == needle[offset] }
        }
}

private class BlockingCacheCipher(
    private val delegate: CachePayloadCipher,
    private val started: CountDownLatch,
    private val proceed: CountDownLatch,
) : CachePayloadCipher {
    private val shouldBlock = AtomicBoolean(true)

    override fun encrypt(namespaceId: String, plaintext: ByteArray, associatedData: ByteArray): ByteArray {
        if (shouldBlock.compareAndSet(true, false)) {
            started.countDown()
            check(proceed.await(5, TimeUnit.SECONDS))
        }
        return delegate.encrypt(namespaceId, plaintext, associatedData)
    }

    override fun decrypt(namespaceId: String, envelope: ByteArray, associatedData: ByteArray): ByteArray =
        delegate.decrypt(namespaceId, envelope, associatedData)

    override fun deleteNamespaceKey(namespaceId: String) = delegate.deleteNamespaceKey(namespaceId)
}
