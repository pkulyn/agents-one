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
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import one.agents.mobile.contract.Credentials

/** Only connection/interface preferences and Keystore-encrypted credentials reach disk. */
class DevicePreferences(context: Context) {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    var appearance: String
        get() = prefs.getString("appearance", "system").takeIf { it in setOf("system", "light", "dark") } ?: "system"
        set(value) { require(value in setOf("system", "light", "dark")); prefs.edit().putString("appearance", value).apply() }
    var language: String
        get() = prefs.getString("language", null) ?: if (Locale.getDefault().language == "zh") "zh-CN" else "en"
        set(value) { require(value in setOf("zh-CN", "en")); prefs.edit().putString("language", value).apply() }
    var endpoint: String
        get() = prefs.getString("endpoint", "") ?: ""
        set(value) { prefs.edit().putString("endpoint", value).apply() }
    var rotationId: String?
        get() = prefs.getString("refresh_rotation", null)
        set(value) { check(prefs.edit().putString("refresh_rotation", value).commit()) }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("agents-one-mobile-device", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("agents-one-mobile-device", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
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
    fun forgetCredentials() { prefs.edit().remove("credentials").remove("refresh_rotation").commit() }
}
