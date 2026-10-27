package one.agents.mobile

import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import one.agents.mobile.contract.Artifact

internal class CreateArtifactDocument : ActivityResultContract<PreparedArtifact, Uri?>() {
    override fun createIntent(context: android.content.Context, input: PreparedArtifact) = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE).setType(input.metadata.mime).putExtra(Intent.EXTRA_TITLE, artifactDisplayName(input.metadata.name))
    override fun parseResult(resultCode: Int, intent: Intent?): Uri? = if (resultCode == android.app.Activity.RESULT_OK) intent?.data else null
}

internal fun artifactOpenIntent(context: android.content.Context, file: PreparedArtifact,
    uriForFile: () -> Uri = { FileProvider.getUriForFile(context, "${context.packageName}.artifacts", file.file) }): Intent {
    check(file.current())
    val uri = uriForFile()
    return Intent(Intent.ACTION_VIEW).setDataAndType(uri, file.metadata.mime)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).apply { clipData = android.content.ClipData.newRawUri("Artifact", uri) }
}

@Composable internal fun ArtifactActions(artifact: Artifact, capabilities: List<String>, busy: Boolean, save: () -> Unit, open: () -> Unit) {
    if ("artifact:read" !in capabilities || "download" !in artifact.allowedActions) return
    Row {
        TextButton(onClick = save, enabled = !busy, modifier = Modifier.testTag("artifact-save-${artifact.id}")) { Text(stringResource(R.string.artifact_save)) }
        TextButton(onClick = open, enabled = !busy, modifier = Modifier.testTag("artifact-open-${artifact.id}")) { Text(stringResource(R.string.artifact_open)) }
    }
}

@Composable internal fun ArtifactDelivery(model: MobileViewModel, state: MobileState, artifact: Artifact) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<PreparedArtifact?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var publishing by remember { mutableStateOf(false) }
    fun release(file: PreparedArtifact?) {
        file?.let {
            runCatching { context.revokeUriPermission(FileProvider.getUriForFile(context, "${context.packageName}.artifacts", it.file), Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            model.discardArtifact(it)
        }
        if (pending === file) pending = null
    }
    val viewer = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { release(pending) }
    val document = rememberLauncherForActivityResult(CreateArtifactDocument()) { uri ->
        val file = pending
        if (file != null) scope.launch {
            publishing = true
            var committed = false
            try {
                if (uri != null && file.current()) {
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri, "wt")?.use { output -> file.file.inputStream().use { it.copyTo(output) } }
                            ?: throw java.io.IOException("Document unavailable")
                    }
                    if (!file.current()) throw java.io.IOException("Artifact binding changed")
                    committed = true
                }
            } catch (_: Exception) { error = "request_failed" }
            finally {
                if (uri != null && !committed) runCatching { DocumentsContract.deleteDocument(context.contentResolver, uri) }
                release(file); publishing = false
            }
        } else if (uri != null) runCatching { DocumentsContract.deleteDocument(context.contentResolver, uri) }
    }
    DisposableEffect(model, artifact.id) { onDispose { release(pending) } }
    fun prepare(open: Boolean) {
        error = null
        model.prepareArtifact(artifact) { file ->
            if (!file.current()) { release(file); return@prepareArtifact }
            pending = file
            try {
                if (open) {
                    viewer.launch(artifactOpenIntent(context, file))
                } else document.launch(file)
            } catch (_: android.content.ActivityNotFoundException) { error = "artifact_viewer_missing"; release(file) }
            catch (_: Exception) { error = "request_failed"; release(file) }
        }
    }
    ArtifactActions(artifact, state.owner?.capabilities ?: emptyList(), state.busy || publishing || pending != null, { prepare(false) }, { prepare(true) })
    error?.let { Text(translatedError(it)) }
}
