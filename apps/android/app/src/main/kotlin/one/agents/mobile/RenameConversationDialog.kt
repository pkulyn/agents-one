package one.agents.mobile

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import one.agents.mobile.contract.Conversation

@Composable internal fun RenameConversationDialog(model: MobileViewModel, conversation: Conversation, state: MobileState, close: () -> Unit) {
    var title by remember(conversation.id, conversation.revision) { mutableStateOf(conversation.title) }
    val value = title.trim()
    AlertDialog(onDismissRequest = close, modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(horizontal = 16.dp), properties = DialogProperties(usePlatformDefaultWidth = false),
        title = { Text(stringResource(R.string.rename_conversation)) },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) { OutlinedTextField(title, { title = it }, modifier = Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.title)) }, supportingText = { Text(stringResource(R.string.title_limit)) }, isError = value.codePointCount(0, value.length) > 160, maxLines = 3)
            state.error?.let { ErrorFeedback(translatedError(it), state.failureRequestId("global", it)) }
        } },
        confirmButton = { TextButton(onClick = { model.renameConversation(conversation, title, close) }, enabled = !state.busy && value.isNotBlank() && value.codePointCount(0, value.length) <= 160 && value != conversation.title) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = close) { Text(stringResource(R.string.cancel)) } })
}
