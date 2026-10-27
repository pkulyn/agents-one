package one.agents.mobile.net

import java.security.MessageDigest
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import one.agents.mobile.contract.RuntimeAvatar
import one.agents.mobile.contract.validateMobileSchema

data class RuntimeAvatarBytes(val mime: String, val bytes: ByteArray)

fun verifyRuntimeAvatar(raw: JsonElement, runtimeId: String, avatarId: String): RuntimeAvatarBytes {
    try {
        validateMobileSchema("RuntimeAvatar", raw)
        val value = Json.decodeFromJsonElement<RuntimeAvatar>(raw)
        require(value.runtimeId == runtimeId && value.id == avatarId)
        val bytes = Base64.getDecoder().decode(value.base64)
        require(bytes.isNotEmpty() && bytes.size <= 525000 && bytes.size.toLong() == value.sizeBytes)
        require(Base64.getEncoder().encodeToString(bytes) == value.base64)
        fun hash(prefix: ByteArray = byteArrayOf()): String = MessageDigest.getInstance("SHA-256").apply { update(prefix); update(bytes) }.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        require(hash() == value.sha256 && "ava-${hash((value.mime + "\u0000").toByteArray(Charsets.UTF_8))}" == avatarId)
        return RuntimeAvatarBytes(value.mime, bytes)
    } catch (_: Exception) { throw MobileApiException("protocol_incompatible", 0) }
}
