package one.agents.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal val COrange = Color(0xFFF37021)
internal val CFont = FontFamily(androidx.compose.ui.text.font.Font(R.font.manrope_regular), androidx.compose.ui.text.font.Font(R.font.manrope_semibold, FontWeight.SemiBold))
internal val CTypography = Typography(
    headlineSmall = TextStyle(fontFamily = CFont, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 34.sp),
    titleLarge = TextStyle(fontFamily = CFont, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontFamily = CFont, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 23.sp),
    bodyLarge = TextStyle(fontFamily = CFont, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = CFont, fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontFamily = CFont, fontSize = 12.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = CFont, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = CFont, fontSize = 12.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontFamily = CFont, fontSize = 11.sp, lineHeight = 16.sp),
)
internal fun cTypography(language: String): Typography {
    if (!language.startsWith("zh", ignoreCase = true)) return CTypography
    fun serif(style: TextStyle) = style.copy(fontFamily = FontFamily.Serif)
    return CTypography.copy(
        displayLarge = serif(CTypography.displayLarge), displayMedium = serif(CTypography.displayMedium), displaySmall = serif(CTypography.displaySmall),
        headlineLarge = serif(CTypography.headlineLarge), headlineMedium = serif(CTypography.headlineMedium), headlineSmall = serif(CTypography.headlineSmall),
        titleLarge = serif(CTypography.titleLarge), titleMedium = serif(CTypography.titleMedium), titleSmall = serif(CTypography.titleSmall),
        bodyLarge = serif(CTypography.bodyLarge), bodyMedium = serif(CTypography.bodyMedium), bodySmall = serif(CTypography.bodySmall),
        labelLarge = serif(CTypography.labelLarge), labelMedium = serif(CTypography.labelMedium), labelSmall = serif(CTypography.labelSmall),
    )
}

@Composable internal fun DawnRing() {
    Box(Modifier.size(20.dp).background(Brush.sweepGradient(listOf(Color(0xFF6171FD), Color(0xFFC478B6), Color(0xFFFFCC76), Color(0xFF6171FD))), RoundedCornerShape(50)), contentAlignment = Alignment.Center) {
        Box(Modifier.size(13.dp).background(MaterialTheme.colorScheme.background, RoundedCornerShape(50)))
    }
}

@Composable internal fun CNavigation(selected: Int, select: (Int) -> Unit, labels: List<String>, icons: List<androidx.compose.ui.graphics.vector.ImageVector>) {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(Modifier.navigationBarsPadding()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(Modifier.fillMaxWidth().height(64.dp)) {
                labels.forEachIndexed { index, label ->
                    Column(Modifier.weight(1f).fillMaxHeight().clickable { select(index) }.padding(top = 7.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        val color = if (index == selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                        Box(Modifier.width(48.dp).height(30.dp).background(if (index == selected) Color(0xFFFFF0E4) else Color.Transparent, RoundedCornerShape(18.dp)), contentAlignment = Alignment.Center) {
                            Icon(icons[index], null, Modifier.size(21.dp), tint = color)
                        }
                        Text(label, style = MaterialTheme.typography.labelSmall, color = color, modifier = Modifier.padding(top = 3.dp))
                    }
                }
            }
        }
    }
}

@Composable internal fun CField(value: String, change: (String) -> Unit, label: String, modifier: Modifier = Modifier, minLines: Int = 1) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        TextField(value, change, Modifier.fillMaxWidth().testTag("field:" + label), minLines = minLines, shape = RoundedCornerShape(3.dp),
            colors = TextFieldDefaults.colors(focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer, unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                focusedIndicatorColor = COrange, unfocusedIndicatorColor = MaterialTheme.colorScheme.outlineVariant))
    }
}

@Composable internal fun CCategoryTabs(items: List<Pair<String, String>>, selected: String, choose: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        items.forEach { (id, label) ->
            Column(Modifier.clickable { choose(id) }.padding(vertical = 6.dp).testTag("category:" + id)) {
                Text(label, style = MaterialTheme.typography.labelLarge, color = if(id == selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(10.dp))
                Box(Modifier.width(24.dp).height(2.dp).background(if(id == selected) COrange else Color.Transparent))
            }
        }
    }
}
