package one.agents.mobile

import one.agents.mobile.contract.Conversation
import one.agents.mobile.contract.ScheduleSummary
import kotlinx.serialization.json.*

data class MobileListSelection(val projectId: String? = null, val state: String = "all", val archived: Boolean = false) {
    fun matches(row: Conversation): Boolean = row.archived == archived && (projectId == null || row.projectId == projectId) && (state == "all" || row.activity == if (state == "attention") "needs_attention" else state)
    fun matches(row: ScheduleSummary): Boolean = (projectId == null || row.projectId == projectId) && (state == "all" || row.effectiveState == state)
    fun arguments(schedules: Boolean): JsonObject = buildJsonObject {
        projectId?.let { put("projectId", it) }
        if (state != "all") put("state", state)
        if (!schedules && archived) put("archived", true)
    }
}
internal fun conversationUnread(row: Conversation): Boolean = row.lastMessageSeq.toBigInteger() > row.lastReadMessageSeq.toBigInteger()
