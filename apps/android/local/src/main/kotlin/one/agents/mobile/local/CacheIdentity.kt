package one.agents.mobile.local

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.net.URI
import java.security.MessageDigest
import java.util.Locale

/** Opaque identity for one endpoint, owner, space, device and authorization revision. */
@JvmInline
value class CacheNamespaceId private constructor(val value: String) {
    companion object {
        fun from(
            endpoint: String,
            ownerId: String,
            spaceId: String,
            deviceId: String,
            grantRevision: String,
        ): CacheNamespaceId {
            val normalizedEndpoint = normalizeEndpoint(endpoint)
            val fields = listOf("agents-one-mobile-cache-namespace-v1", normalizedEndpoint, ownerId, spaceId, deviceId, grantRevision)
            require(fields.drop(2).all(String::isNotBlank))
            val bytes = ByteArrayOutputStream().use { buffer ->
                DataOutputStream(buffer).use { output ->
                    fields.forEach { field ->
                        val value = field.toByteArray(Charsets.UTF_8)
                        output.writeInt(value.size)
                        output.write(value)
                    }
                }
                buffer.toByteArray()
            }
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            return CacheNamespaceId(digest.joinToString("") { "%02x".format(Locale.ROOT, it) })
        }

        internal fun requireValid(value: String): CacheNamespaceId {
            require(value.matches(Regex("^[a-f0-9]{64}$")))
            return CacheNamespaceId(value)
        }

        private fun normalizeEndpoint(value: String): String {
            val uri = URI(value.trim()).normalize()
            require(uri.isAbsolute && uri.host != null && uri.userInfo == null)
            require(uri.scheme.equals("https", true) || uri.scheme.equals("http", true))
            val path = uri.rawPath.orEmpty().trimEnd('/')
            val query = uri.rawQuery?.let { "?$it" }.orEmpty()
            return "${uri.scheme.lowercase(Locale.ROOT)}://${uri.rawAuthority.lowercase(Locale.ROOT)}$path$query"
        }
    }
}

/** AAD pins ciphertext to its namespace and the exact row version and field. */
data class CacheAssociatedData(
    val namespaceId: String,
    val recordKind: String,
    val resourceId: String,
    val revision: String,
    val field: String = "payload",
) {
    init {
        CacheNamespaceId.requireValid(namespaceId)
        require(recordKind.isNotBlank() && resourceId.isNotBlank() && revision.isNotBlank() && field.isNotBlank())
    }

    fun encode(): ByteArray {
        val values = listOf("agents-one-mobile-cache-aad-v1", namespaceId, recordKind, resourceId, revision, field)
        return ByteArrayOutputStream().use { buffer ->
            DataOutputStream(buffer).use { output ->
                values.forEach { value ->
                    val bytes = value.toByteArray(Charsets.UTF_8)
                    output.writeInt(bytes.size)
                    output.write(bytes)
                }
            }
            buffer.toByteArray()
        }
    }
}
