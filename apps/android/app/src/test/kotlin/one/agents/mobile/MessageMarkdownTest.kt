package one.agents.mobile

import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.font.FontWeight
import org.junit.Assert.*
import org.junit.Test

class MessageMarkdownTest {
    @Test fun rendersHeadingsEmphasisListsCodeAndTablesWithoutLosingCodeWhitespace() {
        val source = """# 中文 Heading

Hello **bold** and *italic*, ~~old~~ and `inline()`.

3. First
4. Second

> 引用 quote

```kotlin
  val value = "中 文"
    println(value)
```

| 名称 | Result |
| --- | --- |
| **项目** | [read](https://example.com/result) |
"""
        val blocks = parseMessageMarkdown(source)
        assertEquals("中文 Heading", (blocks[0] as MessageBlock.Prose).text.text)
        assertEquals(1, (blocks[0] as MessageBlock.Prose).heading)
        val prose = blocks.filterIsInstance<MessageBlock.Prose>()
        assertEquals("Hello bold and italic, old and inline().", prose[1].text.text)
        assertTrue(prose[1].text.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
        assertTrue(prose.any { it.text.text == "3. First" })
        assertTrue(prose.any { it.text.text == "4. Second" })
        assertTrue(prose.any { it.text.text == "› 引用 quote" })
        val code = blocks.filterIsInstance<MessageBlock.CodeBlock>().single()
        assertEquals("  val value = \"中 文\"\n    println(value)\n", code.text)
        assertEquals("kotlin", code.language)
        val table = blocks.filterIsInstance<MessageBlock.Table>().single()
        assertEquals(listOf(listOf("名称", "Result"), listOf("项目", "read")), table.rows.map { row -> row.map { it.text } })
        assertEquals("https://example.com/result", (table.rows[1][1].getLinkAnnotations(0, 4).single().item as LinkAnnotation.Url).url)
    }
    @Test fun onlyUserActivatedOrdinaryLinksHaveActionsAndImagesHtmlRemainInert() {
        val clicked = mutableListOf<String>()
        val blocks = parseMessageMarkdown("[web](https://example.com) [bad](javascript:alert) ![图像](https://example.com/pixel) <script>alert(1)</script>", clicked::add)
        val prose = blocks.single() as MessageBlock.Prose
        assertEquals("web bad 图像 <script>alert(1)</script>", prose.text.text)
        val links = prose.text.getLinkAnnotations(0, prose.text.length)
        assertEquals(1, links.size); assertTrue(clicked.isEmpty())
        links.single().item.linkInteractionListener!!.onClick(links.single().item)
        assertEquals(listOf("https://example.com"), clicked)
        val automatic = (parseMessageMarkdown("https://example.com/plain reader@example.com").single() as MessageBlock.Prose).text
        assertEquals(listOf("https://example.com/plain", "mailto:reader@example.com"), automatic.getLinkAnnotations(0, automatic.length).map { (it.item as LinkAnnotation.Url).url })
        listOf("javascript:alert(1)", "file:///D:/private", "intent://run", "data:text/html,x", "https://user:password@example.com", "https://example.com\n", "//example.com", "mailto:").forEach { assertFalse(it, allowedMessageLink(it)) }
        listOf("https://example.com/path?q=one#two", "http://example.com", "mailto:reader@example.com").forEach { assertTrue(it, allowedMessageLink(it)) }
    }
    @Test fun unfinishedStreamsAndDeepOrLargeStructuresPreserveTheWholeMessage() {
        val partial = parseMessageMarkdown("```text\nline one\n  line two")
        assertEquals("line one\n  line two\n", (partial.single() as MessageBlock.CodeBlock).text)
        val deep = "> ".repeat(40) + "end-marker 中文"
        assertEquals(deep, (parseMessageMarkdown(deep).single() as MessageBlock.Prose).text.text)
        val large = (1..10_001).joinToString("\n\n") { "Paragraph $it **bold**" } + "\n\nFINAL-完整标记"
        val blocks = parseMessageMarkdown(large)
        assertEquals(large, (blocks.single() as MessageBlock.Prose).text.text)
    }
}
