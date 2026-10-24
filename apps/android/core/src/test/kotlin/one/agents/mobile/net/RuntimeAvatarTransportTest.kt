package one.agents.mobile.net

import java.io.File
import java.net.InetAddress
import kotlin.test.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class RuntimeAvatarTransportTest {
    private val avatar = Json.parseToJsonElement(File("../../../contracts/mobile-control/v1/fixtures.json").readText()).jsonObject["objects"]!!.jsonObject["RuntimeAvatar"]!!.jsonObject
    private val id = avatar["id"]!!.jsonPrimitive.content
    private val runtimeId = avatar["runtimeId"]!!.jsonPrimitive.content
    private fun server(block: (MockWebServer, MobileControlClient) -> Unit) {
        MockWebServer().use { server ->
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            val client = MobileControlClient(server.url("/").newBuilder().host("127.0.0.1").build().toString(), { "device-token" }, true)
            try { block(server, client) } finally { client.close() }
        }
    }
    @Test fun `reads immutable original image from exact authenticated Owner and runtime scope`() = server { server, client ->
        server.enqueue(MockResponse().addHeader("Content-Type", "application/json").setBody(avatar.toString()))
        val image = client.runtimeAvatar(OwnerBinding("owner", "space"), runtimeId, id)
        assertEquals("image/png", image.mime)
        assertContentEquals(java.util.Base64.getDecoder().decode(avatar["base64"]!!.jsonPrimitive.content), image.bytes)
        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/agents-one/mobile/v1/owners/owner/spaces/space/runtimes/$runtimeId/avatars/$id", request.path)
        assertEquals("Bearer device-token", request.getHeader("Authorization"))
        assertEquals("no-store", request.getHeader("Cache-Control"))
        assertNull(request.getHeader("Idempotency-Key")); assertNull(request.getHeader("If-Match"))
    }
    @Test fun `rejects wrong image identity mime size hash noncanonical base64 and unknown payload fields`() = server { server, client ->
        val corruptions = listOf(
            mapOf("id" to JsonPrimitive("other")), mapOf("runtimeId" to JsonPrimitive("other")),
            mapOf("mime" to JsonPrimitive("image/jpeg")), mapOf("sizeBytes" to JsonPrimitive(1)),
            mapOf("sha256" to JsonPrimitive("0".repeat(64))), mapOf("base64" to JsonPrimitive(avatar["base64"]!!.jsonPrimitive.content.dropLast(1))),
            mapOf("url" to JsonPrimitive("https://private/image")), mapOf("base64" to JsonPrimitive("not base64")),
        )
        for (fields in corruptions) {
            server.enqueue(MockResponse().addHeader("Content-Type", "application/json").setBody(JsonObject(avatar + fields).toString()))
            assertEquals("protocol_incompatible", assertFailsWith<MobileApiException> { client.runtimeAvatar(OwnerBinding("owner", "space"), runtimeId, id) }.code)
        }
        assertEquals(corruptions.size, server.requestCount)
    }
    @Test fun `bounds image JSON response and refuses redirects without a second request`() = server { server, client ->
        server.enqueue(MockResponse().addHeader("Content-Type", "application/json").setBody(" ".repeat(1024 * 1024 + 1)))
        assertEquals("payload_too_large", assertFailsWith<MobileApiException> { client.runtimeAvatar(OwnerBinding("owner", "space"), runtimeId, id) }.code)
        server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/private"))
        assertFailsWith<MobileApiException> { client.runtimeAvatar(OwnerBinding("owner", "space"), runtimeId, id) }
        assertEquals(2, server.requestCount)
        assertFailsWith<IllegalArgumentException> { client.runtimeAvatar(OwnerBinding("owner", "space"), "../other", id) }
        assertEquals(2, server.requestCount)
    }
}
