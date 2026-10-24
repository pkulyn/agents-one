package one.agents.mobile.contract

import java.io.File
import kotlin.test.*
import kotlinx.serialization.json.*
import one.agents.mobile.net.*

class MobileSchemaValidationTest {
    private val objects = Json.parseToJsonElement(File("../../../contracts/mobile-control/v1/fixtures.json").readText()).jsonObject["objects"]!!.jsonObject
    @Test fun `desktop task modes validate separately from strict legacy sandbox policies`() {
        val policy = objects["ExecutionPolicy"]!!.jsonObject
        for (mode in listOf("inspect", "project_write", "desktop_analysis", "desktop_execute")) {
            val value = JsonObject(policy + ("mode" to JsonPrimitive(mode)))
            validateMobileSchema("ExecutionPolicy", value)
            assertEquals(mode, Json.decodeFromJsonElement<ExecutionPolicy>(value).mode)
        }
        assertFailsWith<MobileApiException> { validateMobileSchema("ExecutionPolicy", JsonObject(policy + ("mode" to JsonPrimitive("invented_mode")))) }
    }
    @Test fun `all shared response fixtures validate and malformed revisions states identities and timestamps fail`() {
        objects.forEach { (name, value) -> validateMobileSchema(name, value) }
        val conversation = objects["Conversation"]!!.jsonObject
        listOf("revision" to JsonPrimitive("01"), "activity" to JsonPrimitive("fake"), "id" to JsonPrimitive("../other"), "createdAt" to JsonPrimitive("2026-02-30T00:00:00Z"), "pinned" to JsonPrimitive("false"), "allowedActions" to buildJsonArray { add("read"); add("read") }).forEach { (key, value) ->
            assertFailsWith<MobileApiException> { validateMobileSchema("Conversation", JsonObject(conversation + (key to value))) }
        }
        validateMobileSchema("Conversation", JsonObject(conversation + ("futureField" to JsonPrimitive("preserved extension"))))
        val message = objects["MessageUpsert"]!!.jsonObject
        validateMobileSchema("MessageUpsert", JsonObject(message + ("id" to JsonPrimitive("-123"))))
        assertFailsWith<MobileApiException> { validateMobileSchema("MessageUpsert", JsonObject(message - "messageRevision")) }
        val deletion = buildJsonObject { put("kind", "message"); put("id", "-123"); put("conversationId", "original") }
        validateMobileSchema("ResourceDeletion", deletion)
        assertFailsWith<MobileApiException> { validateMobileSchema("ResourceDeletion", JsonObject(deletion - "conversationId")) }
    }
    @Test fun `cursor remains unchanged after invalid envelope identity payload or failed application`() {
        val original = objects["Event"]!!.jsonObject
        fun event(changes: Map<String, JsonElement> = emptyMap()) = JsonObject(original + mapOf("eventId" to JsonPrimitive("epoch:9007199254740993"), "dataEpoch" to JsonPrimitive("epoch"), "spaceChangeSeq" to JsonPrimitive("9007199254740993")) + changes)
        val cursor = EventCursor("epoch")
        fun frame(value: JsonObject) = StreamEvent(value["eventId"]!!.jsonPrimitive.content, "conversation.updated", value.toString())
        listOf(event(mapOf("eventId" to JsonPrimitive("unbound"))), event(mapOf("payload" to JsonObject(emptyMap()))), event(mapOf("resourceRevision" to JsonPrimitive("invalid")))).forEach { value -> assertFailsWith<MobileApiException> { cursor.accept(frame(value)) }; assertNull(cursor.lastEventId) }
        assertFailsWith<MobileApiException> { cursor.accept(frame(event())) { throw MobileApiException("protocol_incompatible", 0) } }
        assertNull(cursor.lastEventId)
        val future = event(mapOf("type" to JsonPrimitive("future.updated")))
        assertEquals("cursor_expired", assertFailsWith<MobileApiException> { cursor.accept(StreamEvent(future["eventId"]!!.jsonPrimitive.content, "future.updated", future.toString())) }.code)
        assertNull(cursor.lastEventId)
        var applied = 0; assertNotNull(cursor.accept(frame(event())) { applied++ }); assertNull(cursor.accept(frame(event())) { applied++ })
        assertEquals(1, applied); assertEquals("epoch:9007199254740993", cursor.lastEventId)
    }
}
