package one.agents.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import one.agents.mobile.contract.Message

@Composable internal fun MessageBody(message: Message, sourceBinding: String?, modifier: Modifier = Modifier) {
    if (message.kind !in setOf("tool_summary", "progress")) { MessageMarkdown(message.content, modifier); return }
    ActivityDisclosure(stringResource(if(message.kind == "tool_summary") R.string.tool_summary else R.string.ui_thinking), false, tools = message.kind == "tool_summary", binding = listOf(sourceBinding, message.conversationId, message.id, message.messageSeq), modifier = modifier) {
        MessageMarkdown(message.content, Modifier.fillMaxWidth())
    }
}
