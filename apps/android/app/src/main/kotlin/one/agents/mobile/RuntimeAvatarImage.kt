package one.agents.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import one.agents.mobile.contract.Runtime
import one.agents.mobile.net.RuntimeAvatarBytes

internal fun decodeRuntimeAvatar(value: RuntimeAvatarBytes): Bitmap? {
    if (value.bytes.size !in 1..525000) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(value.bytes, 0, value.bytes.size, bounds)
    if (bounds.outMimeType != value.mime || bounds.outWidth !in 1..8192 || bounds.outHeight !in 1..8192 || bounds.outWidth.toLong() * bounds.outHeight > 16_777_216) return null
    var sample = 1
    while ((maxOf(bounds.outWidth, bounds.outHeight) + sample - 1) / sample > 256) sample *= 2
    return BitmapFactory.decodeByteArray(value.bytes, 0, value.bytes.size, BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 })?.takeIf { it.width <= 256 && it.height <= 256 && it.allocationByteCount <= 256 * 256 * 4 }
}

@Composable internal fun RuntimeAvatarImage(runtime: Runtime?, fallbackName: String, source: Any?, modifier: Modifier = Modifier, loadEnabled: Boolean = true, load: suspend (Runtime) -> Bitmap?) {
    val identity = listOf(source, runtime?.id, runtime?.avatar)
    var bitmap by remember(identity) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(identity, loadEnabled) {
        if (!loadEnabled || bitmap != null) return@LaunchedEffect
        val current = runtime ?: return@LaunchedEffect
        if (current.avatar == null) return@LaunchedEffect
        try { bitmap = load(current) } catch (e: CancellationException) { throw e } catch (_: Exception) { bitmap = null }
    }
    val originalColor = runtime?.color?.takeIf { Regex("^#[a-fA-F0-9]{6}$").matches(it) }?.let { Color(android.graphics.Color.parseColor(it)) }
    Surface(modifier.size(30.dp), shape = RoundedCornerShape(4.dp), color = originalColor ?: MaterialTheme.colorScheme.surfaceContainer) {
        val image = bitmap
        if (image != null) Image(image.asImageBitmap(), null, Modifier.clip(RoundedCornerShape(4.dp)).testTag("runtime-avatar-image"), contentScale = ContentScale.Crop)
        else Box(contentAlignment = Alignment.Center, modifier = Modifier.testTag("runtime-avatar-placeholder")) { Text((runtime?.name ?: fallbackName).take(1), color = if (originalColor != null) { if (originalColor.luminance() > 0.45f) Color.Black else Color.White } else MaterialTheme.colorScheme.onSurface) }
    }
}
