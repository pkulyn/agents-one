package one.agents.mobile.net

import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.security.MessageDigest
import kotlin.test.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import one.agents.mobile.contract.Artifact

class ArtifactDownloadTest {
    @Test fun `does not report a truncated stream as a successful download or retry it`() {
        MockWebServer().use { server ->
            val bytes = ByteArray(200000) { (it % 251).toByte() }
            server.enqueue(MockResponse().addHeader("Content-Type", "application/pdf").setBody(okio.Buffer().write(bytes)).setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY))
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            val client = client(server)
            val staging = ByteArrayOutputStream()
            try {
                assertFailsWith<java.io.IOException> { client.downloadArtifact(OwnerBinding("owner", "space"), artifact(bytes), staging) }
                assertTrue(staging.size() < bytes.size)
                assertEquals(1, server.requestCount)
            } finally { client.close() }
        }
    }
    private fun artifact(bytes: ByteArray) = Artifact("artifact-1", "run-1", "../unsafe-name.pdf", "application/pdf", bytes.size.toLong(), MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }, allowedActions = listOf("read", "download"))
    private fun client(server: MockWebServer) = MobileControlClient(server.url("/").newBuilder().host("127.0.0.1").build().toString(), { "test-token" }, true)

    @Test fun `streams authenticated binary bytes in a fixed Owner scope and verifies metadata`() {
        MockWebServer().use { server ->
            val bytes = ByteArray(200000) { (it % 251).toByte() }
            server.enqueue(MockResponse().addHeader("Content-Type", "application/pdf").setBody(okio.Buffer().write(bytes)))
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            val client = client(server)
            val staging = ByteArrayOutputStream()
            try {
                client.downloadArtifact(OwnerBinding("owner", "space"), artifact(bytes), staging)
                assertContentEquals(bytes, staging.toByteArray())
                val request = server.takeRequest()
                assertEquals("/agents-one/mobile/v1/owners/owner/spaces/space/artifacts/artifact-1/content", request.path)
                assertEquals("Bearer test-token", request.getHeader("Authorization"))
                assertEquals("identity", request.getHeader("Accept-Encoding"))
                assertNull(request.getHeader("Idempotency-Key"))
            } finally { client.close() }
        }
    }
    @Test fun `rejects incorrect size mime hash encoding and redirects without retries`() {
        val bytes = "binary-result".toByteArray()
        for (case in listOf("size", "mime", "hash", "encoding", "redirect")) {
            MockWebServer().use { server ->
                val response = MockResponse().addHeader("Content-Type", if (case == "mime") "text/html" else "application/pdf").setBody(okio.Buffer().write(bytes))
                if (case == "encoding") response.addHeader("Content-Encoding", "gzip")
                if (case == "redirect") response.setResponseCode(302).addHeader("Location", "/other")
                server.enqueue(response)
                server.start(InetAddress.getByName("127.0.0.1"), 0)
                val expected = artifact(bytes).let { when (case) { "size" -> it.copy(sizeBytes = bytes.size.toLong() + 1); "hash" -> it.copy(sha256 = "0".repeat(64)); else -> it } }
                val client = client(server)
                try {
                    assertFailsWith<MobileApiException>(case) { client.downloadArtifact(OwnerBinding("owner", "space"), expected, ByteArrayOutputStream()) }
                    assertEquals(1, server.requestCount, case)
                } finally { client.close() }
            }
        }
    }
    @Test fun `refuses expired unavailable and malformed metadata before requesting bytes`() {
        MockWebServer().use { server ->
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            val client = client(server)
            val expected = artifact(byteArrayOf())
            try {
                for (value in listOf(expected.copy(allowedActions = listOf("read")), expected.copy(expiresAt = "2000-01-01T00:00:00Z"), expected.copy(sizeBytes = -1), expected.copy(sha256 = "bad")))
                    assertFailsWith<MobileApiException> { client.downloadArtifact(OwnerBinding("owner", "space"), value, ByteArrayOutputStream()) }
                assertEquals(0, server.requestCount)
            } finally { client.close() }
        }
    }
}
