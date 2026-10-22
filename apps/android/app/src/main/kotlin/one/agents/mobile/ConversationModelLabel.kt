package one.agents.mobile

/** Prefer actual model; enrich only when the catalog identifies that same model. */
internal fun conversationModelLabel(actual: String?, configured: String?): String? {
    val model = actual?.trim()?.takeIf { it.isNotEmpty() }
    val catalog = configured?.trim()?.takeIf { it.isNotEmpty() }
    if (model == null) return catalog
    if (!model.contains("/") && catalog?.substringAfter("/") == model) return catalog
    return model
}
