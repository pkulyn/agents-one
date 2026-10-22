package one.agents.mobile

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import kotlinx.serialization.json.*
import one.agents.mobile.contract.*
import one.agents.mobile.net.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], qualifiers="en-w360dp-h640dp")
class MobileScheduleEditorWorkflowTest {
    @get:Rule val ui=createAndroidComposeRule<MainActivity>()
    private lateinit var model: MobileViewModel
    private val scopes=listOf("schedule:read","schedule:manage","schedule:trigger")
    private val limits=Limits(100,50000,262144,86400000,7,100000,300000)
    private val owner=OwnerSpace("owner-1","space-1","Original Owner","desktop",true,false,false,"Asia/Shanghai",scopes,limits,"epoch-1")
    private val policy=ExecutionPolicy("original-policy","original-runtime","original-project","inspect",true,true,listOf("trigger"))
    private val original=Schedule("original-plan","Original plan","Original instructions","original-runtime",projectId="original-project",executionPolicyId="original-policy",scheduleExpression=" 30 09 * * 1-5 ",schedulerTimeZone="Asia/Shanghai",enabled=true,effectiveState="enabled",concurrencyPolicy="queue",timeoutMs=660000,activeRunIds=emptyList(),pendingCount=0,revision="9",allowedActions=listOf("read","edit"))
    private data class Write(val suffix: List<String>,val body: JsonObject?,val revision: String?,val method: String)
    private inner class Client: MobileControlClient("https://owner.example",{"fake-token"}) {
        var editing=false
        var management=false
        var detail=original
        var listActions=original.allowedActions
        val reads=CopyOnWriteArrayList<List<String>>()
        val previews=CopyOnWriteArrayList<JsonObject>();val writes=CopyOnWriteArrayList<Write>()
        override fun streamEvents(binding:OwnerBinding,cursor:String?,lastEventId:String?,consume:(StreamEvent)->Unit,failed:(MobileApiException)->Unit,opened:()->Unit)=MobileEventSubscription {}
        override fun read(binding:OwnerBinding,suffix:List<String>,query:Map<String,String>):JsonElement { reads.add(suffix);return when(suffix){
            listOf("bootstrap")->Json.encodeToJsonElement(Bootstrap(MOBILE_PROTOCOL,owner,"1","2026-10-07T00:00:00Z","epoch-1",scopes,limits,"anchor"))
            listOf("runtimes")->Json.encodeToJsonElement(RuntimePage(listOf(Runtime("original-runtime","Original agent","local",healthy=true,capabilities=emptyList(),allowedActions=listOf("read","create","advance"))),null,"1"))
            listOf("projects")->Json.encodeToJsonElement(ProjectPage(listOf(Project("original-project","Original project",listOf(policy.id))),null,"1"))
            listOf("execution-policies")->Json.encodeToJsonElement(ExecutionPolicyPage(listOf(policy),null,"1"))
            listOf("schedules")->Json.encodeToJsonElement(ScheduleSummaryPage(if(editing) listOf(ScheduleSummary(original.id,original.name,original.runtimeId,projectId=original.projectId,executionPolicyId=original.executionPolicyId,scheduleExpression=original.scheduleExpression,schedulerTimeZone=original.schedulerTimeZone,enabled=true,effectiveState="enabled",concurrencyPolicy="queue",timeoutMs=original.timeoutMs,activeRunIds=emptyList(),pendingCount=0,revision="1",allowedActions=listActions)) else emptyList(),null,"1"))
            listOf("schedules",original.id)->Json.encodeToJsonElement(detail)
            else->Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"1"}""")
        } }
        override fun search(binding:OwnerBinding,suffix:List<String>,body:JsonObject):JsonElement {
            check(binding==OwnerBinding("owner-1","space-1")&&suffix==listOf("schedules","preview"));previews.add(body)
            return Json.encodeToJsonElement(SchedulePreview(body.getValue("scheduleExpression").jsonPrimitive.content,"Asia/Shanghai","Original Owner preview",listOf("2026-10-08T01:30:00Z"),"preview-${previews.size}"))
        }
        override fun write(binding:OwnerBinding,suffix:List<String>,body:JsonObject?,mutationId:String,revision:String?,method:String):JsonElement {
            check(binding==OwnerBinding("owner-1","space-1"));writes.add(Write(suffix,body,revision,method))
            if(management) {
                val action=if(method=="DELETE") "deleteSchedule" else "${suffix.last().replace('-','_')}Schedule"
                return Json.encodeToJsonElement(OperationReceipt("operation-${writes.size}",mutationId,"phone-1",action,ResourceRef("schedule",original.id),"accepted",createdAt="2026-10-07T00:00:00Z",updatedAt="2026-10-07T00:00:00Z"))
            }
            if(editing)throw MobileApiException("revision_conflict",409)
            return Json.encodeToJsonElement(OperationReceipt("operation-1",mutationId,"phone-1","createSchedule",ResourceRef("schedule","new-original-plan"),"applied",createdAt="2026-10-07T00:00:00Z",updatedAt="2026-10-07T00:00:00Z"))
        }
    }
    @Before fun reset(){ui.runOnUiThread{model=ViewModelProvider(ui.activity)[MobileViewModel::class.java];model.forget();model.language("en")}}
    private fun waitFor(condition:()->Boolean)=ui.waitUntil(10000){Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50));condition()}
    private fun connect(client:Client){ui.runOnUiThread{
        fun field(name:String,value:Any){MobileViewModel::class.java.getDeclaredField(name).apply{isAccessible=true}.set(model,value)}
        field("client",client);field("token","fake-token");field("credentials",Credentials("phone-1","fake-token","2099-01-01T00:00:00Z","fake-refresh","2099-01-01T00:00:00Z","1"));model.selectOwner(owner)
    };waitFor{!model.state.value.busy&&model.state.value.owner!=null}
        check(model.state.value.error==null){"Bootstrap failed: ${model.state.value.error}; reads=${client.reads}; runtimes=${model.state.value.runtimes.size}; policies=${model.state.value.policies.size}"}
        ui.onAllNodesWithText("Schedules").onLast().performClick()
    }
    private fun preview(){
        val before=model.state.value.preview
        ui.onNodeWithText("Preview next five runs").assertIsEnabled().performClick()
        waitFor{!model.state.value.busy&&(model.state.value.preview!=before||model.state.value.error!=null)}
        check(model.state.value.error==null){"Preview failed: ${model.state.value.error}"}
    }
    // @lat: [[mobile-data#Mobile data#Android advanced create requires current Owner preview]]
    @Test fun realNewFormKeepsAdvancedValuesAndRequiresRepreviewAfterDraftChanges(){
        val client=Client();connect(client)
        ui.onNodeWithContentDescription("New schedule").performClick()
        ui.onNodeWithTag("field:Name").performTextInput("Mobile original plan")
        ui.onNodeWithTag("field:Task instructions").performTextInput("Original task request")
        ui.onNodeWithText("Interval").performTextInput("5m")
        ui.onNodeWithText("Advanced options").performScrollTo().performClick()
        ui.onNodeWithText("Timeout in seconds").performScrollTo().performTextReplacement("450")
        ui.onNodeWithText("Queue").performScrollTo().performClick()
        ui.onNodeWithText("Hide advanced options").performScrollTo().performClick()
        ui.onNodeWithTag("execution-policy:original-policy").performScrollTo().performClick()
        ui.onNodeWithTag("field:Name").performScrollTo().assert(hasText("Mobile original plan"))
        ui.onNodeWithTag("field:Task instructions").performScrollTo().assert(hasText("Original task request"))
        ui.onNodeWithText("Interval").performScrollTo().assert(hasText("5m"))
        preview();ui.onNodeWithText("Save").assertIsEnabled()
        ui.onNodeWithText("Interval").performScrollTo().performTextReplacement("10m")
        ui.onNodeWithText("Save").assertDoesNotExist();ui.onNodeWithText("Preview next five runs").assertIsEnabled();check(client.writes.isEmpty())
        preview();ui.onNodeWithText("Save").performClick();waitFor{!model.state.value.busy&&client.writes.size==1}
        val write=client.writes.single();check(write.suffix==listOf("schedules")&&write.method=="POST"&&write.revision==null)
        val body=write.body!!;check(body.getValue("scheduleExpression").jsonPrimitive.content=="10m"&&body.getValue("timeoutMs").jsonPrimitive.long==450000L&&body.getValue("concurrencyPolicy").jsonPrimitive.content=="queue")
        check(body.getValue("runtimeId").jsonPrimitive.content==policy.runtimeId&&body.getValue("projectId").jsonPrimitive.content==policy.projectId&&body.getValue("executionPolicyId").jsonPrimitive.content==policy.id&&body.getValue("previewRevision").jsonPrimitive.content=="preview-2")
        check(client.previews.first().getValue("scheduleExpression").jsonPrimitive.content=="5m")
    }
    // @lat: [[mobile-data#Mobile data#Android advanced edit conflict preserves original draft]]
    @Test fun realEditRetainsOriginalCronAndRevisionAndShowsConflictInsideDialog(){
        val client=Client().apply{editing=true};connect(client)
        ui.onNodeWithText("Edit").performScrollTo().assertIsDisplayed().performClick();waitFor{!model.state.value.busy&&(model.state.value.selectedSchedule!=null||model.state.value.error!=null)}
        check(model.state.value.error==null){"Edit failed: ${model.state.value.error}; reads=${client.reads}"}
        ui.onNodeWithText("Timeout in seconds").assertDoesNotExist()
        ui.onNodeWithText("Advanced options").performScrollTo().performClick()
        ui.onNodeWithText("Schedule expression").assert(hasText(original.scheduleExpression))
        ui.onNodeWithText("Hide advanced options").performClick()
        preview();ui.onNodeWithText("Save").performClick();waitFor{!model.state.value.busy&&model.state.value.error=="revision_conflict"}
        val write=client.writes.single();check(write.suffix==listOf("schedules",original.id)&&write.method=="PATCH"&&write.revision=="9")
        check(write.body!!.getValue("scheduleExpression").jsonPrimitive.content==original.scheduleExpression&&write.body.getValue("timeoutMs").jsonPrimitive.long==original.timeoutMs&&write.body.getValue("concurrencyPolicy").jsonPrimitive.content==original.concurrencyPolicy)
        check(model.state.value.selectedSchedule==original)
        ui.onAllNodesWithText(ui.activity.getString(R.string.error_revision_conflict)).onLast().assertIsDisplayed()
        ui.onNodeWithText("Advanced options").performScrollTo().performClick()
        ui.onNodeWithText("Schedule expression").assert(hasText(original.scheduleExpression))
    }
    // @lat: [[mobile-data#Mobile data#Android detail management original revision and receipts]]
    @Test fun detailManagementUsesFreshRevisionAndAcceptedNeverInventsScheduleResults(){
        val client=Client().apply {editing=true;management=true;detail=original.copy(effectiveState="running",activeRunIds=listOf("original-native-run"),pendingCount=2,allowedActions=listOf("read","pause","trigger"))}
        connect(client)
        ui.runOnUiThread {model.openSchedule(model.state.value.schedules.single())};waitFor{!model.state.value.busy&&model.state.value.viewedSchedule!=null}
        check(model.state.value.viewedSchedule?.revision=="9")
        ui.onNodeWithTag("schedule-history").performScrollToNode(hasText("Pause schedule"))
        ui.onNodeWithText("Pause schedule").performClick();check(client.writes.isEmpty())
        ui.onNodeWithText("Cancel").performClick();check(client.writes.isEmpty())
        fun confirm(label:String,resource:Int){
            ui.onNodeWithTag("schedule-history").performScrollToNode(hasText(label))
            ui.onNodeWithText(label).performClick()
            ui.onNodeWithText(ui.activity.getString(resource,original.name)).assertIsDisplayed()
            val before=client.writes.size
            ui.onNodeWithText("Confirm").performClick();waitFor{!model.state.value.busy&&client.writes.size==before+1}
        }
        confirm("Pause schedule",R.string.schedule_pause_confirm)
        check(model.state.value.viewedSchedule?.enabled==true&&model.state.value.viewedSchedule?.activeRunIds==listOf("original-native-run"))
        client.detail=client.detail.copy(enabled=false,effectiveState="paused",revision="10",allowedActions=listOf("read","resume","trigger","discard_pending"))
        ui.runOnUiThread {model.refreshViewedSchedule()};waitFor{!model.state.value.busy&&model.state.value.viewedSchedule?.revision=="10"}
        confirm("Resume schedule",R.string.schedule_resume_confirm)
        check(model.state.value.viewedSchedule?.enabled==false)
        confirm("Run once",R.string.schedule_trigger_confirm)
        confirm("Discard pending runs",R.string.schedule_discard_confirm)
        check(model.state.value.viewedSchedule?.pendingCount==2L&&model.state.value.viewedSchedule?.activeRunIds==listOf("original-native-run")&&model.state.value.scheduleExecutions.isEmpty())
        ui.onNodeWithText("Delete schedule").assertDoesNotExist()
        client.detail=client.detail.copy(activeRunIds=emptyList(),pendingCount=0,revision="11",allowedActions=listOf("read","delete"))
        ui.runOnUiThread {model.refreshViewedSchedule()};waitFor{!model.state.value.busy&&model.state.value.viewedSchedule?.revision=="11"}
        confirm("Delete schedule",R.string.schedule_delete_confirm)
        check(model.state.value.viewedSchedule?.id==original.id)
        check(client.writes.map{it.revision}==listOf("9","10","10","10","11"))
        check(client.writes.map{it.suffix}==listOf(listOf("schedules",original.id,"pause"),listOf("schedules",original.id,"resume"),listOf("schedules",original.id,"trigger"),listOf("schedules",original.id,"discard-pending"),listOf("schedules",original.id)))
        check(client.writes.take(4).all{it.method=="POST"&&it.body==JsonObject(emptyMap())}&&client.writes.last().method=="DELETE"&&client.writes.last().body==null)
        check(model.state.value.operations.size==5&&model.state.value.operations.all{it.status=="accepted"})
    }
    // @lat: [[mobile-data#Mobile data#Android detail edit rereads original definition]]
    @Test fun detailEditRereadsOwnerDefinitionAndConflictKeepsThatNewDraft(){
        val client=Client().apply{editing=true};connect(client)
        ui.runOnUiThread {model.openSchedule(model.state.value.schedules.single())};waitFor{!model.state.value.busy&&model.state.value.viewedSchedule!=null}
        client.detail=original.copy(name="Updated original plan",prompt="Updated original instructions",scheduleExpression="12m",revision="10")
        ui.onNodeWithTag("schedule-history").performScrollToNode(hasText("Edit"));ui.onNodeWithText("Edit").performClick()
        waitFor{!model.state.value.busy&&model.state.value.selectedSchedule?.revision=="10"}
        ui.onNodeWithTag("field:Name").assert(hasText("Updated original plan"))
        ui.onNodeWithTag("field:Task instructions").assert(hasText("Updated original instructions"))
        ui.onNodeWithText("Interval").assert(hasText("12m"))
        preview();ui.onNodeWithText("Save").performClick();waitFor{!model.state.value.busy&&model.state.value.error=="revision_conflict"}
        val write=client.writes.single();check(write.method=="PATCH"&&write.suffix==listOf("schedules",original.id)&&write.revision=="10")
        check(write.body!!.getValue("scheduleExpression").jsonPrimitive.content=="12m"&&model.state.value.selectedSchedule==client.detail)
        ui.onAllNodesWithText(ui.activity.getString(R.string.error_revision_conflict)).onLast().assertIsDisplayed()
    }

    private fun largeFontScheduleActions(language:String){
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        ui.activityRule.scenario.recreate()
        check(ui.activity.resources.configuration.fontScale==2f)
        val client=Client();client.editing=true
        client.listActions=listOf("read","edit","pause","trigger")
        connect(client);ui.runOnUiThread{model.language(language)};waitFor{model.state.value.language==language}
        val labels=if(language=="zh-CN")listOf("编辑","暂停计划","立即运行一次") else listOf("Edit","Pause schedule","Run once")
        if(language=="en") ui.onNodeWithText("Search schedules").performTextInput("Unsubmitted search draft")
        val density=ui.activity.resources.displayMetrics.density
        check(ui.onNode(hasScrollToIndexAction()).fetchSemanticsNode().boundsInRoot.height >= 48*density) { "Schedule viewport too short for a touch target" }
        labels.forEach {label->
            ui.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(label) and hasClickAction())
            val button=ui.onNode(hasText(label) and hasClickAction())
            button.performScrollTo().assertIsDisplayed()
            val bounds=button.fetchSemanticsNode().boundsInRoot
            check(bounds.width>=48*density && bounds.height>=48*density){"$label button bounds=$bounds density=$density fontScale=2"}
            val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            ui.onNodeWithText(label,useUnmergedTree=true).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult){it(layouts)}
            println("native-action-layout label=$label metrics=${layouts.map { listOf(it.size, it.multiParagraph.width, it.multiParagraph.height, it.lineCount) }}")
            check(layouts.size==1 && layouts.single().let { layout -> layout.lineCount <= 2 && layout.multiParagraph.height <= layout.size.height + 1f && (0 until layout.lineCount).all { line -> !layout.isLineEllipsized(line) && layout.getLineRight(line) <= layout.size.width + 1f && layout.getLineLeft(line) >= -1f } }){"$label text clipped at 200%: layouts=${layouts.size}, metrics=${layouts.map { listOf(it.size, it.didOverflowWidth, it.didOverflowHeight, it.lineCount, it.layoutInput.constraints) }}"}
        }
        if(language=="en") {
            ui.onNode(hasScrollToIndexAction()).performScrollToIndex(0)
            ui.onNodeWithText("Unsubmitted search draft").assertIsDisplayed()
            check(model.state.value.scheduleQuery.isEmpty() && client.previews.isEmpty())
        }
        ui.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(labels.last()) and hasClickAction())
        ui.onNode(hasText(labels.last()) and hasClickAction()).performScrollTo().performTouchInput{click()}
        ui.onNode(hasText(if(language=="zh-CN")"确认" else "Confirm") and hasAnyAncestor(isDialog())).assertIsDisplayed()
        ui.onNodeWithText(if(language=="zh-CN")"取消" else "Cancel").performClick()
        check(client.writes.isEmpty())
    }
    // @lat: [[mobile-data#Mobile data#Android schedule actions narrow large font]]
    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    fun scheduleActionsRemainReadableAndTouchableAt360dpAnd200Percent(){largeFontScheduleActions("en")}
    // @lat: [[mobile-data#Mobile data#Android schedule actions Chinese landscape large font]]
    @Test @Config(sdk=[35],qualifiers="zh-rCN-w640dp-h360dp-land") @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    fun chineseLandscapeScheduleActionsRetainTouchBoundsAt200Percent(){largeFontScheduleActions("zh-CN")}
}
