package one.agents.mobile

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.view.KeyEvent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Locale

/** Run on a dedicated, unpaired debug installation; never disconnect a user's device. */
@RunWith(AndroidJUnit4::class)
class MobileDeviceSmokeTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private lateinit var model: MobileViewModel
    private var originalLanguage: String? = null
    private var originalOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    @Before fun prepare() {
        ui.runOnUiThread {
            model = ViewModelProvider(ui.activity)[MobileViewModel::class.java]
            check(!model.state.value.paired && model.state.value.owner == null) {
                "Use a dedicated unpaired debug installation for device smoke tests"
            }
            originalLanguage = model.state.value.language
            originalOrientation = ui.activity.requestedOrientation
            model.language("en")
        }
        ui.waitForIdle()
        openAccount()
    }

    @After fun restore() {
        originalLanguage?.let { language ->
            ui.runOnUiThread {
                model.language(language)
                ui.activity.requestedOrientation = originalOrientation
            }
        }
    }

    private fun openAccount() {
        ui.onNode(hasText("Account") and hasClickAction()).performClick()
        ui.onNodeWithText("English").assertIsDisplayed()
    }

    private fun englishString(resource: Int): String = ui.activity.createConfigurationContext(
        Configuration(ui.activity.resources.configuration).apply { setLocale(Locale.ENGLISH) }
    ).getString(resource)

    @Test fun languageChangesActualNavigationAndReturnsToEnglish() {
        ui.onNodeWithText("简体中文").performClick()
        ui.onNode(hasText("我的") and hasClickAction()).assertIsDisplayed()
        ui.onNodeWithText("English").performClick()
        ui.onNode(hasText("Account") and hasClickAction()).assertIsDisplayed()
        ui.onNode(hasText("Conversations") and hasClickAction()).assertIsDisplayed()
        ui.onNode(hasText("Schedules") and hasClickAction()).assertIsDisplayed()
    }

    @Test fun endpointInputShowsSystemKeyboardAndAcceptsHardwareKey() {
        val field = ui.onNodeWithText(englishString(R.string.endpoint))
        field.performScrollTo().performTextClearance()
        field.performTouchInput { click() }
        ui.waitUntil(10_000) {
            var visible = false
            ui.runOnUiThread {
                visible = ViewCompat.getRootWindowInsets(ui.activity.window.decorView)
                    ?.isVisible(WindowInsetsCompat.Type.ime()) == true
            }
            visible
        }
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        check(device.pressKeyCode(KeyEvent.KEYCODE_A))
        ui.waitForIdle()
        field.assertTextContains("a")
        check(device.pressBack())
        ui.waitUntil(10_000) {
            var visible = true
            ui.runOnUiThread {
                visible = ViewCompat.getRootWindowInsets(ui.activity.window.decorView)
                    ?.isVisible(WindowInsetsCompat.Type.ime()) == true
            }
            !visible
        }
        field.assertTextContains("a")
        ui.onNodeWithText(englishString(R.string.pair)).performScrollTo().assertIsNotEnabled()
        check(!model.state.value.paired && model.state.value.claim == null)
    }

    @Test fun recreationKeepsLanguageAndDoesNotCreateConnection() {
        ui.activityRule.scenario.recreate()
        ui.waitForIdle()
        openAccount()
        ui.onNodeWithText(englishString(R.string.endpoint)).performScrollTo().assertIsDisplayed()
        check(model.state.value.language == "en" && !model.state.value.paired && model.state.value.claim == null)
    }
}
