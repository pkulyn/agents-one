package one.agents.mobile.net

import java.io.BufferedReader
import java.math.BigInteger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import one.agents.mobile.contract.validateMobileSchema
import one.agents.mobile.contract.supportedMobileEventType

data class StreamEvent(val id: String, val type: String?, val data: String)

/** Parses multiline data and comments, with a finite frame limit. Never logs payloads. */
fun readSse(reader: BufferedReader, consume: (StreamEvent) -> Unit) {
    var id = ""; var type: String? = null; val data = StringBuilder(); var size = 0
    while (true) {
        val line = boundedLine(reader) ?: break
        size += line.toByteArray(Charsets.UTF_8).size + 1
        if (size > 1_048_576) throw MobileApiException("payload_too_large", 0)
        if (line.isEmpty()) {
            if (data.isNotEmpty()) consume(StreamEvent(id, type, data.toString().removeSuffix("\n")))
            type = null; data.clear(); size = 0; continue
        }
        if (line.startsWith(':')) continue
        val field = line.substringBefore(':'); val value = line.substringAfter(':', "").removePrefix(" ")
        when (field) { "id" -> if (!value.contains('\u0000')) id = value; "event" -> type = value; "data" -> data.append(value).append('\n') }
    }
}
private fun boundedLine(reader: BufferedReader): String? {
    val line = StringBuilder()
    while (true) {
        val value = reader.read()
        if (value < 0) return if (line.isEmpty()) null else line.toString()
        if (value == '\n'.code) return line.toString().removeSuffix("\r")
        if (value == '\r'.code) {
            reader.mark(1)
            if (reader.read() != '\n'.code) reader.reset()
            return line.toString()
        }
        if (line.length >= 1_048_576) throw MobileApiException("payload_too_large", 0)
        line.append(value.toChar())
    }
}

/** Scoped and epoch-bound in-memory cursor; refresh uses snapshots after 410. */
class EventCursor(private val epoch: String) {
    var lastEventId: String? = null; private set
    private var lastSequence = BigInteger.valueOf(-1)
    fun accept(event: StreamEvent, apply: (JsonObject) -> Unit = {}): JsonObject? {
        val payload = try { Json.parseToJsonElement(event.data).jsonObject } catch (_: Exception) { throw MobileApiException("protocol_incompatible", 0) }
        fun field(name: String): String {
            val primitive = payload[name] as? kotlinx.serialization.json.JsonPrimitive
            if (primitive == null || !primitive.isString) throw MobileApiException("protocol_incompatible", 0)
            return primitive.content
        }
        if (field("dataEpoch") != epoch) throw MobileApiException("cursor_expired", 410)
        if (!supportedMobileEventType(field("type"))) throw MobileApiException("cursor_expired", 410)
        validateMobileSchema("Event", payload)
        val value = field("spaceChangeSeq")
        if (!Regex("^(0|[1-9][0-9]{0,63})$").matches(value)) throw MobileApiException("protocol_incompatible", 0)
        val sequence = value.toBigInteger()
        if (sequence <= lastSequence) return null
        val eventId = field("eventId")
        if (eventId != "$epoch:$value") throw MobileApiException("protocol_incompatible", 0)
        if (event.id.isNotEmpty() && event.id != eventId) throw MobileApiException("protocol_incompatible", 0)
        if (event.type != null && event.type != field("type")) throw MobileApiException("protocol_incompatible", 0)
        apply(payload)
        lastSequence = sequence; lastEventId = eventId
        return payload
    }
}
