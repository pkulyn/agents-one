package one.agents.mobile.local

import java.util.concurrent.ConcurrentHashMap
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CacheCryptoTest {
    private val keys = TestCacheKeyProvider()
    private val cipher = AesGcmCacheCipher(keys)
    private val namespace = namespace("crypto-owner")
    private val aad = CacheAssociatedData(namespace.value, "message", "message-1", "rev-1").encode()

    @Test
    fun encryptionUsesFreshNonceAndDecrypts() {
        val plaintext = "private conversation body".toByteArray()

        val first = cipher.encrypt(namespace.value, plaintext, aad)
        val second = cipher.encrypt(namespace.value, plaintext, aad)

        assertNotEquals(first.toList(), second.toList())
        assertArrayEquals(plaintext, cipher.decrypt(namespace.value, first, aad))
        assertArrayEquals(plaintext, cipher.decrypt(namespace.value, second, aad))
    }

    @Test
    fun associatedDataAndCiphertextTamperingAreRejected() {
        val encrypted = cipher.encrypt(namespace.value, "private body".toByteArray(), aad)
        val wrongAad = CacheAssociatedData(namespace.value, "message", "message-2", "rev-1").encode()
        val tampered = encrypted.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 0x01).toByte() }

        assertThrows(CacheCipherException.AuthenticationFailed::class.java) {
            cipher.decrypt(namespace.value, encrypted, wrongAad)
        }
        assertThrows(CacheCipherException.AuthenticationFailed::class.java) {
            cipher.decrypt(namespace.value, tampered, aad)
        }
        assertThrows(CacheCipherException.InvalidEnvelope::class.java) {
            cipher.decrypt(namespace.value, byteArrayOf(0x01), aad)
        }
    }

    @Test
    fun namespaceUsesAnIndependentKey() {
        val otherNamespace = namespace("other-owner")
        val encrypted = cipher.encrypt(namespace.value, "private body".toByteArray(), aad)
        val otherAad = CacheAssociatedData(otherNamespace.value, "message", "message-1", "rev-1").encode()
        cipher.encrypt(otherNamespace.value, "other body".toByteArray(), otherAad)

        assertThrows(CacheCipherException.AuthenticationFailed::class.java) {
            cipher.decrypt(otherNamespace.value, encrypted, otherAad)
        }
        assertTrue(keys.namespaces().containsAll(listOf(namespace.value, otherNamespace.value)))
    }

    @Test
    fun missingKeyDoesNotCreateReplacementKeyDuringRead() {
        val encrypted = cipher.encrypt(namespace.value, "private body".toByteArray(), aad)
        keys.delete(namespace.value)

        assertThrows(CacheCipherException.KeyUnavailable::class.java) {
            cipher.decrypt(namespace.value, encrypted, aad)
        }
        assertTrue(keys.namespaces().isEmpty())
    }
}

internal class TestCacheKeyProvider : CacheKeyProvider {
    private val values = ConcurrentHashMap<String, SecretKey>()

    override fun getOrCreate(namespaceId: String): SecretKey = values.computeIfAbsent(namespaceId) {
        KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    }

    override fun getExisting(namespaceId: String): SecretKey? = values[namespaceId]

    override fun delete(namespaceId: String) {
        values.remove(namespaceId)
    }

    fun namespaces(): Set<String> = values.keys
}

internal fun namespace(ownerId: String): CacheNamespaceId = CacheNamespaceId.from(
    endpoint = "https://connect.example.test/agents-one/",
    ownerId = ownerId,
    spaceId = "primary-space",
    deviceId = "device-1",
    grantRevision = "grant-7",
)
