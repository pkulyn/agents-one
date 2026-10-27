package one.agents.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import one.agents.mobile.contract.Credentials
import one.agents.mobile.contract.OwnerSpace

@Serializable
internal data class LastOwnerContext(val owner: OwnerSpace, val grantRevision: String, val deviceId: String)

/** Only connection/interface preferences, encrypted Owner context, and Keystore-encrypted credentials reach disk. */
class DevicePreferences internal constructor(context: Context, private val keyProvider: () -> SecretKey) {
    constructor(context: Context) : this(context, { createOrLoadKey() })
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    var appearance: String
        get() = prefs.getString("appearance", "system").takeIf { it in setOf("system", "light", "dark") } ?: "system"
        set(value) { require(value in setOf("system", "light", "dark")); prefs.edit().putString("appearance", value).apply() }
    var language: String
        get() = prefs.getString("language", null) ?: if (Locale.getDefault().language == "zh") "zh-CN" else "en"
        set(value) { require(value in setOf("zh-CN", "en")); prefs.edit().putString("language", value).apply() }
    var deviceLabel: String
        get() = prefs.getString("device_label", "") ?: ""
        set(value) { require(value.length <= 80); prefs.edit().putString("device_label", value).apply() }
    fun computerName(ownerId: String): String = prefs.getString("computer_name:" + ownerId, "") ?: ""
    fun renameComputer(ownerId: String, value: String) { require(value.length <= 80); prefs.edit().putString("computer_name:" + ownerId, value).apply() }
    var endpoint: String
        get() = prefs.getString("endpoint", "") ?: ""
        set(value) { prefs.edit().putString("endpoint", value).apply() }
    var rotationId: String?
        get() = prefs.getString("refresh_rotation", null)
        set(value) { check(prefs.edit().putString("refresh_rotation", value).commit()) }
    private fun key(): SecretKey = keyProvider()

    companion object {
        private fun createOrLoadKey(): SecretKey {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey("agents-one-mobile-device", null) as? SecretKey)?.let { return it }
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder("agents-one-mobile-device", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            }.generateKey()
        }
    }
    fun saveCredentials(value: Credentials, endpoint: String? = null) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(Json.encodeToString(value).toByteArray(Charsets.UTF_8))
        val edit = prefs.edit().putString("credentials", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).remove("refresh_rotation")
        endpoint?.let { edit.putString("endpoint", it) }
        check(edit.commit())
    }
    fun credentials(): Credentials? {
        val value = prefs.getString("credentials", null) ?: return null
        return runCatching {
            val bytes = Base64.decode(value, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
            Json.decodeFromString<Credentials>(cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8))
        }.getOrNull()
    }
    private fun ownerContextAad(endpoint: String, deviceId: String, grantRevision: String): ByteArray =
        "agents-one-owner-context-v1\u0000$endpoint\u0000$deviceId\u0000$grantRevision".toByteArray(Charsets.UTF_8)

    internal fun saveLastOwnerContext(owner: OwnerSpace, grantRevision: String, currentCredentials: Credentials) {
        val endpoint = endpoint.trim()
        if (endpoint.isEmpty() || grantRevision != currentCredentials.grantRevision) {
            clearLastOwnerContext()
            return
        }
        val safeOwner = owner.copy(capabilities = owner.capabilities.filter { it.endsWith(":read") })
        val context = LastOwnerContext(safeOwner, grantRevision, currentCredentials.deviceId)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, key())
            updateAAD(ownerContextAad(endpoint, currentCredentials.deviceId, grantRevision))
        }
        val encrypted = cipher.doFinal(Json.encodeToString(context).toByteArray(Charsets.UTF_8))
        check(prefs.edit()
            .putString("last_owner_context", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP))
            .putString("last_owner_context_grant", grantRevision)
            .commit())
    }

    internal fun lastOwnerContext(currentCredentials: Credentials): LastOwnerContext? {
        val endpoint = endpoint.trim()
        val storedGrant = prefs.getString("last_owner_context_grant", null) ?: return null
        if (endpoint.isEmpty() || storedGrant != currentCredentials.grantRevision) return null
        val value = prefs.getString("last_owner_context", null) ?: return null
        return runCatching {
            val bytes = Base64.decode(value, Base64.NO_WRAP)
            require(bytes.size > 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                updateAAD(ownerContextAad(endpoint, currentCredentials.deviceId, storedGrant))
            }
            Json.decodeFromString<LastOwnerContext>(cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8))
                .takeIf { context ->
                    context.deviceId == currentCredentials.deviceId &&
                        context.grantRevision == storedGrant &&
                        context.owner.ownerId.isNotBlank() &&
                        context.owner.spaceId.isNotBlank() &&
                        context.owner.dataEpoch.isNotBlank()
                }
        }.getOrNull()
    }

    internal fun clearLastOwnerContext() {
        check(prefs.edit().remove("last_owner_context").remove("last_owner_context_grant").commit())
    }

    fun forgetCredentials() {
        check(prefs.edit()
            .remove("credentials")
            .remove("refresh_rotation")
            .remove("last_owner_context")
            .remove("last_owner_context_grant")
            .commit())
    }
}
