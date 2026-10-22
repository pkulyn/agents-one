package one.agents.mobile

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import one.agents.mobile.contract.Project
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class ListFiltersUiTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    // @lat: [[mobile-data#Mobile data#Android filter draft admission]]
    @Test fun conversationDraftSelectsOriginalProjectAndArchivedOnlyWhenApplied() {
        var applied: MobileListSelection? = null
        ui.setContent { MaterialTheme { ListFilterDialog(MobileListSelection(), listOf(Project("p1", "Original project", emptyList())), null, false, false, {}, {}, { applied = it }) } }
        ui.onNodeWithText("Original project").performScrollTo().performClick()
        ui.onNodeWithText("Archived").performScrollTo().performClick()
        assertNull(applied)
        ui.onNodeWithText("Apply").performClick()
        assertEquals(MobileListSelection("p1", archived = true), applied)
    }
    // @lat: [[mobile-data#Mobile data#Android Chinese schedule filter isolation]]
    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun chineseScheduleShowsStatesWithoutArchiveAndMissingProjectCannotApply() {
        var retried = false
        ui.setContent { MaterialTheme { ListFilterDialog(MobileListSelection("missing", "paused"), emptyList(), "owner_offline", true, false, { retried = true }, {}, { fail("Missing project must not be submitted") }) } }
        ui.onNodeWithText(ui.activity.getString(R.string.apply_filters)).assertIsNotEnabled()
        ui.onNodeWithText(ui.activity.getString(R.string.filter_archive)).assertDoesNotExist()
        ui.onNodeWithText(ui.activity.getString(R.string.retry_read_sync)).performScrollTo().performClick()
        assertTrue(retried)
        ui.onNodeWithText(ui.activity.getString(R.string.all_projects)).performScrollTo().performClick()
        ui.onNodeWithText(ui.activity.getString(R.string.state_paused)).performScrollTo().assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.apply_filters)).assertIsEnabled()
    }
}
