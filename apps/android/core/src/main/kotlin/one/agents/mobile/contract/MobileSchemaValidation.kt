package one.agents.mobile.contract

import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.serialization.json.*
import one.agents.mobile.net.MobileApiException

/** Validates the shared generated contract before a live event can change a view or cursor. */
fun validateMobileSchema(name: String, value: JsonElement) {
    val spec = mobileSchemaDefinitions[name] ?: throw MobileApiException("protocol_incompatible", 0)
    if (!matchesMobileSchema(spec.jsonObject, value)) throw MobileApiException("protocol_incompatible", 0)
}

fun supportedMobileEventType(type: String): Boolean = mobileSchemaDefinitions["EventType"]!!.jsonObject["enum"]!!.jsonArray.any { it.jsonPrimitive.content == type }

private fun matchesMobileSchema(spec: JsonObject, value: JsonElement): Boolean {
    fun number(name: String): Long? = spec[name]?.jsonPrimitive?.longOrNull
    spec["\$ref"]?.let { return matchesMobileSchema(mobileSchemaDefinitions[it.jsonPrimitive.content.substringAfterLast('/')]!!.jsonObject, value) }
    spec["anyOf"]?.let { return it.jsonArray.any { child -> matchesMobileSchema(child.jsonObject, value) } }
    spec["enum"]?.let { if (value !in it.jsonArray) return false }
    return when (spec["type"]?.jsonPrimitive?.content) {
        "null" -> value == JsonNull
        "boolean" -> value is JsonPrimitive && !value.isString && value.booleanOrNull != null
        "integer" -> {
            if (value !is JsonPrimitive || value.isString) false else {
                val integer = runCatching { value.content.toBigDecimal().longValueExact() }.getOrNull()
                integer != null && integer in -9007199254740991L..9007199254740991L && integer >= (number("minimum") ?: Long.MIN_VALUE) && integer <= (number("maximum") ?: Long.MAX_VALUE)
            }
        }
        "string" -> {
            if (value !is JsonPrimitive || !value.isString) false else {
                val text = value.content; val size = text.codePointCount(0, text.length).toLong()
                size >= (number("minLength") ?: 0) && size <= (number("maxLength") ?: Long.MAX_VALUE) &&
                    (spec["pattern"] == null || Regex(spec["pattern"]!!.jsonPrimitive.content).containsMatchIn(text)) &&
                    when (spec["format"]?.jsonPrimitive?.content) {
                        "utc-date-time" -> Regex("^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d{1,9})?Z$").matches(text) && runCatching { LocalDateTime.parse(text.removeSuffix("Z")) }.isSuccess
                        "iana-time-zone" -> runCatching { ZoneId.of(text) }.isSuccess
                        else -> true
                    }
            }
        }
        "array" -> value is JsonArray && value.size.toLong() >= (number("minItems") ?: 0) && value.size.toLong() <= (number("maxItems") ?: Long.MAX_VALUE) &&
            (spec["uniqueItems"]?.jsonPrimitive?.booleanOrNull != true || value.distinct().size == value.size) && value.all { matchesMobileSchema(spec["items"]!!.jsonObject, it) }
        "object" -> value is JsonObject && (spec["required"]?.jsonArray ?: JsonArray(emptyList())).all { it.jsonPrimitive.content in value } && value.all { (key, item) ->
            val child = spec["properties"]?.jsonObject?.get(key)
            if (child == null) spec["additionalProperties"]?.jsonPrimitive?.booleanOrNull != false else matchesMobileSchema(child.jsonObject, item)
        }
        else -> true
    }
}
