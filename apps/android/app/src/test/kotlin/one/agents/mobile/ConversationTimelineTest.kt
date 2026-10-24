package one.agents.mobile

import one.agents.mobile.contract.*
import org.junit.Test
import org.junit.Assert.*

class ConversationTimelineTest {
    private fun message(seq: String, kind: String, run: String? = null, time: String = "2026-10-15T08:00:00Z") = Message(id = "m" + seq, conversationId = "c", messageSeq = seq, kind = kind, runId = run, content = kind, visibleToUser = true, createdAt = time)
    private fun run(id: String, time: String = "2026-10-15T08:00:00Z") = Run(id, conversationId = "c", runtimeId = "r", status = "succeeded", startedAt = time, lastRunEventSeq = "1", artifacts = emptyList(), allowedActions = listOf("read"))
    @Test fun exactRunsPrecedeTheirOwnAnswersWithoutChangingMessageOrder() {
        val messages = listOf(message("1","user"),message("2","assistant","r1"),message("3","user"),message("4","assistant","r2"))
        val rows = conversationTimeline(messages,listOf(run("r2"),run("r1"),run("r1")))
        assertEquals(listOf("c:1","run:r1","c:2","c:3","run:r2","c:4"),rows.map { it.key })
        assertEquals(messages,rows.mapNotNull { it.message })
    }
    @Test fun missingLegacyRunLinksUseTimestampAndDoNotStealOtherRunAnswer() {
        val messages = listOf(message("1","user"),message("2","assistant","old"),message("3","user",time="2026-10-15T08:01:00Z"),message("4","assistant",time="2026-10-15T08:01:01Z"))
        val rows = conversationTimeline(messages,listOf(run("new","2026-10-15T08:01:00Z")))
        assertEquals(3, rows.indexOfFirst { it.run != null })
        assertEquals("4",rows[4].message?.messageSeq)
    }
    @Test fun pendingInputStaysBeforeLiveActivityAndHasSeparateIdentity() {
        val pending = PendingUserMessage("local-1","c","2","Next input","2026-10-15T08:01:00Z","accepted")
        val rows = conversationTimeline(listOf(message("1","user"),message("2","assistant","old")),listOf(run("active").copy(status="running")),listOf(pending))
        assertEquals(listOf("c:1","c:2","pending:local-1","run:active"),rows.map { it.key })
        assertSame(pending,rows[2].pending)
    }
}
