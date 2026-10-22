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
@Config(sdk=[35],qualifiers="en-w360dp-h640dp")
class MobileOwnerSpaceWorkflowTest {
    @get:Rule val ui=createAndroidComposeRule<MainActivity>()
    private lateinit var model:MobileViewModel
    private val scopes=listOf("conversation:read","schedule:read")
    private val limits=Limits(100,50000,262144,86400000,7,100000,300000)
    private fun source(owner:String,space:String)=OwnerSpace(owner,space,"Same original name","desktop",true,false,false,"Asia/Shanghai",scopes,limits,"epoch-$owner-$space")
    private val first=source("owner-a","space-a")
    private val second=source("owner-a","space-b")
    private val third=source("owner-b","space-a")
    private fun binding(source:OwnerSpace)=OwnerBinding(source.ownerId,source.spaceId)
    private data class Read(val binding:OwnerBinding,val suffix:List<String>,val query:Map<String,String>)
    private inner class Client:MobileControlClient("https://owner.example",{"fake-token"}) {
        val sources=listOf(first,second,third)
        val reads=CopyOnWriteArrayList<Read>()
        var offline:OwnerBinding?=null
        override fun listOwners():JsonElement=Json.encodeToJsonElement(OwnerSpacePage(sources,null,"1"))
        override fun streamEvents(binding:OwnerBinding,cursor:String?,lastEventId:String?,consume:(StreamEvent)->Unit,failed:(MobileApiException)->Unit,opened:()->Unit)=MobileEventSubscription {}
        private fun conversations(binding:OwnerBinding)=ConversationPage(listOf(Conversation("conversation-${binding.ownerId}-${binding.spaceId}","runtime_conversation","Original ${binding.ownerId}/${binding.spaceId}","original-runtime",pinned=false,archived=false,revision="1",lastMessageSeq="0",lastReadMessageSeq="0",activity="active",activeRunIds=emptyList(),createdAt="2026-10-07T00:00:00Z",updatedAt="2026-10-07T00:00:00Z",allowedActions=listOf("read"))),null,"1")
        override fun read(binding:OwnerBinding,suffix:List<String>,query:Map<String,String>):JsonElement {
            reads.add(Read(binding,suffix,query))
            if(suffix==listOf("bootstrap")&&binding==offline)throw MobileApiException("owner_offline",503)
            val owner=sources.single{binding(it)==binding}
            return when(suffix){
                listOf("bootstrap")->Json.encodeToJsonElement(Bootstrap(MOBILE_PROTOCOL,owner,"1","2026-10-07T00:00:00Z",owner.dataEpoch,scopes,limits,"anchor"))
                listOf("conversations")->Json.encodeToJsonElement(conversations(binding))
                listOf("schedules")->Json.encodeToJsonElement(ScheduleSummaryPage(listOf(ScheduleSummary("schedule-${binding.ownerId}-${binding.spaceId}","Original ${binding.ownerId}/${binding.spaceId} plan","original-runtime",scheduleExpression="5m",schedulerTimeZone="Asia/Shanghai",enabled=false,effectiveState="paused",concurrencyPolicy="skip",timeoutMs=300000,activeRunIds=emptyList(),pendingCount=0,revision="1",allowedActions=listOf("read"))),null,"1"))
                else->Json.parseToJsonElement("""{"items":[],"nextCursor":null,"snapshotRevision":"1"}""")
            }
        }
        override fun search(binding:OwnerBinding,suffix:List<String>,body:JsonObject):JsonElement {
            check(suffix==listOf("conversations","search"))
            return Json.encodeToJsonElement(conversations(binding))
        }
        override fun write(binding:OwnerBinding,suffix:List<String>,body:JsonObject?,mutationId:String,revision:String?,method:String):JsonElement=error("Source navigation must not mutate tasks")
    }
    @Before fun reset(){ui.runOnUiThread{model=ViewModelProvider(ui.activity)[MobileViewModel::class.java];model.forget();model.language("en")}}
    private fun waitFor(condition:()->Boolean)=ui.waitUntil(10000){Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50));condition()}
    private fun perform(block:()->Unit){ui.runOnUiThread(block);waitFor{!model.state.value.busy && !model.state.value.ownerDataRefreshing}}
    private fun connect(client:Client){ui.runOnUiThread{
        fun field(name:String,value:Any){MobileViewModel::class.java.getDeclaredField(name).apply{isAccessible=true}.set(model,value)}
        field("client",client);field("token","fake-token");field("credentials",Credentials("phone-1","fake-token","2099-01-01T00:00:00Z","fake-refresh","2099-01-01T00:00:00Z","1"))
    };perform{model.selectOwner(first)};perform{model.refreshConnection()};check(model.state.value.error==null&&model.state.value.owners.size==3)}
    private fun choose(source:OwnerSpace){ui.onAllNodesWithText("Account").onLast().performClick();ui.onNodeWithText("Switch execution device").performScrollTo().performClick();ui.onNodeWithTag("owner-space:${source.ownerId}:${source.spaceId}").performScrollTo().performClick()}
    // @lat: [[mobile-data#Mobile data#Android real source change clears old list binding]]
    @Test fun actualListSelectorSwitchesSpaceAndSameNameOwnerWithOriginalBoundReads(){
        val client=Client();connect(client)
        perform{model.selectListFilters(MobileListSelection(state="active"),false)}
        perform{model.selectListFilters(MobileListSelection(state="paused"),true)}
        perform{model.search("Original query",false)}
        check(model.state.value.owner?.spaceId == "space-a")
        choose(second);waitFor{!model.state.value.busy&&!model.state.value.ownerDataRefreshing&&model.state.value.owner?.spaceId=="space-b"}
        check(model.state.value.conversationSelection==MobileListSelection()&&model.state.value.scheduleSelection==MobileListSelection()&&model.state.value.conversationQuery.isEmpty())
        check(model.state.value.conversations.single().id=="conversation-owner-a-space-b"&&model.state.value.schedules.single().id=="schedule-owner-a-space-b")
        check(model.state.value.owner?.spaceId == "space-b")
        ui.onAllNodesWithText("Schedules").onLast().performClick();check(model.state.value.owner?.spaceId == "space-b")
        choose(third);waitFor{!model.state.value.busy&&model.state.value.owner?.ownerId=="owner-b"}
        val latest=client.reads.indexOfLast{it.suffix==listOf("bootstrap")}
        check(client.reads.drop(latest).all{it.binding==binding(third)})
        check(client.reads.drop(latest).filter{it.suffix==listOf("conversations")||it.suffix==listOf("schedules")}.all{it.query.isEmpty()})
        check(model.state.value.conversations.single().id=="conversation-owner-b-space-a"&&model.state.value.schedules.single().id=="schedule-owner-b-space-a")
        check(model.state.value.owner?.spaceId == "space-a");ui.onAllNodesWithText("Schedules").onLast().performClick();ui.onNodeWithTag("category:paused").performClick();ui.onNodeWithText("Original owner-b/space-a plan").assertIsDisplayed()
    }
    // @lat: [[mobile-data#Mobile data#Android failed source selection retains original authority]]
    @Test fun failedBootstrapDoesNotChangeHeaderOrReplaceOriginalRecords(){
        val client=Client();connect(client);client.offline=binding(second)
        val originalConversations=model.state.value.conversations;val originalSchedules=model.state.value.schedules
        choose(second);waitFor{!model.state.value.busy&&model.state.value.error=="owner_offline"}
        check(model.state.value.owner==first&&model.state.value.conversations==originalConversations&&model.state.value.schedules==originalSchedules)
        check(model.state.value.owner?.spaceId == "space-a");ui.onNodeWithTag("owner-space-selector").assertDoesNotExist()
        check(client.reads.last()==Read(binding(second),listOf("bootstrap"),emptyMap()))
    }
}
