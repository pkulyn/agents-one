package one.agents.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

internal fun appearanceIsDark(appearance: String, systemDark: Boolean): Boolean = when (appearance) {
    "light" -> false
    "dark" -> true
    else -> systemDark
}

@Composable internal fun AppearanceSelector(value: String, choose: (String) -> Unit) {
    Text(stringResource(R.string.appearance), style = MaterialTheme.typography.titleMedium)
    listOf("system" to R.string.appearance_system, "light" to R.string.appearance_light, "dark" to R.string.appearance_dark).forEach { (option, label) ->
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { choose(option) }) {
            RadioButton(value == option, { choose(option) })
            Text(stringResource(label), Modifier.padding(top = 12.dp))
        }
    }
}
