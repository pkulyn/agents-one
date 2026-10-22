package one.agents.mobile

import org.junit.Test
import org.junit.Assert.*

class ConversationModelLabelTest {
    // @lat: [[mobile-data#Mobile data#Actual model qualified catalog display]]
    @Test fun onlyMatchingCatalogCanQualifyActualModel() {
        assertEquals("opencode/big-pickle", conversationModelLabel("big-pickle", "opencode/big-pickle"))
        assertEquals("ark/deepseek", conversationModelLabel("ark/deepseek", "opencode/big-pickle"))
        assertEquals("other-model", conversationModelLabel("other-model", "opencode/big-pickle"))
        assertEquals("opencode/big-pickle", conversationModelLabel(null, "opencode/big-pickle"))
        assertNull(conversationModelLabel(null, null))
    }
}
