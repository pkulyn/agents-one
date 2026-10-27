package one.agents.mobile.contract

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import one.agents.mobile.net.EventCursor
import one.agents.mobile.net.StreamEvent

@Serializable
private data class LegacyBootstrap(
    val protocolVersion: String,
    val dataEpoch: String,
    val snapshotCursor: String,
)

class MobileContractCompatibilityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val compatibility by lazy {
        json.parseToJsonElement(
            File("../../../contracts/mobile-control/v1/fixtures.json").readText(),
        ).jsonObject["compatibility"]!!.jsonObject
    }
    private val objects by lazy {
        json.parseToJsonElement(
            File("../../../contracts/mobile-control/v1/fixtures.json").readText(),
        ).jsonObject["objects"]!!.jsonObject
    }

    @Test
    fun newerReaderAcceptsLegacyAndFeatureAwarePayloads() {
        val legacy = json.decodeFromJsonElement<Bootstrap>(compatibility["legacyBootstrap"]!!)
        assertNull(legacy.snapshotRevision)
        assertNull(legacy.protocolFeatures)

        val current = json.decodeFromJsonElement<Bootstrap>(compatibility["syncBootstrap"]!!)
        assertEquals("17", current.snapshotRevision)
        assertEquals(
            listOf("owner.sync-window.v1", "message.client-echo.v1"),
            current.protocolFeatures,
        )
        json.decodeFromJsonElement<Message>(compatibility["legacyUserMessage"]!!)
        assertEquals(
            "mobile-message-001",
            json.decodeFromJsonElement<Message>(compatibility["echoedUserMessage"]!!)
                .clientMessageId,
        )
    }

    @Test
    fun legacyReaderIgnoresNewOptionalBootstrapFields() {
        val legacy = json.decodeFromJsonElement<LegacyBootstrap>(compatibility["syncBootstrap"]!!)
        assertEquals("fixture-value", legacy.protocolVersion)
        assertEquals("fixture-value", legacy.dataEpoch)
        assertEquals("fixture-value", legacy.snapshotCursor)
    }

    @Test
    fun eventCursorAllowsFilteredSequenceGapsAndDeduplicatesReplays() {
        val base = objects["Event"]!!.jsonObject
        fun event(sequence: String): StreamEvent {
            val payload = JsonObject(
                base.toMutableMap().apply {
                    put("eventId", JsonPrimitive("fixture-value:$sequence"))
                    put("spaceChangeSeq", JsonPrimitive(sequence))
                    put("dataEpoch", JsonPrimitive("fixture-value"))
                    put("type", JsonPrimitive("conversation.updated"))
                    put(
                        "resourceRef",
                        JsonObject(
                            mapOf(
                                "type" to JsonPrimitive("conversation"),
                                "id" to JsonPrimitive("conversation-1"),
                            ),
                        ),
                    )
                },
            )
            return StreamEvent(
                id = "fixture-value:$sequence",
                type = "conversation.updated",
                data = payload.toString(),
            )
        }

        val cursor = EventCursor("fixture-value")
        val applied = mutableListOf<JsonObject>()
        assertNotNull(cursor.accept(event("4")) { applied.add(it); Unit })
        assertNotNull(cursor.accept(event("9")) { applied.add(it); Unit })
        assertNull(cursor.accept(event("9")) { applied.add(it); Unit })
        assertEquals(2, applied.size)
        assertEquals("fixture-value:9", cursor.lastEventId)
    }
}
