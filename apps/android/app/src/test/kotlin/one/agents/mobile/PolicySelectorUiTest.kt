package one.agents.mobile

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.*
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
@Config(sdk = [35], qualifiers = "w360dp-h640dp")
class PolicySelectorUiTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    private val policy = ExecutionPolicy("opaque-policy", "original-runtime", "original-project", "inspect", true, false, listOf("create", "advance"))
    private fun catalog(row: ExecutionPolicy = policy) = MobileState(runtimes = listOf(Runtime("original-runtime", "Original agent", "local", healthy = true, capabilities = emptyList(), allowedActions = listOf("read", "create"))), projects = listOf(Project("original-project", "Original project", listOf(row.id))), policies = listOf(row))
    private fun taskChoices() = listOf(
        policy.copy(id = "desktop-task-analysis", projectId = null, mode = "desktop_analysis", unattendedApproved = true),
        policy.copy(id = "desktop-task-auto", projectId = null, mode = "desktop_auto", unattendedApproved = true),
        policy.copy(id = "desktop-task-full", projectId = null, mode = "desktop_full_access", unattendedApproved = false, allowedActions = listOf("create", "advance")),
        policy.copy(id = "desktop-task-project-analysis", mode = "desktop_analysis", unattendedApproved = true),
        policy.copy(id = "desktop-task-project-auto", mode = "desktop_auto", unattendedApproved = true),
        policy.copy(id = "desktop-task-project-full", mode = "desktop_full_access", unattendedApproved = false, allowedActions = listOf("create", "advance")),
    )

    // @lat: [[mobile-data#Mobile data#Android independent desktop task choices]]
    @Test fun choosesAgentProjectAndModeIndependentlyUsingOriginalCatalogObject() {
        val policies = taskChoices(); val state = catalog().copy(policies = policies)
        val choice = mutableStateOf<ExecutionPolicy?>(null)
        ui.setContent { MaterialTheme { Column { PolicySelector(policies, state, choice.value) { choice.value = it } } } }
        ui.onNodeWithTag("task-agent").performClick(); ui.onNodeWithText("Original agent").performClick()
        assertSame(policies[1], choice.value)
        ui.onNodeWithTag("task-project").performClick(); ui.onNodeWithText("Original project").performClick()
        assertSame(policies[4], choice.value)
        ui.onNodeWithTag("task-mode").performClick(); ui.onNodeWithText("Full access").performClick()
        assertSame(policies[5], choice.value)
        ui.onNodeWithText("desktop-task-project-full").assertDoesNotExist()
        ui.onNodeWithText("Full access").assertIsDisplayed()
    }

    // @lat: [[mobile-data#Mobile data#Android task choice invalidation and recovery]]
    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun chineseChoiceRejectsRemovedProjectAndCanSelectAnotherModeWithoutDesktopApproval() {
        val policies = taskChoices(); val state = mutableStateOf(catalog().copy(policies = policies))
        val choice = mutableStateOf<ExecutionPolicy?>(policies[2])
        ui.setContent { MaterialTheme { Column {
            val current = currentPolicySelection(state.value.policies, choice.value, state.value)
            PolicySelector(policies, state.value, current) { choice.value = it }
            Button(onClick = {}, enabled = current != null) { Text("Apply") }
        } } }
        ui.onNodeWithText("自动").assertIsDisplayed(); ui.onNodeWithText("Apply").assertIsEnabled()
        ui.runOnIdle { state.value = state.value.copy(projects = emptyList()) }
        ui.onNodeWithText("Apply").assertIsNotEnabled()
        ui.onNodeWithTag("task-project").performClick(); ui.onNodeWithText("无项目", useUnmergedTree = true).performClick()
        assertNull(choice.value)
        ui.onNodeWithTag("task-mode").performClick(); ui.onNodeWithText("对话与分析").performClick()
        assertSame(policies[0], choice.value); ui.onNodeWithText("Apply").assertIsEnabled()
    }
    // @lat: [[mobile-data#Mobile data#Android readable policy original identity]]
    @Test fun englishPolicyShowsOriginalNamesAndModeWhileSelectingOriginalObject() {
        var choice: ExecutionPolicy? = null
        ui.setContent { MaterialTheme { Column { PolicySelector(listOf(policy), catalog(), null) { choice = it } } } }
        ui.onNodeWithText("Original agent").assertIsDisplayed()
        ui.onNodeWithText("Project: Original project").assertIsDisplayed()
        ui.onNodeWithText("Read-only analysis").assertIsDisplayed()
        ui.onNodeWithText("opaque-policy").assertDoesNotExist()
        ui.onNodeWithTag("execution-policy:opaque-policy").performClick()
        assertSame(policy, choice)
    }
    // @lat: [[mobile-data#Mobile data#Android Chinese policy write explanation]]
    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun chinesePolicyExplainsControlledWriteAndScheduledApproval() {
        val write = policy.copy(mode = "project_write", unattendedApproved = true)
        var choice: ExecutionPolicy? = null
        ui.setContent { MaterialTheme { Column { PolicySelector(listOf(write), catalog(write), null) { choice = it } } } }
        ui.onNodeWithText("项目：Original project").assertIsDisplayed()
        ui.onNodeWithText("受控项目修改").assertIsDisplayed()
        ui.onNodeWithText("已批准定时执行").assertIsDisplayed()
        ui.onNodeWithTag("execution-policy:opaque-policy").performClick()
        assertSame(write, choice)
    }
    // @lat: [[mobile-data#Mobile data#Android policy changed catalog admission]]
    @Test fun changedPolicyOrMissingDirectoryDisablesSubmissionAndUnavailableSelection() {
        val state = mutableStateOf(catalog()); val choice = mutableStateOf<ExecutionPolicy?>(policy)
        ui.setContent { MaterialTheme { Column {
            val current = currentPolicySelection(state.value.policies, choice.value, state.value)
            PolicySelector(state.value.policies, state.value, current) { choice.value = it }
            Button(onClick = {}, enabled = current != null && !state.value.busy) { Text("Apply") }
        } } }
        ui.onNodeWithText("Apply").assertIsEnabled()
        val changed = policy.copy(mode = "project_write")
        ui.runOnIdle { state.value = catalog(changed) }
        ui.onNodeWithText("Apply").assertIsNotEnabled()
        ui.onNodeWithTag("execution-policy:opaque-policy").performClick()
        assertSame(changed, choice.value); ui.onNodeWithText("Apply").assertIsEnabled()
        ui.runOnIdle { state.value = state.value.copy(projects = emptyList()) }
        ui.onNodeWithTag("execution-policy:opaque-policy").assertIsNotEnabled().performClick()
        ui.onNodeWithText("Project: Project unavailable").assertIsDisplayed()
        ui.onNodeWithText("Apply").assertIsNotEnabled()
        assertSame(changed, choice.value)
    }
}
