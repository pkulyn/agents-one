package one.agents.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import one.agents.mobile.contract.Message

@Composable internal fun MessageBody(message: Message, sourceBinding: String?, modifier: Modifier = Modifier) {
    if (message.kind != "tool_summary") { MessageMarkdown(message.content, modifier); return }
    var expanded by remember(sourceBinding, message.conversationId, message.id, message.messageSeq) { mutableStateOf(false) }
    Column(modifier) {
        Text(stringResource(R.string.tool_summary), style = MaterialTheme.typography.labelLarge)
        TextButton(onClick = { expanded = !expanded }) { Text(stringResource(if (expanded) R.string.collapse_tool else R.string.expand_tool)) }
        if (expanded) MessageMarkdown(message.content, Modifier.fillMaxWidth())
    }
}
