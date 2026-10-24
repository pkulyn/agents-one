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
        policy.copy(id = "desktop-task-auto", projectId = null, mode = "desktop_auto", unattendedApproved = true),
        policy.copy(id = "desktop-task-project-auto", mode = "desktop_auto", unattendedApproved = true),
        policy.copy(id = "desktop-task-project-analysis", mode = "desktop_analysis", unattendedApproved = true),
    )

    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun noProjectRemainsSubmittableForConversationAndSchedule() {
        val noProject = policy.copy(id = "desktop-task-no-project", projectId = null, mode = "desktop_auto", unattendedApproved = true, allowedActions = listOf("create", "advance", "trigger"))
        val withProject = noProject.copy(id = "desktop-task-with-project", projectId = "original-project")
        val policies = listOf(withProject, noProject)
        val state = catalog().copy(policies = policies)
        assertSame(noProject, defaultTaskPolicy(policies, state).takeIf { it?.projectId == null })
        val choice = mutableStateOf<ExecutionPolicy?>(withProject)
        ui.setContent { MaterialTheme { Column {
            val eligible = state.policies.filter { it.enforced && "create" in it.allowedActions && "advance" in it.allowedActions }
            val current = currentPolicySelection(eligible, choice.value, state)
            PolicySelector(eligible, state, current) { choice.value = it }
            Button(onClick = {}, enabled = current != null) { Text("Create") }
        } } }
        ui.onNodeWithTag("task-project").performClick()
        ui.onNodeWithText("无项目", useUnmergedTree = true).performClick()
        assertSame(noProject, choice.value)
        ui.onNodeWithText("Create").assertIsEnabled()
        assertSame(noProject, currentPolicySelection(policies.filter { "trigger" in it.allowedActions }, choice.value, state))
    }

    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun changingAgentThenRemovingProjectSelectsThatAgentsNoProjectPolicy() {
        val initial = policy.copy(id = "desktop-task-original-project", mode = "desktop_auto", unattendedApproved = true)
        val pi = policy.copy(id = "desktop-task-pi-no-project", runtimeId = "pi-runtime", projectId = null, mode = "desktop_auto", unattendedApproved = true)
        val policies = listOf(initial, pi)
        val state = catalog().copy(policies = policies, runtimes = catalog().runtimes + Runtime("pi-runtime", "Pi", "local", healthy = true, capabilities = emptyList(), allowedActions = listOf("read", "create")))
        val choice = mutableStateOf<ExecutionPolicy?>(initial)
        ui.setContent { MaterialTheme { Column {
            val current = currentPolicySelection(policies, choice.value, state)
            PolicySelector(policies, state, current) { choice.value = it }
            Button(onClick = {}, enabled = current != null) { Text("Create") }
        } } }
        ui.onNodeWithTag("task-agent").performClick(); ui.onNodeWithText("Pi").performClick()
        ui.onNodeWithTag("task-project").performClick(); ui.onNodeWithText("无项目", useUnmergedTree = true).performClick()
        assertSame(pi, choice.value)
        ui.onNodeWithText("Create").assertIsEnabled()
    }
    @Test fun sameBoundNoProjectPolicyUsesRefreshedCatalogObject() {
        val old = policy.copy(id = "desktop-task-no-project", projectId = null, mode = "desktop_auto", unattendedApproved = true, allowedActions = listOf("create", "advance"))
        val refreshed = old.copy(allowedActions = listOf("create", "advance", "trigger"))
        val state = catalog().copy(policies = listOf(refreshed))
        assertSame(refreshed, currentPolicySelection(state.policies, old, state))
        assertNull(currentPolicySelection(listOf(refreshed.copy(runtimeId = "other-runtime")), old, state))
    }

    @Test fun choosesAgentProjectAndModeIndependentlyUsingOriginalCatalogObject() {
        val policies = taskChoices(); val state = catalog().copy(policies = policies)
        val choice = mutableStateOf<ExecutionPolicy?>(null)
        ui.setContent { MaterialTheme { Column { PolicySelector(policies, state, choice.value) { choice.value = it } } } }
        ui.onNodeWithTag("task-agent").performClick(); ui.onAllNodesWithText("Original agent").onLast().performClick()
        assertSame(policies[0], choice.value)
        ui.onNodeWithTag("task-project").performClick(); ui.onNodeWithText("Original project").performClick()
        assertSame(policies[1], choice.value)
        ui.onNodeWithTag("task-mode").performClick(); ui.onNodeWithText("Read only").performClick()
        assertSame(policies[2], choice.value)
        ui.onNodeWithText("desktop-task-project-analysis").assertDoesNotExist()
        ui.onNodeWithText("Read only").assertIsDisplayed()
    }

    @Test @Config(qualifiers = "zh-rCN-w360dp-h640dp") fun chineseChoiceRejectsRemovedProjectAndCanSelectAnotherModeWithoutDesktopApproval() {
        val policies = taskChoices(); val state = mutableStateOf(catalog().copy(policies = policies))
        val choice = mutableStateOf<ExecutionPolicy?>(policies[2])
        ui.setContent { MaterialTheme { Column {
            val current = currentPolicySelection(state.value.policies, choice.value, state.value)
            PolicySelector(policies, state.value, current) { choice.value = it }
            Button(onClick = {}, enabled = current != null) { Text("Apply") }
        } } }
        ui.onNodeWithText("只读").assertIsDisplayed(); ui.onNodeWithText("Apply").assertIsEnabled()
        ui.runOnIdle { state.value = state.value.copy(projects = emptyList()) }
        ui.onNodeWithText("Apply").assertIsNotEnabled()
        ui.onNodeWithTag("task-project").performClick(); ui.onNodeWithText("无项目", useUnmergedTree = true).performClick()
        assertNull(choice.value)
        ui.onNodeWithTag("task-mode").performClick(); ui.onNodeWithText("自动").performClick()
        assertSame(policies[0], choice.value); ui.onNodeWithText("Apply").assertIsEnabled()
    }
    @Test fun fullAccessRequiresExplicitChoiceAndNeverBecomesDefault() {
        val full = policy.copy(id = "desktop-task-full", mode = "desktop_full_access")
        assertNull(defaultTaskPolicy(listOf(full), catalog(full)))
        val automatic = policy.copy(id = "desktop-task-auto", mode = "desktop_auto")
        assertSame(automatic, defaultTaskPolicy(listOf(full, automatic), catalog().copy(policies = listOf(full, automatic))))
        assertFalse(policyCatalogAvailable(full, catalog(full).copy(projects = emptyList())))
    }

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
