package one.agents.mobile

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.commonmark.node.*
import org.commonmark.ext.gfm.tables.*
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.parser.Parser
import java.net.URI

internal sealed interface MessageBlock {
    data class Prose(val text: AnnotatedString, val heading: Int = 0, val indent: Int = 0) : MessageBlock
    data class CodeBlock(val text: String, val language: String) : MessageBlock
    data class Table(val rows: List<List<AnnotatedString>>) : MessageBlock
    data object Rule : MessageBlock
}
private val messageParser = Parser.builder().extensions(listOf(TablesExtension.create(), StrikethroughExtension.create(), AutolinkExtension.create())).build()

internal fun allowedMessageLink(value: String): Boolean = runCatching {
    if (value.any { it.isWhitespace() || it.isISOControl() }) return false
    val uri = URI(value)
    when (uri.scheme?.lowercase()) {
        "http", "https" -> !uri.host.isNullOrBlank() && uri.rawUserInfo == null && (uri.port == -1 || uri.port in 1..65535)
        "mailto" -> !uri.rawSchemeSpecificPart.isNullOrBlank() && !uri.rawSchemeSpecificPart.startsWith("//")
        else -> false
    }
}.getOrDefault(false)

private fun Node.children(): Sequence<Node> = generateSequence(firstChild) { it.next }

// @lat: [[mobile-data#Mobile data#Android native message Markdown]]
internal fun parseMessageMarkdown(content: String, onLink: (String) -> Unit = {}): List<MessageBlock> {
    return try {
        val result = mutableListOf<MessageBlock>()
        var visited = 0
        fun admit(depth: Int) { check(depth <= 32 && ++visited <= 20_000) }
        fun inline(node: Node): AnnotatedString = buildAnnotatedString {
            fun appendNode(current: Node, depth: Int) {
                admit(depth)
                fun children() = current.children().forEach { appendNode(it, depth + 1) }
                when (current) {
                    is org.commonmark.node.Text -> append(current.literal)
                    is SoftLineBreak -> append(" ")
                    is HardLineBreak -> append("\n")
                    is Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(current.literal) }
                    is StrongEmphasis -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { children() }
                    is Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { children() }
                    is Strikethrough -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { children() }
                    is Link -> if (allowedMessageLink(current.destination)) {
                        val url = current.destination
                        withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline))) { onLink(url) }) { children() }
                    } else children()
                    is Image -> children() // Alt text only; message rendering never fetches remote images.
                    is HtmlInline -> append(current.literal)
                    else -> children()
                }
            }
            node.children().forEach { appendNode(it, 0) }
        }
        fun blocks(node: Node, depth: Int, prefix: String = "") {
            admit(depth)
            when (node) {
                is org.commonmark.node.Paragraph -> result.add(MessageBlock.Prose(buildAnnotatedString { append(prefix); append(inline(node)) }, indent = depth.coerceAtMost(4)))
                is Heading -> result.add(MessageBlock.Prose(inline(node), node.level))
                is FencedCodeBlock -> result.add(MessageBlock.CodeBlock(node.literal, node.info.orEmpty()))
                is IndentedCodeBlock -> result.add(MessageBlock.CodeBlock(node.literal, ""))
                is ThematicBreak -> result.add(MessageBlock.Rule)
                is HtmlBlock -> result.add(MessageBlock.Prose(AnnotatedString(node.literal)))
                is TableBlock -> {
                    val rows = node.children().flatMap { it.children() }.filterIsInstance<TableRow>().map { row -> row.children().filterIsInstance<TableCell>().map(::inline).toList() }.toList()
                    result.add(MessageBlock.Table(rows))
                }
                is OrderedList -> node.children().forEachIndexed { i, item -> item.children().forEachIndexed { j, child -> blocks(child, depth + 1, if (j == 0) "${(node.markerStartNumber ?: 1) + i}. " else "") } }
                is BulletList -> node.children().forEach { item -> item.children().forEachIndexed { j, child -> blocks(child, depth + 1, if (j == 0) "• " else "") } }
                is BlockQuote -> node.children().forEach { blocks(it, depth + 1, "› ") }
                else -> node.children().forEach { blocks(it, depth, prefix) }
            }
        }
        messageParser.parse(content).children().forEach { blocks(it, 0) }
        result.toList()
    } catch (_: Exception) {
        // Preserve all bytes as plain text when parsing/render structure exceeds the supported depth.
        listOf(MessageBlock.Prose(AnnotatedString(content)))
    }
}

@Composable internal fun MessageMarkdown(content: String, modifier: Modifier = Modifier, openLink: ((String) -> Unit)? = null) {
    val uriHandler = LocalUriHandler.current
    var failedLink by remember(content) { mutableStateOf<String?>(null) }
    val currentOpenLink by rememberUpdatedState(openLink ?: { url: String -> uriHandler.openUri(url) })
    val clickLink: (String) -> Unit = remember(content) { { url ->
        if (allowedMessageLink(url)) try { currentOpenLink(url); failedLink = null } catch (_: Exception) { failedLink = url }
    } }
    var blocks by remember(content) { mutableStateOf<List<MessageBlock>?>(null) }
    LaunchedEffect(content) {
        delay(60) // Coalesce fast streamed updates before parsing on a background dispatcher.
        val parsed = withContext(Dispatchers.Default) { parseMessageMarkdown(content, clickLink) }
        blocks = parsed
    }
    SelectionContainer {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (blocks == null) Text(content, style = MaterialTheme.typography.bodyLarge)
            else blocks!!.forEach { block -> when (block) {
                is MessageBlock.Prose -> Text(block.text, Modifier.fillMaxWidth().padding(start = (block.indent * 8).dp), style = when (block.heading) {
                    1 -> MaterialTheme.typography.headlineSmall
                    2 -> MaterialTheme.typography.titleLarge
                    3, 4, 5, 6 -> MaterialTheme.typography.titleMedium
                    else -> MaterialTheme.typography.bodyLarge
                })
                is MessageBlock.CodeBlock -> Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.small) {
                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                        if (block.language.isNotBlank()) Text(block.language, style = MaterialTheme.typography.labelSmall)
                        Row(Modifier.fillMaxWidth().testTag("message-code").horizontalScroll(rememberScrollState())) {
                            Text(block.text, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace), softWrap = false)
                        }
                    }
                }
                is MessageBlock.Table -> Column(Modifier.fillMaxWidth().testTag("message-table").horizontalScroll(rememberScrollState())) {
                    block.rows.forEachIndexed { index, row ->
                        Row { row.forEach { cell ->
                            Text(cell, Modifier.width(180.dp).padding(12.dp), style = MaterialTheme.typography.bodyLarge, fontWeight = if (index == 0) FontWeight.Bold else FontWeight.Normal)
                        } }
                        HorizontalDivider()
                    }
                }
                MessageBlock.Rule -> HorizontalDivider()
            } }
            failedLink?.let { url ->
                Text(stringResource(R.string.message_link_unavailable), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Text(url, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
