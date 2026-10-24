package one.agents.mobile

import android.content.Intent
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import one.agents.mobile.contract.Artifact

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class ArtifactDeliveryUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val artifact = Artifact("artifact-1", "run-1", "../../result.pdf", "application/pdf", 0, "0".repeat(64), allowedActions = listOf("read", "download"))
    @Test fun scopeAndOriginalActionAndBusyGateBothDeliveryButtons() {
        var saved = 0; var opened = 0
        fun show(scopes: List<String>, allowed: List<String>, busy: Boolean) { ui.runOnUiThread { ui.activity.setContent { MaterialTheme { ArtifactActions(artifact.copy(allowedActions = allowed), scopes, busy, { saved++ }, { opened++ }) } } } }
        show(listOf("conversation:read"), listOf("download"), false)
        ui.onNodeWithTag("artifact-save-artifact-1").assertDoesNotExist()
        show(listOf("artifact:read"), listOf("read"), false)
        ui.onNodeWithTag("artifact-open-artifact-1").assertDoesNotExist()
        show(listOf("artifact:read"), listOf("download"), true)
        ui.onNodeWithTag("artifact-save-artifact-1").assertIsNotEnabled()
        ui.onNodeWithTag("artifact-open-artifact-1").assertIsNotEnabled()
        show(listOf("artifact:read"), listOf("download"), false)
        ui.onNodeWithTag("artifact-save-artifact-1").performClick()
        ui.onNodeWithTag("artifact-open-artifact-1").performClick()
        assertEquals(1, saved); assertEquals(1, opened)
    }
    @Test fun verifiedFileUsesPrivateContentUriWithReadOnlyGrantAndRejectsStaleBinding() {
        val files = ArtifactFiles(ui.activity.cacheDir)
        val file = files.stage { }
        try {
            val prepared = PreparedArtifact(file, artifact) { true }
            // AndroidX FileProvider uses Android '/' path semantics; the Windows host uses '\\'.
            // Inspect its actual manifest/root config, and inject only URI creation for this host test.
            val provider = ui.activity.packageManager.resolveContentProvider("${ui.activity.packageName}.artifacts", android.content.pm.PackageManager.GET_META_DATA)!!
            assertFalse(provider.exported); assertTrue(provider.grantUriPermissions)
            val config = provider.loadXmlMetaData(ui.activity.packageManager, "android.support.FILE_PROVIDER_PATHS")!!
            val paths = mutableListOf<Pair<String, String?>>()
            config.use { while (it.next() != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) if (it.eventType == org.xmlpull.v1.XmlPullParser.START_TAG && it.name != "paths") paths.add(it.name to it.getAttributeValue(null, "path")) }
            assertEquals(listOf("cache-path" to "artifact-transfers/"), paths)
            val uri = android.net.Uri.parse("content://${ui.activity.packageName}.artifacts/verified-artifacts/${file.name}")
            val intent = artifactOpenIntent(ui.activity, prepared) { uri }
            assertEquals(Intent.ACTION_VIEW, intent.action)
            assertEquals("content", intent.data!!.scheme)
            assertEquals("${ui.activity.packageName}.artifacts", intent.data!!.authority)
            assertEquals("application/pdf", intent.type)
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, intent.flags)
            assertEquals(intent.data, intent.clipData!!.getItemAt(0).uri)
            try { artifactOpenIntent(ui.activity, prepared.copy(current = { false })); fail("Accepted old Owner binding") }
            catch (_: IllegalStateException) { }
            val save = CreateArtifactDocument().createIntent(ui.activity, prepared)
            assertEquals(Intent.ACTION_CREATE_DOCUMENT, save.action)
            assertEquals("result.pdf", save.getStringExtra(Intent.EXTRA_TITLE))
            assertTrue(Intent.CATEGORY_OPENABLE in save.categories)
        } finally { files.clear() }
    }
}
