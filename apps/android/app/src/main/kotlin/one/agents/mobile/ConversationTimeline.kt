package one.agents.mobile

import one.agents.mobile.contract.Message
import one.agents.mobile.contract.Run
import java.time.Instant

internal data class ConversationTimelineRow(val key: String, val message: Message? = null, val run: Run? = null, val pending: PendingUserMessage? = null)

/** Presentation only: original message order and identities remain untouched. */
internal fun conversationTimeline(messages: List<Message>, runs: List<Run>, pending: List<PendingUserMessage> = emptyList()): List<ConversationTimelineRow> {
    val rows = messages.map { ConversationTimelineRow(it.conversationId + ":" + it.messageSeq, message = it) }.toMutableList()
    for (message in pending.distinctBy { it.id }) {
        val after = message.afterMessageSeq.toBigIntegerOrNull()
        val index = if(after == null) -1 else rows.indexOfFirst { it.message?.messageSeq?.toBigIntegerOrNull()?.let { seq -> seq > after } == true }
        rows.add(if(index < 0) rows.size else index, ConversationTimelineRow("pending:" + message.id, pending = message))
    }
    fun instant(value: String?) = value?.let { runCatching { Instant.parse(it) }.getOrNull() }
    for (run in runs.distinctBy { it.runId }) {
        val start = instant(run.startedAt) ?: run.activity.orEmpty().mapNotNull { instant(it.createdAt) }.minOrNull()
        val exact = rows.indexOfFirst { it.message?.let { m -> m.kind == "assistant" && m.conversationId == run.conversationId && (m.runId == run.runId || (run.turnId != null && m.turnId == run.turnId)) } == true }
        val fallback = if (exact < 0 && start != null) rows.indexOfFirst { it.message?.let { m -> m.kind == "assistant" && m.conversationId == run.conversationId && m.runId == null && instant(m.createdAt)?.let { time -> time >= start } == true } == true } else -1
        val index = if (exact >= 0) exact else if (fallback >= 0) fallback else rows.size
        rows.add(index, ConversationTimelineRow("run:" + run.runId, run = run))
    }
    return rows
}
