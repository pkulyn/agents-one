package one.agents.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import one.agents.mobile.contract.OwnerSpace

// @lat: [[mobile-data#Mobile data#Android visible original Owner and space]]
@Composable internal fun OwnerSpaceSelector(state: MobileState, select: (OwnerSpace) -> Unit, refresh: () -> Unit) {
    if (state.demo || (state.owner == null && !state.paired && state.owners.isEmpty())) return
    val current = state.owner
    var open by remember(current?.ownerId, current?.spaceId, current?.dataEpoch) { mutableStateOf(false) }
    val sources = (listOfNotNull(current) + state.owners).distinctBy { it.ownerId to it.spaceId }
    TextButton(onClick = { open = true }, enabled = !state.busy,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 8.dp).testTag("owner-space-selector")) {
        DawnRing()
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(current?.label ?: stringResource(R.string.choose_owner_space), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
            current?.let { Text(if (it.spaceId == "primary-space") stringResource(R.string.c_personal_space) else stringResource(R.string.current_space, it.spaceId), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Text("• ", style = MaterialTheme.typography.labelMedium)
        Text(stringResource(when { state.syncError != null || state.error == "owner_offline" -> R.string.connection_status_unknown; current == null -> R.string.no_source_selected; current.online -> R.string.online; else -> R.string.offline }), style = MaterialTheme.typography.labelMedium)
        Icon(Icons.Outlined.ArrowDropDown, stringResource(R.string.choose_owner_space), Modifier.padding(start = 8.dp))
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(stringResource(R.string.choose_owner_space)) },
        text = {
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                state.error?.let { code -> item { ErrorFeedback(translatedError(code), state.failureRequestId("global", code)) } }
                if (sources.isEmpty() && state.error == null) item { Text(stringResource(R.string.no_owner_spaces)) }
                items(sources, key = { it.ownerId to it.spaceId }) { source ->
                    TextButton(onClick = { open = false; select(source) }, enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("owner-space:${source.ownerId}:${source.spaceId}")) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(source.label, style = MaterialTheme.typography.bodyMedium)
                            Text(stringResource(R.string.source_owner_id, source.ownerId), style = MaterialTheme.typography.bodySmall)
                            Text(stringResource(R.string.current_space, source.spaceId), style = MaterialTheme.typography.bodySmall)
                            if (current?.ownerId == source.ownerId && current.spaceId == source.spaceId) Text(stringResource(R.string.selected_source), style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }, confirmButton = { TextButton(onClick = refresh, enabled = !state.busy) { Text(stringResource(R.string.refresh_owner_spaces)) } },
        dismissButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.close)) } })
}
