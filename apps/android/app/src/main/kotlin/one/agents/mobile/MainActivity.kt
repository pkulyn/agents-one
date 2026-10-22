package one.agents.mobile

import androidx.compose.ui.graphics.luminance

import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.flow.distinctUntilChanged
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.serialization.json.*
import one.agents.mobile.contract.*

class MainActivity : ComponentActivity() {
    override fun onStart() { super.onStart(); ViewModelProvider(this)[MobileViewModel::class.java].observeForeground(true) }
    override fun onStop() { ViewModelProvider(this)[MobileViewModel::class.java].observeForeground(false); super.onStop() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); enableEdgeToEdge()
        setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides this@MainActivity) {
                val model: MobileViewModel = viewModel(); AgentsOne(model)
            }
        }
    }
}

@Composable internal fun translatedState(value: String): String {
    val context = LocalContext.current
    val name = if (Regex("^[a-z_]+$").matches(value)) "state_$value" else "state_unknown"
    val resource = context.resources.getIdentifier(name, "string", context.packageName)
    return stringResource(if (resource == 0) R.string.state_unknown else resource)
}
@Composable internal fun translatedError(code: String): String {
    val context = LocalContext.current
    val resource = if (Regex("^[a-z_]+$").matches(code)) context.resources.getIdentifier("error_$code", "string", context.packageName) else 0
    return stringResource(if (resource == 0) R.string.error_generic else resource)
}

@Composable private fun Button(onClick: () -> Unit, enabled: Boolean = true, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    androidx.compose.material3.Button(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(3.dp),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp), colors = ButtonDefaults.buttonColors(containerColor = if (dark) Color(0xFFFF9A51) else Color(0xFFF37021), contentColor = Color(0xFF242724)), content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun AgentsOne(model: MobileViewModel) {
    val state by model.state.collectAsState()
    val original = LocalContext.current
    val configuration = LocalConfiguration.current
    val context = remember(original, configuration, state.language) { original.createConfigurationContext(Configuration(configuration).apply { setLocale(Locale.forLanguageTag(state.language)) }) }
    CompositionLocalProvider(LocalContext provides context, LocalConfiguration provides context.resources.configuration, LocalResources provides context.resources) {
        val dark = appearanceIsDark(state.appearance, androidx.compose.foundation.isSystemInDarkTheme())
        val colors = if (dark) darkColorScheme(primary = Color(0xFFFF9A51), onPrimary = Color(0xFF242724), secondary = Color(0xFFFF9A51), secondaryContainer = Color(0xFF4A2B1B), onSecondaryContainer = Color(0xFFFFE4D1), background = Color(0xFF191B19), surface = Color(0xFF191B19), surfaceContainer = Color(0xFF252825))
        else lightColorScheme(primary = COrange, onPrimary = Color(0xFF242724), secondary = COrange, secondaryContainer = Color(0xFFFFF0E4), onSecondaryContainer = Color(0xFF242724), background = Color(0xFFFAF9F6), surface = Color(0xFFFAF9F6), surfaceContainer = Color(0xFFF0EFEB), onSurface = Color(0xFF242724), onSurfaceVariant = Color(0xFF858982), outlineVariant = Color(0xFFDDDED8), onPrimaryContainer = Color(0xFF242724))
        MaterialTheme(colorScheme = colors, typography = cTypography(state.language), shapes = Shapes(extraSmall = RoundedCornerShape(3.dp), small = RoundedCornerShape(3.dp), medium = RoundedCornerShape(4.dp), large = RoundedCornerShape(8.dp))) {
            var tab by remember { mutableIntStateOf(0) }
            var create by remember { mutableStateOf(false) }
            var scheduleEditor by remember { mutableStateOf(false) }
            var pendingSchedule by remember { mutableStateOf<Pair<ScheduleSummary, String>?>(null) }
            val formBinding = listOf(state.owner?.ownerId, state.owner?.spaceId, state.owner?.dataEpoch)
            var previousFormBinding by remember { mutableStateOf(formBinding) }
            LaunchedEffect(formBinding, state.owner?.capabilities) {
                if (formBinding != previousFormBinding) { create = false; scheduleEditor = false; pendingSchedule = null; model.clearSchedule(); previousFormBinding = formBinding }
                if ("conversation:create" !in (state.owner?.capabilities ?: emptyList())) create = false
                if ("schedule:manage" !in (state.owner?.capabilities ?: emptyList())) { scheduleEditor = false; pendingSchedule = null; model.clearSchedule() }
            }
            BackHandler(state.selected != null || state.viewedSchedule != null || state.openingDetail || create || scheduleEditor) { model.back(); create = false; scheduleEditor = false; model.clearSchedule() }
            Scaffold(
                topBar = {
                    Column(Modifier.statusBarsPadding()) {
                        if (state.selected == null && state.viewedSchedule == null && !state.openingDetail) {
                            OwnerSpaceSelector(state, model::selectOwner, model::refreshConnection)
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(listOf(R.string.conversations, R.string.schedules, R.string.account)[tab]), Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                                if (tab < 2 && state.owner != null) {
                                    val scope = if (tab == 0) "conversation:create" else "schedule:manage"
                                    if (scope in state.owner!!.capabilities) {
                                        Button(onClick = { model.dismissError(); if (tab == 0) create = true else { model.clearSchedule(); scheduleEditor = true } }, enabled = !state.busy, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Add, stringResource(if (tab == 0) R.string.new_conversation else R.string.new_schedule)) }
                                        IconButton(onClick = model::refresh, enabled = !state.busy) { Icon(Icons.Outlined.Refresh, stringResource(R.string.refresh)) }
                                    }
                                }
                            }
                        } else {
                            Row(Modifier.fillMaxWidth().padding(end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                                IconButton(onClick = model::back) { Icon(Icons.Outlined.ArrowBack, stringResource(R.string.back)) }
                                state.selected?.let { c -> RuntimeAvatarImage(state.runtimes.find { it.id == c.runtimeId }, c.runtimeId, model.runtimeAvatarSource(), loadEnabled = !state.demo, load = model::loadRuntimeAvatar) }
                                 Column(Modifier.weight(1f).padding(start = 8.dp)) {
                                     Text(state.selected?.title ?: state.viewedSchedule?.name ?: stringResource(R.string.loading), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                     state.selected?.let { c ->
                                         Text(state.runtimes.find { it.id == c.runtimeId }?.name ?: c.runtimeId, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                         val headerPolicy = state.policies.firstOrNull { it.enforced && it.runtimeId == c.runtimeId && it.projectId == c.projectId && "advance" in it.allowedActions && policyCatalogAvailable(it, state) }
                                         headerPolicy?.let { policy -> Text(stringResource(when (policy.mode) { "desktop_execute" -> R.string.task_execute; "desktop_analysis" -> R.string.task_analysis; "desktop_auto" -> R.string.task_auto; "desktop_full_access" -> R.string.task_full_access; "project_write" -> R.string.policy_project_write; else -> R.string.policy_inspect }), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
                                     }
                                 }
                                if (state.selected != null) CConversationMenu(model, state)
                                IconButton(onClick = { if (state.selected != null) model.refreshConversation() else model.refreshViewedSchedule() }, enabled = !state.busy) { Icon(Icons.Outlined.Refresh, stringResource(R.string.refresh)) }
                            }
                            HorizontalDivider()
                        }
                    }
                },
                bottomBar = { if (state.selected == null && state.viewedSchedule == null && !state.openingDetail) CNavigation(tab, { tab = it }, listOf(stringResource(R.string.conversations), stringResource(R.string.schedules), stringResource(R.string.account)), listOf(Icons.Outlined.ChatBubbleOutline, Icons.Outlined.Schedule, Icons.Outlined.PersonOutline)) },

            ) { padding ->
                Column(Modifier.padding(padding).fillMaxSize()) {
                    if (state.busy && state.selected == null) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text(stringResource(R.string.loading), Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.labelMedium) }
                    if (state.demo) Surface(color = MaterialTheme.colorScheme.secondaryContainer) { Text(stringResource(R.string.demo_banner), Modifier.fillMaxWidth().padding(12.dp), style = MaterialTheme.typography.labelMedium) }
                    if (state.selected == null) state.syncError?.let { code -> Surface(color = MaterialTheme.colorScheme.secondaryContainer) { Row(Modifier.padding(12.dp)) { ErrorFeedback(stringResource(R.string.live_sync_failed, translatedError(code)), state.failureRequestId("sync", code), Modifier.weight(1f), MaterialTheme.colorScheme.onSecondaryContainer); TextButton(onClick = model::retryEventObservation) { Text(stringResource(R.string.retry_read_sync)) } } } }
                    if (state.selected == null) state.error?.let { error -> Surface(color = MaterialTheme.colorScheme.errorContainer) { Row(Modifier.padding(16.dp)) { ErrorFeedback(translatedError(error), state.failureRequestId("global", error), Modifier.weight(1f), MaterialTheme.colorScheme.onErrorContainer); IconButton(onClick = model::dismissError) { Icon(Icons.Outlined.Close, stringResource(R.string.close)) } } } }
                    when {
                        state.selected != null -> ConversationDetail(model, state)
                        state.viewedSchedule != null -> ScheduleDetail(model, state, onEdit = { model.editSchedule(it) { scheduleEditor = true } }, onAction = { schedule, action -> pendingSchedule = schedule to action })
                        tab == 2 -> CAccount(model, state)
                        state.owner == null && !state.demo -> EmptyOwner { tab = 2 }
                        tab == 0 -> Conversations(model, state)
                         else -> Schedules(model, state)
                    }
                }
            }
            if (create) CreateConversation(model, state) { create = false }
            if (scheduleEditor) ScheduleEditor(model, state) { scheduleEditor = false; model.clearSchedule() }
            pendingSchedule?.let { (schedule, action) -> AlertDialog(onDismissRequest = { pendingSchedule = null }, title = { Text(stringResource(actionLabel(action))) }, text = { Text(stringResource(when (action) { "resume" -> R.string.schedule_resume_confirm; "trigger" -> R.string.schedule_trigger_confirm; "discard-pending" -> R.string.schedule_discard_confirm; "delete" -> R.string.schedule_delete_confirm; else -> R.string.schedule_pause_confirm }, schedule.name)) }, confirmButton = { TextButton(onClick = { model.scheduleAction(schedule, action); pendingSchedule = null }) { Text(stringResource(R.string.confirm)) } }, dismissButton = { TextButton(onClick = { pendingSchedule = null }) { Text(stringResource(R.string.cancel)) } }) }
        }
    }
}

@Composable private fun EmptyOwner(connect: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Icon(Icons.Outlined.Devices, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(20.dp)); Text(stringResource(R.string.owner_required), style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp)); Text(stringResource(R.string.connect_description))
        Spacer(Modifier.height(24.dp)); Button(onClick = connect) { Text(stringResource(R.string.pair)) }
    }
}
@Composable private fun listSearchDraft(state: MobileState, schedules: Boolean): MutableState<String> = remember(state.owner?.ownerId, state.owner?.spaceId, state.owner?.dataEpoch, schedules, if (schedules) state.scheduleQuery else state.conversationQuery) { mutableStateOf(if (schedules) state.scheduleQuery else state.conversationQuery) }
@Composable private fun Search(model: MobileViewModel, state: MobileState, schedules: Boolean, draft: MutableState<String>) {
    var query by draft
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        TextField(query, { query = it }, Modifier.weight(1f).testTag("list-search").border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(4.dp)), placeholder = { Text(stringResource(if (schedules) R.string.c_search_schedules else R.string.c_search_conversations), style = MaterialTheme.typography.bodyMedium) }, singleLine = true,
            leadingIcon = { Icon(Icons.Outlined.Search, null, Modifier.size(18.dp)) },
            colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, focusedIndicatorColor = COrange, unfocusedIndicatorColor = Color.Transparent))
        IconButton(onClick = { model.search(query, schedules) }, enabled = !state.busy) { Icon(Icons.Outlined.Search, stringResource(R.string.search)) }
    }
}
@Composable private fun Conversations(model: MobileViewModel, state: MobileState) {
    val draft = listSearchDraft(state, false)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item { Search(model, state, false, draft); ListFilterBar(model, state, false)
            Row(Modifier.fillMaxWidth().padding(16.dp)) { Text(stringResource(R.string.c_recent), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(state.conversations.size.toString(), style = MaterialTheme.typography.labelMedium) }
        }
        state.conversationError?.let { code -> item { ErrorFeedback(translatedError(code), state.failureRequestId("conversation", code), Modifier.padding(16.dp)) } }
        if (state.conversations.isEmpty() && state.conversationError == null) item { Text(stringResource(R.string.empty_conversations), Modifier.padding(16.dp)) }
        items(state.conversations.size, key = { state.conversations[it].id }) { index ->
            val conversation = state.conversations[index]
            val runtime = state.runtimes.find { it.id == conversation.runtimeId }
            Row(Modifier.fillMaxWidth().clickable(enabled = !state.busy) { model.openConversation(conversation) }.padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                RuntimeAvatarImage(runtime, conversation.runtimeId, model.runtimeAvatarSource(), loadEnabled = !state.demo, load = model::loadRuntimeAvatar)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row { Text((index + 1).toString().padStart(2, '0') + " / " + (runtime?.name ?: conversation.runtimeId), Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        val time = runCatching { DateTimeFormatter.ofPattern("MM-dd HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(conversation.updatedAt)) }.getOrDefault("")
                        Text(time, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(conversation.title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (conversation.pinned) Icon(Icons.Outlined.PushPin, null, Modifier.size(14.dp))
                        val unreadCount = runCatching { (conversation.lastMessageSeq.toBigInteger() - conversation.lastReadMessageSeq.toBigInteger()).max(java.math.BigInteger.ZERO).toInt() }.getOrDefault(0)
                        if (unreadCount > 0) {
                            val unreadLabel = stringResource(R.string.unread)
                            Text(unreadCount.coerceAtMost(99).toString(), Modifier.padding(start = 6.dp).background(COrange, RoundedCornerShape(10.dp)).padding(horizontal = 6.dp, vertical = 2.dp).semantics { contentDescription = unreadLabel }, color = Color.White, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                    conversation.lastMessagePreview?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Text((state.projects.find { it.id == conversation.projectId }?.name ?: state.owner?.label ?: "Agents One") + " · " + translatedState(conversation.activity), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
            }
            HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
        }
        if (state.conversationCursor != null) item { TextButton(onClick = { model.more(false) }, enabled = !state.busy) { Text(stringResource(R.string.more)) } }
    }
}

@Composable private fun CreateConversation(model: MobileViewModel, state: MobileState, close: () -> Unit) {
    var title by remember { mutableStateOf("") }
    var prompt by remember { mutableStateOf("") }
    var choice by remember { mutableStateOf<ExecutionPolicy?>(null) }
    val allowed = state.policies.filter { it.enforced && "create" in it.allowedActions && "advance" in it.allowedActions }
    val policy = currentPolicySelection(allowed, choice, state)
    androidx.compose.ui.window.Dialog(onDismissRequest = close, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.imePadding()) {
                Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = close) { Icon(Icons.Outlined.ArrowBack, stringResource(R.string.back)) }; Text(stringResource(R.string.new_conversation), style = MaterialTheme.typography.titleLarge) }
                HorizontalDivider()
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    CField(title, { title = it }, stringResource(R.string.title))
                    CField(prompt, { prompt = it }, stringResource(R.string.prompt), Modifier.testTag("new-conversation-prompt"), minLines = 5)
                    PolicySelector(allowed, state, policy) { choice = it }
                    state.error?.let { ErrorFeedback(translatedError(it), state.failureRequestId("global", it)) }
                }
                Button(onClick = { model.createConversation(title, prompt, policy!!, close) }, enabled = prompt.isNotBlank() && policy != null && !state.busy, modifier = Modifier.fillMaxWidth().padding(16.dp)) { Text(stringResource(R.string.c_create_send)) }
            }
        }
    }
}


@Composable private fun CConversationMenu(model: MobileViewModel, state: MobileState) {
    val conversation = state.selected ?: return
    val canManage = "manage" in conversation.allowedActions && "conversation:manage" in state.owner?.capabilities.orEmpty()
    var renameTarget by remember(conversation.id, state.owner?.dataEpoch, canManage) { mutableStateOf<Conversation?>(null) }
    renameTarget?.let { RenameConversationDialog(model, it, state) { renameTarget = null } }
    var projectTarget by remember(conversation.id, state.owner?.ownerId, state.owner?.spaceId, state.owner?.dataEpoch, canManage) { mutableStateOf<Conversation?>(null) }
    projectTarget?.let { ConversationProjectDialog(model, it, state) { projectTarget = null } }
    var expanded by remember(conversation.id) { mutableStateOf(false) }
    if (canManage) Box {
        IconButton(onClick = { expanded = true }, enabled = !state.busy, modifier = Modifier.testTag("conversation-actions")) { Icon(Icons.Outlined.MoreHoriz, stringResource(R.string.more)) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.rename)) }, onClick = { expanded = false; model.dismissError(); renameTarget = conversation })
            DropdownMenuItem(text = { Text(stringResource(if(conversation.pinned) R.string.unpin else R.string.pin)) }, onClick = { expanded = false; model.manageConversation(conversation, "pinned", !conversation.pinned) })
            DropdownMenuItem(text = { Text(stringResource(if(conversation.archived) R.string.unarchive else R.string.archive)) }, onClick = { expanded = false; model.manageConversation(conversation, "archived", !conversation.archived) })
            if (conversation.sourceKind == "runtime_conversation") DropdownMenuItem(text = { Text(stringResource(R.string.change_project)) }, enabled = conversation.activeRunIds.isEmpty(), onClick = { expanded = false; model.dismissError(); projectTarget = conversation })
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ConversationDetail(model: MobileViewModel, state: MobileState) {
    val conversation = state.selected!!
    var text by remember(conversation.id, state.owner?.dataEpoch, state.composerDraft) { mutableStateOf(state.composerDraft) }
    val policies = state.policies.filter { it.enforced && it.runtimeId == conversation.runtimeId && it.projectId == conversation.projectId && "advance" in it.allowedActions }
    var selectedPolicy by remember(conversation.id, state.owner?.ownerId, state.owner?.spaceId, state.owner?.dataEpoch, conversation.projectId) { mutableStateOf<ExecutionPolicy?>(null) }
    val policy = if (selectedPolicy == null) policies.firstOrNull { policyCatalogAvailable(it, state) } else currentPolicySelection(policies, selectedPolicy, state)
    var policySheet by remember(conversation.id) { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var foreground by remember(lifecycle) { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    fun visibleSequences(): List<String> {
        val keys = listState.layoutInfo.visibleItemsInfo.map { it.key }.toSet()
        return state.messages.filter { it.visibleToUser && "${it.conversationId}:${it.messageSeq}" in keys }.map { it.messageSeq }
    }
    DisposableEffect(lifecycle, conversation.id) {
        val observer = LifecycleEventObserver { _, _ ->
            foreground = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
            if (!foreground) model.stopReadObservation()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); model.stopReadObservation() }
    }
    LaunchedEffect(conversation.id, state.owner?.dataEpoch, state.messages, foreground, state.busy) {
        if (foreground && !state.busy && !state.demo) snapshotFlow { visibleSequences() }
            .distinctUntilChanged().collect { model.acknowledgeVisible(conversation.id, it) }
    }
    LaunchedEffect(conversation.id, state.messages.lastOrNull()?.messageSeq, state.pendingMessages.lastOrNull()?.id, state.runs.lastOrNull()?.lastRunEventSeq) {
        val count = listState.layoutInfo.totalItemsCount
        if (count > 0) listState.animateScrollToItem(count - 1)
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        state.readError?.let { code -> Row(Modifier.padding(horizontal = 16.dp)) {
            ErrorFeedback(stringResource(R.string.read_sync_failed, translatedError(code)), state.failureRequestId("read", code), Modifier.weight(1f))
            TextButton(onClick = { model.retryRead(conversation.id, visibleSequences()) }, enabled = foreground && !state.busy) { Text(stringResource(R.string.retry_read_sync)) }
        } }
        LazyColumn(Modifier.weight(1f).testTag("conversation-messages"), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val messages = state.messages.filter { it.visibleToUser }
            if (state.hasOlderMessages) item { TextButton(onClick = model::olderMessages, enabled = !state.busy) { Text(stringResource(R.string.older_messages)) } }
            state.messageError?.let { code -> item { ErrorFeedback(translatedError(code), state.failureRequestId("message", code)) } }
            if (messages.isEmpty() && state.pendingMessages.none { it.conversationId == conversation.id }) item { Text(stringResource(R.string.empty_messages)) }
            itemsIndexed(messages, key = { _, row -> "${row.conversationId}:${row.messageSeq}" }) { index, message ->
                if (index == 0 || messageDate(messages[index - 1].createdAt, state.language) != messageDate(message.createdAt, state.language))
                    ConversationDateDivider(message.createdAt, state.language)
                ConversationMessageItem(message, state, model)
            }
            items(state.pendingMessages.filter { it.conversationId == conversation.id }, key = { "pending:${it.id}" }) { pending ->
                PendingMessageItem(pending, model, state)
            }
            val runs = state.runs.filter { it.conversationId == conversation.id }
            if (runs.isNotEmpty() || state.runError != null) item(key = "run-status") { RunStatusPanel(model, state) }
            items(runs, key = { "run:${it.runId}" }) { RunStatusCard(it, model, state) }
        }
        if (state.syncError != null) Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.small) {
            Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                ErrorFeedback(stringResource(R.string.live_sync_failed, translatedError(state.syncError!!)), state.failureRequestId("sync", state.syncError!!), Modifier.weight(1f), MaterialTheme.colorScheme.onSecondaryContainer)
                TextButton(onClick = model::retryEventObservation) { Text(stringResource(R.string.retry_read_sync)) }
            }
        }
        state.error?.let { error -> Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            ErrorFeedback(translatedError(error), state.failureRequestId("global", error), Modifier.weight(1f), MaterialTheme.colorScheme.error)
            IconButton(onClick = model::dismissError) { Icon(Icons.Outlined.Close, stringResource(R.string.close)) }
        } }
        if ("advance" in conversation.allowedActions && policies.isNotEmpty()) {
            TextButton(onClick = { policySheet = true }, enabled = !state.busy, modifier = Modifier.testTag("continuation-mode")) {
                Text(stringResource(when(policy?.mode) { "desktop_execute" -> R.string.task_execute; "desktop_analysis" -> R.string.task_analysis; "desktop_auto" -> R.string.task_auto; "desktop_full_access" -> R.string.task_full_access; "project_write" -> R.string.policy_project_write; "inspect" -> R.string.policy_inspect; else -> R.string.policy }))
                Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp))
            }
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextField(text, { text = it; model.composerDraft(it) }, Modifier.weight(1f), placeholder = { Text(stringResource(R.string.message_hint)) }, maxLines = 5,
                    colors = TextFieldDefaults.colors(focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer, unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer))
                Button(onClick = { policy?.let { chosen -> val submitted = text; model.advance(submitted, chosen) { if (text == submitted) { text = ""; model.composerDraft("") } } } }, enabled = policy != null && text.isNotBlank() && !state.busy && conversation.activeRunIds.isEmpty(), modifier = Modifier.heightIn(min = 56.dp)) { Icon(Icons.Outlined.ArrowUpward, stringResource(R.string.send)) }
            }
        } else Text(stringResource(R.string.read_only), Modifier.padding(16.dp))
    }
    if (policySheet) ModalBottomSheet(onDismissRequest = { policySheet = false }, containerColor = MaterialTheme.colorScheme.background) {
        Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState())) {
            PolicySelector(policies, state, policy) { selectedPolicy = it }
            TextButton(onClick = { policySheet = false }) { Text(stringResource(R.string.close)) }
        }
    }
}

private fun messageDate(value: String, language: String): String = runCatching {
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.forLanguageTag(language))
        .format(Instant.parse(value).atZone(ZoneId.systemDefault()))
}.getOrDefault(value.take(10))

private fun messageTime(value: String, language: String): String = runCatching {
    DateTimeFormatter.ofPattern(if (language.startsWith("zh")) "HH:mm" else "h:mm a", Locale.forLanguageTag(language))
        .format(Instant.parse(value).atZone(ZoneId.systemDefault()))
}.getOrDefault("")

@Composable private fun ConversationDateDivider(value: String, language: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
        Text(messageDate(value, language), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable private fun ConversationMessageItem(message: Message, state: MobileState, model: MobileViewModel) {
    val bindingKey = listOf(state.owner?.ownerId, state.owner?.spaceId, state.owner?.dataEpoch).joinToString("\u0000")
    val runtime = state.runtimes.find { it.id == message.runtimeId } ?: state.selected?.let { selected -> state.runtimes.find { it.id == selected.runtimeId } }
    val mine = message.kind == "user"
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!mine) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RuntimeAvatarImage(runtime, runtime?.id ?: message.runtimeId.orEmpty(), model.runtimeAvatarSource(), loadEnabled = !state.demo, load = model::loadRuntimeAvatar)
            Text(runtime?.name ?: state.selected?.runtimeId.orEmpty(), style = MaterialTheme.typography.labelLarge)
            Text(messageTime(message.createdAt, state.language), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else Text(messageTime(message.createdAt, state.language), Modifier.fillMaxWidth(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            if (mine) Box(Modifier.width(3.dp).heightIn(min = 36.dp).background(COrange))
            Surface(color = if (mine) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(4.dp)) {
                MessageBody(message, bindingKey, Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp))
            }
        }
    }
}

@Composable private fun PendingMessageItem(pending: PendingUserMessage, model: MobileViewModel, state: MobileState) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(messageTime(pending.createdAt, state.language), Modifier.fillMaxWidth(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Box(Modifier.width(3.dp).heightIn(min = 36.dp).background(COrange))
            Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = RoundedCornerShape(4.dp)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
                    Text(pending.text, style = MaterialTheme.typography.bodyLarge)
                    when (pending.delivery) {
                        "sending" -> Text(stringResource(R.string.pending_sending), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                        "accepted" -> Text(stringResource(R.string.pending_accepted), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 6.dp))
                        "failed" -> TextButton(onClick = { model.restorePendingMessage(pending.id) }, contentPadding = PaddingValues(0.dp), modifier = Modifier.heightIn(min = 28.dp)) { Text(stringResource(R.string.pending_failed)) }
                        else -> TextButton(onClick = model::refreshConversation, contentPadding = PaddingValues(0.dp), modifier = Modifier.heightIn(min = 28.dp)) { Text(stringResource(R.string.pending_uncertain)) }
                    }
                }
            }
        }
    }
}
private fun actionLabel(action: String) = when (action) { "pause" -> R.string.pause; "resume" -> R.string.resume; "trigger" -> R.string.trigger; "discard-pending" -> R.string.discard_pending; "delete" -> R.string.delete_schedule; else -> R.string.confirm }
@Composable private fun Schedules(model: MobileViewModel, state: MobileState) {
    val draft = listSearchDraft(state, true)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item { Search(model, state, true, draft); ListFilterBar(model, state, true)
            Row(Modifier.fillMaxWidth().padding(16.dp)) { Text(stringResource(R.string.c_next_order), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(state.owner?.schedulerTimeZone ?: "", style = MaterialTheme.typography.labelSmall) }
        }
        state.scheduleError?.let { code -> item { ErrorFeedback(translatedError(code), state.failureRequestId("schedule", code), Modifier.padding(16.dp)) } }
        if (state.schedules.isEmpty() && state.scheduleError == null) item { Text(stringResource(R.string.empty_schedules), Modifier.padding(16.dp)) }
        items(state.schedules, key = { it.id }) { schedule ->
            Row(Modifier.fillMaxWidth().testTag("schedule-row:" + schedule.id).clickable(enabled = !state.busy) { model.openSchedule(schedule) }.padding(horizontal = 16.dp, vertical = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val next = runCatching { DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of(schedule.schedulerTimeZone)).format(Instant.parse(schedule.nextRunAt)) }.getOrDefault("—")
                Column(Modifier.width(50.dp)) { Text(next, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary); Text(stringResource(if (schedule.enabled) R.string.state_enabled else R.string.state_paused), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row { Text(schedule.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(translatedState(schedule.effectiveState), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
                     ScheduleFrequency(schedule.scheduleExpression, state.language)
                     ScheduleMetadata(schedule.id, schedule.nextRunAt, schedule.schedulerTimeZone, schedule.recentExecution, state.language)
                 }
            }
            HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
        }
        if (state.scheduleCursor != null) item { TextButton(onClick = { model.more(true) }, enabled = !state.busy) { Text(stringResource(R.string.more)) } }
    }
}
@Composable private fun ScheduleEditor(model: MobileViewModel, state: MobileState, close: () -> Unit) {
    val schedule = state.selectedSchedule
    var name by remember(schedule?.id) { mutableStateOf(schedule?.name ?: "") }
    var prompt by remember(schedule?.id) { mutableStateOf(schedule?.prompt ?: "") }
    var expression by remember(schedule?.id) { mutableStateOf(schedule?.scheduleExpression ?: "") }
    var timeout by remember(schedule?.id) { mutableStateOf(((schedule?.timeoutMs ?: 300_000) / 1000).toString()) }
    var concurrency by remember(schedule?.id) { mutableStateOf(schedule?.concurrencyPolicy ?: "skip") }
    var choice by remember(schedule?.id) { mutableStateOf(state.policies.find { it.id == schedule?.executionPolicyId }) }
    val allowed = state.policies.filter { it.enforced && it.unattendedApproved && "trigger" in it.allowedActions }
    val policy = currentPolicySelection(allowed, choice, state)
    val timeoutSeconds = timeout.toLongOrNull()?.takeIf { it in 1..86_400 } ?: 0
    val candidate = buildJsonObject {
        put("name", name); put("prompt", prompt); put("scheduleExpression", expression)
        put("timeoutMs", timeoutSeconds * 1000); put("concurrencyPolicy", concurrency)
        policy?.let { put("runtimeId", it.runtimeId); put("executionPolicyId", it.id); put("projectId", it.projectId?.let(::JsonPrimitive) ?: kotlinx.serialization.json.JsonNull) }
    }
    androidx.compose.ui.window.Dialog(onDismissRequest = close, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.imePadding()) {
        Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = close) { Icon(Icons.Outlined.ArrowBack, stringResource(R.string.back)) }; Text(stringResource(if (schedule == null) R.string.new_schedule else R.string.edit), style = MaterialTheme.typography.titleLarge) }
        HorizontalDivider()
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            CField(name, { name = it }, stringResource(R.string.name))
            CField(prompt, { prompt = it }, stringResource(R.string.prompt), minLines = 4)
            PolicySelector(allowed, state, policy) { choice = it }
            ScheduleTimingOptions(expression, { expression = it }, timeout, { timeout = it }, concurrency, { concurrency = it }, state.language)

            state.preview?.let { preview ->
                Text(stringResource(R.string.owner_timezone, preview.schedulerTimeZone))
                preview.nextOccurrences.forEach { occurrence ->
                    val date = runCatching { DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.forLanguageTag(state.language)).withZone(ZoneId.of(preview.schedulerTimeZone)).format(Instant.parse(occurrence)) }.getOrDefault(occurrence)
                    Text(date)
                }
            }
        }
        state.error?.let { ErrorFeedback(translatedError(it), state.failureRequestId("global", it), Modifier.padding(horizontal = 16.dp)) }
        Button(onClick = { if (model.matchesPreview(candidate)) model.saveSchedule(candidate, close) else model.previewSchedule(candidate) }, enabled = name.isNotBlank() && prompt.isNotBlank() && expression.isNotBlank() && timeoutSeconds > 0 && policy != null && !state.busy, modifier = Modifier.fillMaxWidth().padding(16.dp)) { Text(stringResource(if (model.matchesPreview(candidate)) R.string.save else R.string.preview)) }
        }
        }
    }
}
