package one.agents.mobile.net

import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.SocketPolicy

class EventTransportTest {
    private fun client(server: MockWebServer) = MobileControlClient(server.url("/").newBuilder().host("127.0.0.1").build().toString(), { "test-token" }, true)
    // @lat: [[mobile-mac-roadmap#Native preview checks#Authenticated SSE transport]]
    @Test fun `real SSE request preserves scoped origin resume headers multiline payload and reports EOF without retries`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().addHeader("Content-Type", "text/event-stream; charset=utf-8").setBody(": heartbeat\r\nid: epoch:1\r\nevent: owner.status\r\ndata: {\"first\":true,\r\ndata: \"second\":true}\r\n\r\n"))
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            val api = client(server); val events = CopyOnWriteArrayList<StreamEvent>(); val failures = CopyOnWriteArrayList<MobileApiException>(); val done = CountDownLatch(1)
            val ready = CountDownLatch(1)
            val subscription = api.streamEvents(OwnerBinding("owner", "space"), "signed-cursor", "epoch:0", { events.add(it) }, { failures.add(it); done.countDown() }, { ready.countDown() })
            assertTrue(done.await(5, TimeUnit.SECONDS))
            assertEquals(0L, ready.count)
            val request = server.takeRequest()
            assertEquals("/agents-one/mobile/v1/owners/owner/spaces/space/events?cursor=signed-cursor", request.path)
            assertEquals("Bearer test-token", request.getHeader("Authorization")); assertEquals("epoch:0", request.getHeader("Last-Event-ID"))
            assertEquals("text/event-stream", request.getHeader("Accept")); assertEquals(1, server.requestCount)
            assertEquals("epoch:1", events.single().id); assertEquals("owner.status", events.single().type)
            assertEquals("{\"first\":true,\n\"second\":true}", events.single().data); assertEquals("owner_offline", failures.single().code)
            subscription.close(); api.close()
        }
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#SSE cancellation lifecycle]]
    @Test fun `closing idle SSE cancels without delivering errors or events`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)); server.start(InetAddress.getByName("127.0.0.1"), 0)
            val api = client(server); val callback = CountDownLatch(1)
            val subscription = api.streamEvents(OwnerBinding("owner", "space"), consume = { callback.countDown() }, failed = { callback.countDown() }, opened = { callback.countDown() })
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS)); subscription.close(); subscription.close()
            assertFalse(callback.await(200, TimeUnit.MILLISECONDS)); api.close()
        }
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#SSE errors and redirect isolation]]
    @Test fun `SSE surfaces 410 and refuses redirects or JSON success without replaying requests`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(410).setBody("{\"error\":{\"code\":\"cursor_expired\",\"message\":\"expired\",\"requestId\":\"request-1\",\"retryable\":false}}"))
            server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/steal"))
            server.enqueue(MockResponse().addHeader("Content-Type", "application/json").setBody("{}"))
            server.start(InetAddress.getByName("127.0.0.1"), 0); val api = client(server)
            val codes = mutableListOf<String>()
            repeat(3) { val done = CountDownLatch(1); val errors = CopyOnWriteArrayList<String>()
                val subscription = api.streamEvents(OwnerBinding("owner", "space"), consume = { error("No SSE event expected") }, failed = { errors.add(it.code); done.countDown() })
                assertTrue(done.await(5, TimeUnit.SECONDS)); codes.add(errors.single()); subscription.close()
            }
            assertEquals(listOf("cursor_expired", "request_failed", "protocol_incompatible"), codes)
            assertEquals(3, server.requestCount); api.close()
        }
    }
    // @lat: [[mobile-mac-roadmap#Native preview checks#SSE bounded frame parsing]]
    @Test fun `oversized line and multibyte frame are rejected while CR framing is retained`() {
        val tooLong = "data: " + "a".repeat(1_048_576)
        assertEquals("payload_too_large", assertFailsWith<MobileApiException> { readSse(tooLong.reader().buffered()) {} }.code)
        assertEquals("payload_too_large", assertFailsWith<MobileApiException> { readSse(("data: " + "中".repeat(400000) + "\n\n").reader().buffered()) {} }.code)
        val events = mutableListOf<StreamEvent>(); readSse("id: epoch:1\revent: owner.status\rdata: {}\r\r".reader().buffered(), events::add)
        assertEquals("epoch:1", events.single().id)
    }
}
