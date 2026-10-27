package one.agents.mobile

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import one.agents.mobile.contract.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], qualifiers="en-w360dp-h640dp")
class OwnerSpaceSelectorUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val limits=Limits(100,50000,262144,86400000,7,100000,300000)
    private fun source(owner:String="owner-a",space:String="space-a",online:Boolean=true)=OwnerSpace(owner,space,"Same name","desktop",online,false,false,"Asia/Shanghai",listOf("conversation:read"),limits,"epoch-1")
    @Test fun sameNamesNeverTurnTheStatusHeaderIntoASourcePicker() {
        val first = source(); var selected = 0
        ui.setContent { MaterialTheme { OwnerSpaceSelector(MobileState(owner = first, owners = listOf(first, source(space = "space-b"), source("owner-b"))), { selected++ }, {}) } }
        ui.onNodeWithText("Agents One").assertIsDisplayed()
        ui.onNodeWithText("• Online").assertIsDisplayed()
        ui.onNodeWithTag("owner-space-selector").assertDoesNotExist()
        ui.onNodeWithText("Space: space-a").assertDoesNotExist()
        assertEquals(0, selected)
    }
    @Test fun busyStatusRemainsReadOnlyAndConnectionLossShowsOffline() {
        val state = mutableStateOf(MobileState(owner = source(), busy = true))
        ui.setContent { MaterialTheme { OwnerSpaceSelector(state.value, { error("Unexpected selection") }, { error("Unexpected refresh") }) } }
        ui.onNodeWithTag("owner-space-selector").assertDoesNotExist()
        ui.runOnIdle { state.value = state.value.copy(busy = false, syncError = "owner_offline") }
        ui.onNodeWithText("• Offline").assertIsDisplayed()
        ui.onNodeWithText("• Online").assertDoesNotExist()
    }
    @Test fun unpairedAndDemoHaveNoHeaderAndMissingOwnerCannotClaimOnline() {
        val state = mutableStateOf(MobileState())
        ui.setContent { MaterialTheme { OwnerSpaceSelector(state.value, {}, {}) } }
        ui.onNodeWithText("Agents One").assertDoesNotExist()
        ui.runOnIdle { state.value = MobileState(demo = true, owner = source()) }
        ui.onNodeWithText("Agents One").assertDoesNotExist()
        ui.runOnIdle { state.value = MobileState(paired = true, error = "owner_offline") }
        ui.onNodeWithText("Agents One").assertIsDisplayed()
        ui.onNodeWithText("• Online").assertDoesNotExist()
        ui.onNodeWithTag("owner-space-selector").assertDoesNotExist()
    }
    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun longComputerNameDoesNotReplaceBrandOrIntroduceHeaderActions() {
        var refreshed = 0
        ui.setContent { MaterialTheme { OwnerSpaceSelector(MobileState(owner = source().copy(label = "原桌面名称".repeat(80))), {}, { refreshed++ }) } }
        ui.onNodeWithText("Agents One").assertIsDisplayed()
        ui.onNodeWithText("• 在线").assertIsDisplayed()
        ui.onNodeWithTag("owner-space-selector").assertDoesNotExist()
        assertEquals(0, refreshed)
    }
}
