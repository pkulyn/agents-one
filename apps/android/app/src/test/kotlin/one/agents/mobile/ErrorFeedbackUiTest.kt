package one.agents.mobile

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],qualifiers="en-w360dp-h640dp")
class ErrorFeedbackUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun unknownCodeShowsLocalRecoveryAndOriginalSelectableIdentity(){
        ui.setContent { MaterialTheme { ErrorFeedback(translatedError("new_owner_error"),"request.original:51") } }
        ui.onNodeWithText(ui.activity.getString(R.string.error_generic)).assertIsDisplayed()
        ui.onNodeWithText("Request ID: request.original:51").assertIsDisplayed()
        ui.onNodeWithText("new_owner_error").assertDoesNotExist()
    }
    @Test @Config(qualifiers="zh-rCN-w360dp-h640dp") fun chineseTracePreservesIdButRefusesArbitraryRemoteText(){
        ui.setContent { MaterialTheme { Column {
            ErrorFeedback(translatedError("login_required"),"original-id")
            ErrorFeedback(translatedError("new_error"),"secret\nremote-text")
            ErrorFeedback(translatedError("new_error"),"x".repeat(161))
        } } }
        ui.onNodeWithText("请求编号：original-id").assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.error_login_required)).assertIsDisplayed()
        ui.onAllNodesWithText("请求编号：",substring=true).assertCountEquals(1)
        ui.onNodeWithText("remote-text",substring=true).assertDoesNotExist()
    }
    @Test fun knownRestrictionReasonsDoNotFallBackToGenericFailure(){
        val reasons=listOf("requires_owner_action","unverified_policy","unsupported_source","profile_inactive","runtime_offline","login_required","project_binding_conflict","policy_revoked","unknown_state")
        ui.setContent { MaterialTheme { Column { reasons.forEach { androidx.compose.material3.Text(translatedError(it)) } } } }
        reasons.forEach { code ->
            val id=ui.activity.resources.getIdentifier("error_$code","string",ui.activity.packageName)
            check(id!=0);ui.onNodeWithText(ui.activity.getString(id)).assertExists()
        }
        ui.onNodeWithText(ui.activity.getString(R.string.error_generic)).assertDoesNotExist()
    }
}
