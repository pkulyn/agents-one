package one.agents.mobile

import android.graphics.Bitmap
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import java.io.ByteArrayOutputStream
import java.util.Base64
import kotlinx.coroutines.CompletableDeferred
import one.agents.mobile.contract.Runtime
import one.agents.mobile.net.RuntimeAvatarBytes
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RuntimeAvatarImageTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    private val png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII=")
    private val runtime = Runtime("runtime", "原智能体", "local", avatar = "ava-one", color = "#F37021", healthy = true, capabilities = emptyList(), allowedActions = listOf("read"))
    @Test fun originalPixelsDecodeAndLargeImagesAreDownsampledBeforeDisplay() {
        val decoded = decodeRuntimeAvatar(RuntimeAvatarBytes("image/png", png))!!
        assertEquals(2, decoded.width); assertEquals(Color.rgb(243,112,33), decoded.getPixel(0,0))
        val large = Bitmap.createBitmap(1024, 1024, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLUE) }
        val encoded = ByteArrayOutputStream().also { large.compress(Bitmap.CompressFormat.PNG,100,it) }.toByteArray()
        val sampled = decodeRuntimeAvatar(RuntimeAvatarBytes("image/png",encoded))!!
        assertTrue(sampled.width <= 256 && sampled.height <= 256 && sampled.allocationByteCount <= 262144)
        assertEquals(Color.BLUE, sampled.getPixel(0,0))
        assertNull(decodeRuntimeAvatar(RuntimeAvatarBytes("image/jpeg",png)))
        assertNull(decodeRuntimeAvatar(RuntimeAvatarBytes("image/png","broken".toByteArray())))
        assertNull(decodeRuntimeAvatar(RuntimeAvatarBytes("image/png", ByteArray(525001))))
        val huge = Bitmap.createBitmap(8193,1,Bitmap.Config.ARGB_8888)
        val hugeBytes = ByteArrayOutputStream().also { huge.compress(Bitmap.CompressFormat.PNG,100,it) }.toByteArray()
        assertNull(decodeRuntimeAvatar(RuntimeAvatarBytes("image/png",hugeBytes)))
    }
    @Test fun sourceChangeRemovesOriginalImageAndLateReadCannotOverwriteNewPlaceholder() {
        val source = mutableStateOf("old-owner")
        val pending = CompletableDeferred<Bitmap?>()
        ui.setContent { MaterialTheme { RuntimeAvatarImage(runtime, "fallback", source.value) { if (source.value == "old-owner") pending.await() else null } } }
        ui.onNodeWithTag("runtime-avatar-placeholder").assertIsDisplayed()
        ui.runOnIdle { source.value = "new-owner" }
        ui.runOnIdle { pending.complete(decodeRuntimeAvatar(RuntimeAvatarBytes("image/png",png))) }
        ui.waitForIdle()
        ui.onNodeWithTag("runtime-avatar-image").assertDoesNotExist()
        ui.onNodeWithTag("runtime-avatar-placeholder").assertIsDisplayed()
        ui.onNodeWithText("原").assertIsDisplayed()
    }
    @Test fun originalImageAppearsAndRemovedReferenceResetsToOriginalName() {
        val current = mutableStateOf(runtime)
        ui.setContent { MaterialTheme { RuntimeAvatarImage(current.value, "fallback", "owner") { decodeRuntimeAvatar(RuntimeAvatarBytes("image/png",png)) } } }
        ui.waitUntil(5000) { ui.onAllNodesWithTag("runtime-avatar-image").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("runtime-avatar-image").assertIsDisplayed()
        ui.runOnIdle { current.value = runtime.copy(avatar = null) }
        ui.onNodeWithTag("runtime-avatar-image").assertDoesNotExist()
        ui.onNodeWithText("原").assertIsDisplayed()
    }
}
