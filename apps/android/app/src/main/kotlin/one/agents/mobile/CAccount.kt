package one.agents.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun CAccount(model: MobileViewModel, state: MobileState) {
    var panel by remember { mutableStateOf<String?>(null) }
    var endpoint by remember { mutableStateOf(model.preferences.endpoint) }
    var computerName by remember(state.owner?.ownerId, state.computerLabel) { mutableStateOf(state.computerLabel.ifBlank { state.owner?.label.orEmpty() }) }
    var invitation by remember { mutableStateOf("") }
    val defaultLabel = state.deviceLabel.ifBlank { android.os.Build.MODEL }
    var deviceLabel by remember(defaultLabel) { mutableStateOf(defaultLabel) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.c_connection_device), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider(thickness = 2.dp, color = MaterialTheme.colorScheme.onSurface)
        Row(Modifier.clickable(enabled = state.owner != null) { panel = "computer-name" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.secondaryContainer) { Icon(Icons.Outlined.DesktopWindows, null, Modifier.padding(14.dp), tint = MaterialTheme.colorScheme.primary) }
            Column(Modifier.weight(1f)) { Text(state.computerLabel.ifBlank { state.owner?.label ?: stringResource(R.string.owner_required) }, style = MaterialTheme.typography.titleMedium); Text(state.owner?.platform?.let { when(it) { "windows" -> "Windows"; "mac" -> "macOS"; else -> "Linux" } } ?: stringResource(R.string.ui_system_unknown), style = MaterialTheme.typography.bodySmall) }
            Text("• " + stringResource(if (state.owner?.online == true && state.error != "owner_offline" && state.syncError == null) R.string.online else R.string.offline), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        }
        HorizontalDivider()
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) { Text(stringResource(R.string.c_saved_at), style = MaterialTheme.typography.labelSmall); Text(state.computerLabel.ifBlank { state.owner?.label ?: "—" }, style = MaterialTheme.typography.labelLarge) }
            Column(Modifier.weight(1f)) { Text(stringResource(R.string.c_current_device), style = MaterialTheme.typography.labelSmall); Text(deviceLabel, style = MaterialTheme.typography.labelLarge) }
            Column(Modifier.weight(1f)) { Text(stringResource(R.string.c_connection), style = MaterialTheme.typography.labelSmall); Text(stringResource(R.string.c_remote), style = MaterialTheme.typography.labelLarge) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(shape = RoundedCornerShape(3.dp), onClick = { panel = "owners" }, modifier = Modifier.weight(1f), enabled = !state.busy) { Text(stringResource(R.string.choose_owner_space)) }
            OutlinedButton(shape = RoundedCornerShape(3.dp), onClick = model::refreshConnection, modifier = Modifier.weight(1f), enabled = !state.busy) { Icon(Icons.Outlined.Wifi, null, Modifier.size(16.dp)); Text(stringResource(R.string.refresh)) }
        }
        if (!state.paired) {
            CField(endpoint, { endpoint = it }, stringResource(R.string.endpoint))
            CField(invitation, { invitation = it }, stringResource(R.string.invitation), minLines = 2)
            CField(deviceLabel, { deviceLabel = it }, stringResource(R.string.device_label))
            Button(shape = RoundedCornerShape(3.dp), colors = ButtonDefaults.buttonColors(containerColor = COrange, contentColor = androidx.compose.ui.graphics.Color(0xFF242724)), onClick = { model.pair(endpoint, invitation, deviceLabel) }, enabled = endpoint.isNotBlank() && invitation.isNotBlank() && deviceLabel.isNotBlank() && !state.busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.pair)) }
            state.claim?.let { Text(stringResource(R.string.pair_wait)); Text(stringResource(R.string.verification_phrase, it.verificationPhrase)); TextButton(onClick = model::cancelPairing) { Text(stringResource(R.string.cancel)) } }
        }
        HorizontalDivider()
        Text(stringResource(R.string.c_device_auth), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        CAccountRow(Icons.Outlined.VerifiedUser, stringResource(R.string.c_device_permission), stringResource(if(state.paired) R.string.c_paired else R.string.pair)) { panel = "permission" }
        CAccountRow(Icons.Outlined.Devices, stringResource(R.string.c_paired_device), state.computerLabel.ifBlank { state.owner?.label ?: "—" }) { panel = "owners" }
        CAccountRow(Icons.Outlined.Inventory2, stringResource(R.string.c_privacy), stringResource(R.string.c_no_tasks)) { panel = "privacy" }
        Text(stringResource(R.string.c_preferences), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        CAccountRow(Icons.Outlined.LightMode, stringResource(R.string.appearance), stringResource(when(state.appearance) { "light" -> R.string.appearance_light; "dark" -> R.string.appearance_dark; else -> R.string.appearance_system })) { panel = "appearance" }
        CAccountRow(Icons.Outlined.Translate, stringResource(R.string.language), stringResource(if (state.language == "en") R.string.language_en else R.string.language_zh)) { panel = "language" }
        CAccountRow(Icons.Outlined.ReceiptLong, stringResource(R.string.operations), state.operations.size.toString()) { panel = "operations" }
        TextButton(onClick = model::forget) { Text(stringResource(R.string.disconnect)) }
        if (BuildConfig.DEBUG && !state.paired) TextButton(onClick = model::demo, enabled = !state.busy) { Text(stringResource(R.string.demo)) }
    }
    panel?.let { page ->
        ModalBottomSheet(onDismissRequest = { panel = null }, containerColor = MaterialTheme.colorScheme.background, shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)) {
            Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState())) {
                Text(stringResource(when(page) { "language" -> R.string.language; "appearance" -> R.string.appearance; "privacy" -> R.string.c_privacy; "permission" -> R.string.c_device_permission; "operations" -> R.string.operations; "computer-name" -> R.string.ui_computer_name; else -> R.string.choose_owner_space }), style = MaterialTheme.typography.titleLarge)
                when(page) {
                    "computer-name" -> { CField(computerName, { computerName = it }, stringResource(R.string.ui_computer_name)); TextButton(onClick = { model.renameComputer(computerName); panel = null }, enabled = computerName.isNotBlank()) { Text(stringResource(R.string.save)) } }
                    "language" -> listOf("zh-CN" to R.string.language_zh, "en" to R.string.language_en).forEach { (value, label) -> CAccountRow(Icons.Outlined.Translate, stringResource(label), if (state.language == value) "✓" else "") { model.language(value); panel = null } }
                    "appearance" -> AppearanceSelector(state.appearance, model::appearance)
                    "privacy" -> Text(stringResource(R.string.c_privacy_body))
                    "permission" -> { Text(stringResource(R.string.device_paired)); if (state.paired) TextButton(onClick = { model.revoke(); panel = null }, enabled = !state.busy) { Text(stringResource(R.string.revoke)) } }
                    "operations" -> { Text(stringResource(R.string.accepted_hint)); state.operationsError?.let { ErrorFeedback(stringResource(R.string.receipt_refresh_failed), state.failureTraces["operations"]?.requestId) }; TextButton(onClick = model::refreshOperations, enabled = !state.busy) { Text(stringResource(R.string.refresh_receipts)) }; state.operations.take(20).forEach { Text(it.operationId + " · " + translatedState(it.status), style = MaterialTheme.typography.bodySmall) } }
                    else -> state.owners.forEach { owner -> TextButton(modifier = Modifier.testTag("owner-space:${owner.ownerId}:${owner.spaceId}"), onClick = { model.selectOwner(owner); panel = null }, enabled = !state.busy) { Text(owner.label + " · " + stringResource(if(owner.online) R.string.online else R.string.offline)) } }
                }
                TextButton(onClick = { panel = null }) { Text(stringResource(R.string.close)) }
            }
        }
    }
}

@Composable private fun CAccountRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String, click: () -> Unit) {
    Column {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(onClick = click), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Text(value, modifier = Modifier.widthIn(max = 110.dp), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(Icons.Outlined.ChevronRight, null, Modifier.size(16.dp))
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}
