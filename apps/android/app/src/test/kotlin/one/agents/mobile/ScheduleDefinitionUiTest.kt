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
@Config(sdk=[35],qualifiers="en-w360dp-h640dp")
class ScheduleDefinitionUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val schedule=Schedule("original-plan","Original plan","Original instructions","original-runtime",projectId="original-project",executionPolicyId="original-policy",scheduleExpression="5m",schedulerTimeZone="Asia/Shanghai",enabled=true,effectiveState="enabled",concurrencyPolicy="queue",timeoutMs=600000,activeRunIds=emptyList(),pendingCount=0,revision="9",allowedActions=listOf("read"))
    private val policy=ExecutionPolicy("original-policy","original-runtime","original-project","inspect",true,true,listOf("trigger"))
    @Test fun projectNameAndEnforcedPolicyUseExactOriginalBindings(){
        ui.setContent { MaterialTheme { ScheduleDefinition(schedule,MobileState(projects=listOf(Project("original-project","Original project name",listOf(policy.id))),policies=listOf(policy))) } }
        ui.onNodeWithText("Project: Original project name").assertIsDisplayed()
        ui.onNodeWithText("Policy ID: original-policy").assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.policy_inspect)).assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.policy_unattended)).assertIsDisplayed()
    }
    @Test fun missingCatalogOrForeignBindingNeverInventsExecutionApproval(){
        val state=mutableStateOf(MobileState(policies=listOf(policy.copy(projectId="foreign-project"))))
        ui.setContent { MaterialTheme { ScheduleDefinition(schedule,state.value) } }
        ui.onNodeWithText("Project: original-project").assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.schedule_policy_not_provided)).assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.policy_unattended)).assertDoesNotExist()
        ui.runOnIdle {state.value=MobileState(policies=listOf(policy.copy(enforced=false)))}
        ui.onNodeWithText(ui.activity.getString(R.string.error_unverified_policy)).assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.policy_unattended)).assertDoesNotExist()
    }
    @Test @Config(qualifiers="zh-rCN-w360dp-h640dp") fun chineseDefinitionKeepsOriginalProjectAndPolicyIds(){
        ui.setContent { MaterialTheme { ScheduleDefinition(schedule,MobileState(policies=listOf(policy.copy(mode="project_write")))) } }
        ui.onNodeWithText("项目：original-project").assertIsDisplayed()
        ui.onNodeWithText("策略 ID：original-policy").assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.policy_project_write)).assertIsDisplayed()
    }
    @Test fun scopeOriginalActionsAndBusyAllGateThePressedDetailAction(){
        val actions=mutableStateOf(listOf("read","edit","pause","trigger","discard_pending","delete"))
        val scopes=mutableStateOf(listOf("schedule:manage"));val busy=mutableStateOf(false)
        val calls=mutableListOf<String>()
        ui.setContent { MaterialTheme { ScheduleManagementControls(actions.value,2,scopes.value,busy.value,{calls.add("edit")},{calls.add(it)}) } }
        ui.onNodeWithText("Run once").assertDoesNotExist()
        ui.onNodeWithText("Edit").performClick();ui.onNodeWithText("Pause schedule").performClick()
        ui.onNodeWithText("Discard pending runs").performClick();ui.onNodeWithText("Delete schedule").performClick()
        assertEquals(listOf("edit","pause","discard-pending","delete"),calls)
        ui.runOnIdle {scopes.value=listOf("schedule:trigger")}
        ui.onNodeWithText("Edit").assertDoesNotExist();ui.onNodeWithText("Run once").performClick()
        ui.runOnIdle {busy.value=true}
        ui.onNodeWithText("Run once").assertIsNotEnabled().performClick();assertEquals(5,calls.size)
        ui.runOnIdle {busy.value=false;actions.value=listOf("read")}
        ui.onNodeWithText("Run once").assertDoesNotExist()
    }
}
