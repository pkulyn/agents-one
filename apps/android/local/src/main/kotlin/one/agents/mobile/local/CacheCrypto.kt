package one.agents.mobile.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayOutputStream
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

sealed class CacheCipherException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class KeyUnavailable(cause: Throwable) : CacheCipherException("cache_key_unavailable", cause)
    class InvalidEnvelope : CacheCipherException("cache_ciphertext_invalid")
    class AuthenticationFailed(cause: Throwable) : CacheCipherException("cache_ciphertext_authentication_failed", cause)
    class CryptoFailure(cause: Throwable) : CacheCipherException("cache_cryptography_failed", cause)
}

interface CachePayloadCipher {
    fun hasNamespaceKey(namespaceId: String): Boolean = true
    fun encrypt(namespaceId: String, plaintext: ByteArray, associatedData: ByteArray): ByteArray
    fun decrypt(namespaceId: String, envelope: ByteArray, associatedData: ByteArray): ByteArray
    fun deleteNamespaceKey(namespaceId: String)
}

internal interface CacheKeyProvider {
    fun getOrCreate(namespaceId: String): SecretKey
    fun getExisting(namespaceId: String): SecretKey?
    fun delete(namespaceId: String)
}

/** AES-GCM ciphertext format: magic/version, fresh 96-bit IV, ciphertext and 128-bit tag. */
class AesGcmCacheCipher internal constructor(private val keys: CacheKeyProvider) : CachePayloadCipher {
    constructor() : this(AndroidKeystoreCacheKeyProvider())

    override fun hasNamespaceKey(namespaceId: String): Boolean = keys.getExisting(CacheNamespaceId.requireValid(namespaceId).value) != null

    override fun encrypt(namespaceId: String, plaintext: ByteArray, associatedData: ByteArray): ByteArray {
        CacheNamespaceId.requireValid(namespaceId)
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, keys.getOrCreate(namespaceId))
            cipher.updateAAD(associatedData)
            val iv = cipher.iv
            if (iv.size != IV_BYTES) throw CacheCipherException.CryptoFailure(IllegalStateException("unexpected_gcm_iv_length"))
            return ByteArrayOutputStream(MAGIC.size + iv.size + plaintext.size + TAG_BYTES).use { output ->
                output.write(MAGIC)
                output.write(iv)
                output.write(cipher.doFinal(plaintext))
                output.toByteArray()
            }
        } catch (error: CacheCipherException) {
            throw error
        } catch (error: GeneralSecurityException) {
            throw CacheCipherException.CryptoFailure(error)
        } catch (error: RuntimeException) {
            throw CacheCipherException.CryptoFailure(error)
        }
    }

    override fun decrypt(namespaceId: String, envelope: ByteArray, associatedData: ByteArray): ByteArray {
        CacheNamespaceId.requireValid(namespaceId)
        if (envelope.size < MAGIC.size + IV_BYTES + TAG_BYTES || !envelope.copyOfRange(0, MAGIC.size).contentEquals(MAGIC))
            throw CacheCipherException.InvalidEnvelope()
        val ivStart = MAGIC.size
        val ciphertextStart = ivStart + IV_BYTES
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            val key = keys.getExisting(namespaceId)
                ?: throw CacheCipherException.KeyUnavailable(IllegalStateException("cache_key_missing"))
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, envelope.copyOfRange(ivStart, ciphertextStart)))
            cipher.updateAAD(associatedData)
            return cipher.doFinal(envelope.copyOfRange(ciphertextStart, envelope.size))
        } catch (error: AEADBadTagException) {
            throw CacheCipherException.AuthenticationFailed(error)
        } catch (error: CacheCipherException) {
            throw error
        } catch (error: GeneralSecurityException) {
            throw CacheCipherException.CryptoFailure(error)
        } catch (error: RuntimeException) {
            throw CacheCipherException.CryptoFailure(error)
        }
    }

    override fun deleteNamespaceKey(namespaceId: String) {
        CacheNamespaceId.requireValid(namespaceId)
        try {
            keys.delete(namespaceId)
        } catch (error: Exception) {
            throw CacheCipherException.KeyUnavailable(error)
        }
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
        const val TAG_BYTES = TAG_BITS / 8
        val MAGIC = byteArrayOf(0x41, 0x4f, 0x43, 0x01)
    }
}

private class AndroidKeystoreCacheKeyProvider : CacheKeyProvider {
    override fun getOrCreate(namespaceId: String): SecretKey {
        val alias = alias(namespaceId)
        try {
            val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            (store.getKey(alias, null) as? SecretKey)?.let { return it }
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).apply {
                init(
                    KeyGenParameterSpec.Builder(
                        alias,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setKeySize(256)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build(),
                )
            }.generateKey()
        } catch (error: Exception) {
            throw CacheCipherException.KeyUnavailable(error)
        }
    }

    override fun getExisting(namespaceId: String): SecretKey? {
        try {
            val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            return store.getKey(alias(namespaceId), null) as? SecretKey
        } catch (error: Exception) {
            throw CacheCipherException.KeyUnavailable(error)
        }
    }

    override fun delete(namespaceId: String) {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        store.deleteEntry(alias(namespaceId))
    }

    private fun alias(namespaceId: String): String = "$ALIAS_PREFIX$namespaceId"

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val ALIAS_PREFIX = "agents-one-mobile-cache-v1-"
    }
}
