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
    // @lat: [[mobile-data#Mobile data#Android source full identity selection]]
    @Test fun sameNamesAndSameOwnerDifferentSpacesSelectExactOriginalPair(){
        val first=source();val second=source(space="space-b");val third=source("owner-b")
        var chosen:OwnerSpace?=null
        ui.setContent { MaterialTheme { OwnerSpaceSelector(MobileState(owner=first,owners=listOf(first,second,third,second)),{chosen=it},{}) } }
        ui.onNodeWithText("Space: space-a").assertIsDisplayed();ui.onNodeWithText("Online").assertIsDisplayed()
        ui.onNodeWithTag("owner-space-selector").performClick()
        ui.onAllNodesWithTag("owner-space:owner-a:space-b").assertCountEquals(1)
        ui.onNodeWithTag("owner-space:owner-a:space-b").performClick()
        assertEquals(second,chosen)
        ui.onNodeWithTag("owner-space-selector").performClick()
        ui.onNodeWithTag("owner-space:owner-b:space-a").performScrollTo().performClick()
        assertEquals(third,chosen)
    }
    // @lat: [[mobile-data#Mobile data#Android source busy and uncertain status]]
    @Test fun busyBlocksSelectionAndSyncFailureDoesNotClaimOnline(){
        val state=mutableStateOf(MobileState(owner=source(),busy=true))
        ui.setContent { MaterialTheme { OwnerSpaceSelector(state.value,{error("Unexpected selection")},{error("Unexpected refresh")}) } }
        ui.onNodeWithTag("owner-space-selector").assertIsNotEnabled().performClick()
        ui.onNodeWithText("Choose Owner and space").assertDoesNotExist()
        ui.runOnIdle { state.value=state.value.copy(busy=false,syncError="owner_offline") }
        ui.onNodeWithText("Connection unconfirmed").assertIsDisplayed();ui.onNodeWithText("Online").assertDoesNotExist()
        ui.runOnIdle { state.value=state.value.copy(syncError=null,owner=source(online=false)) }
        ui.onNodeWithText("Offline").assertIsDisplayed()
    }
    // @lat: [[mobile-data#Mobile data#Android source missing and directory failure]]
    @Test fun unpairedAndDemoCannotInventSourceAndPairedDirectoryErrorIsVisible(){
        val state=mutableStateOf(MobileState())
        ui.setContent { MaterialTheme { OwnerSpaceSelector(state.value,{}, {}) } }
        ui.onNodeWithTag("owner-space-selector").assertDoesNotExist()
        ui.runOnIdle { state.value=MobileState(demo=true,owner=source()) }
        ui.onNodeWithTag("owner-space-selector").assertDoesNotExist()
        ui.runOnIdle { state.value=MobileState(paired=true,error="owner_offline") }
        ui.onNodeWithTag("owner-space-selector").performClick()
        ui.onNodeWithText(ui.activity.getString(R.string.error_owner_offline)).assertIsDisplayed()
        ui.onNodeWithText("No sources available. Refresh or check the connection.").assertDoesNotExist()
    }
    // @lat: [[mobile-data#Mobile data#Android source Chinese and long labels]]
    @Test @Config(qualifiers="zh-rCN-w360dp-h640dp") fun chineseLongOriginalLabelKeepsSpaceAndActionUsable(){
        val original=source().copy(label="原桌面名称".repeat(80))
        var refreshed=0
        ui.setContent { MaterialTheme { OwnerSpaceSelector(MobileState(owner=original),{}, {refreshed++}) } }
        ui.onNodeWithText("空间：space-a").assertIsDisplayed();ui.onNodeWithText("在线").assertIsDisplayed()
        ui.onNodeWithTag("owner-space-selector").performClick()
        ui.onNodeWithText("选择 Owner 与空间").assertIsDisplayed()
        ui.onNodeWithText("刷新来源").assertIsDisplayed().performClick();assertEquals(1,refreshed)
        ui.onNodeWithText("关闭").performClick()
    }
}
