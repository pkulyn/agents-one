package one.agents.mobile

import org.junit.Test
import org.junit.Assert.*

class ConversationModelLabelTest {
    @Test fun onlyMatchingCatalogCanQualifyActualModel() {
        assertEquals("opencode/big-pickle", conversationModelLabel("big-pickle", "opencode/big-pickle"))
        assertEquals("ark/deepseek", conversationModelLabel("ark/deepseek", "opencode/big-pickle"))
        assertEquals("other-model", conversationModelLabel("other-model", "opencode/big-pickle"))
        assertEquals("opencode/big-pickle", conversationModelLabel(null, "opencode/big-pickle"))
        assertNull(conversationModelLabel(null, null))
    }
}
