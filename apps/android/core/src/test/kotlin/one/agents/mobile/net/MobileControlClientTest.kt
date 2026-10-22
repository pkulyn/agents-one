package one.agents.mobile.net

import java.io.File
import java.net.InetAddress
import kotlin.test.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import one.agents.mobile.contract.*

class MobileControlClientTest {
    // @lat: [[mobile-mac-roadmap#Native preview checks#Dedicated read acknowledgement transport]]
    @Test fun `read acknowledgements use scoped authenticated POST with exact sequence and no business receipt headers`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().addHeader("Content-Type", "application/json").setBody("{\"conversationId\":\"original\",\"lastReadMessageSeq\":\"9007199254740993\"}"))
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            val client = MobileControlClient(server.url("/").newBuilder().host("127.0.0.1").build().toString(), { "test-token" }, true)
            client.markRead(OwnerBinding("owner", "space"), "original", "9007199254740993")
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/agents-one/mobile/v1/owners/owner/spaces/space/conversations/original/read", request.path)
            assertEquals("Bearer test-token", request.getHeader("Authorization"))
            assertEquals("{\"lastReadMessageSeq\":\"9007199254740993\"}", request.body.readUtf8())
            assertNull(request.getHeader("Idempotency-Key")); assertNull(request.getHeader("If-Match"))
            assertFailsWith<IllegalArgumentException> { client.markRead(OwnerBinding("owner", "space"), "original", "01") }
            assertEquals(1, server.requestCount)
            client.close()
        }
    }
    private val json = Json { ignoreUnknownKeys = true }
    @Test fun `golden fixtures decode and retain revisions beyond JavaScript precision`() {
        val root = json.parseToJsonElement(File("../../../contracts/mobile-control/v1/fixtures.json").readText()).jsonObject
        val fixture = root["objects"]!!.jsonObject
        root["errors"]!!.jsonArray.forEach { json.decodeFromJsonElement<ErrorEnvelope>(it) }
        val conversation = json.decodeFromJsonElement<Conversation>(fixture["Conversation"]!!)
        assertEquals("9007199254740993", conversation.revision)
        val withNull = JsonObject(fixture["Conversation"]!!.jsonObject + ("projectId" to JsonNull) + ("lastRunStatus" to JsonNull))
        assertNull(json.decodeFromJsonElement<Conversation>(withNull).projectId)
        json.decodeFromJsonElement<Bootstrap>(fixture["Bootstrap"]!!)
        json.decodeFromJsonElement<Run>(fixture["Run"]!!)
        json.decodeFromJsonElement<Schedule>(fixture["Schedule"]!!)
        json.decodeFromJsonElement<ScheduleExecution>(fixture["ScheduleExecution"]!!)
        json.decodeFromJsonElement<OperationReceipt>(fixture["OperationReceipt"]!!)
        json.decodeFromJsonElement<Artifact>(fixture["Artifact"]!!)
        json.decodeFromJsonElement<Message>(fixture["Message"]!!)
        json.decodeFromJsonElement<Snapshot>(fixture["Snapshot"]!!)
    }
    @Test fun `does not follow redirects with credentials or retry writes`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/steal"))
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            val client = MobileControlClient(server.url("/").newBuilder().host("127.0.0.1").build().toString(), { "test-token" }, true)
            assertFailsWith<MobileApiException> { client.write(OwnerBinding("owner", "space"), listOf("conversations"), buildJsonObject { put("title", "test") }, "mutation-1") }
            val request = server.takeRequest()
            assertEquals("Bearer test-token", request.getHeader("Authorization"))
            assertEquals("mutation-1", request.getHeader("Idempotency-Key"))
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun `production requires HTTPS and unambiguous origin`() {
        assertFailsWith<IllegalArgumentException> { MobileControlClient("http://example.com", { null }) }
        assertFailsWith<IllegalArgumentException> { MobileControlClient("https://user:secret@example.com/", { null }) }
        assertFailsWith<IllegalArgumentException> { MobileControlClient("https://example.com/arbitrary", { null }) }
        assertFailsWith<IllegalArgumentException> { OwnerBinding("../other", "space") }
    }
    @Test fun `PATCH JSON preserves explicit null and revision headers`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().addHeader("Content-Type", "application/json").setBody("{}")); server.start(InetAddress.getByName("127.0.0.1"), 0)
            val client = MobileControlClient(server.url("/").newBuilder().host("127.0.0.1").build().toString(), { "test-token" }, true)
            client.write(OwnerBinding("owner", "space"), listOf("conversations", "conversation-1"), buildJsonObject { put("projectId", JsonNull) }, "mutation-1", "9007199254740993", "PATCH")
            val request = server.takeRequest()
            assertEquals("\"9007199254740993\"", request.getHeader("If-Match"))
            assertEquals("{\"projectId\":null}", request.body.readUtf8())
        }
    }
    @Test fun `SSE handles comments multiline data duplicate events and epochs`() {
        val events = mutableListOf<StreamEvent>()
        val fixture = json.parseToJsonElement(File("../../../contracts/mobile-control/v1/fixtures.json").readText()).jsonObject["objects"]!!.jsonObject["Event"]!!.jsonObject
        val event = JsonObject(fixture + mapOf("eventId" to JsonPrimitive("epoch1:9007199254740993"), "dataEpoch" to JsonPrimitive("epoch1"), "spaceChangeSeq" to JsonPrimitive("9007199254740993")))
        val body = event.toString().replace(",\"", ",\ndata: \"")
        readSse(": heartbeat\nid: epoch1:9007199254740993\nevent: conversation.updated\ndata: $body\n\n".reader().buffered(), events::add)
        val cursor = EventCursor("epoch1")
        assertNotNull(cursor.accept(events.single()))
        assertNull(cursor.accept(events.single()))
        assertEquals("epoch1:9007199254740993", cursor.lastEventId)
        assertFailsWith<MobileApiException> { EventCursor("epoch2").accept(events.single()) }
    }
}
