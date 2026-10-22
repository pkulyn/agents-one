package one.agents.mobile

import java.io.File
import java.io.OutputStream
import java.util.UUID
import one.agents.mobile.contract.Artifact

internal data class PreparedArtifact(val file: File, val metadata: Artifact, val current: () -> Boolean)

/** User-requested output staging only. No task state or credentials are stored here. */
internal class ArtifactFiles(cacheDirectory: File) {
    private val root = File(cacheDirectory.canonicalFile, "artifact-transfers")
    private val owned = java.util.concurrent.ConcurrentHashMap.newKeySet<File>()
    init {
        check(root.canonicalFile == root.absoluteFile) { "Unsafe artifact cache" }
        check(root.mkdirs() || root.isDirectory)
        synchronized(ownership) {
            root.listFiles()?.filter { it !in live && it.isFile && it.name.matches(Regex("artifact-[0-9a-f-]{36}\\.tmp")) && it.canonicalFile.parentFile == root }?.forEach { it.delete() }
        }
    }
    fun stage(write: (OutputStream) -> Unit): File {
        val file = File(root, "artifact-${UUID.randomUUID()}.tmp")
        synchronized(ownership) { check(file.createNewFile()); owned.add(file); live.add(file) }
        try { file.outputStream().use(write); return file }
        catch (error: Throwable) { discard(file); throw error }
    }
    fun discard(file: File) = synchronized(ownership) {
        if (file in owned && file.parentFile == root && file.canonicalFile.parentFile == root) {
            if (!file.exists() || file.delete()) { owned.remove(file); live.remove(file) }
        }
    }
    fun clear() { owned.toList().forEach(::discard) }
    companion object {
        private val ownership = Any()
        private val live = java.util.concurrent.ConcurrentHashMap.newKeySet<File>()
    }
}

internal fun artifactDisplayName(name: String): String = name.substringAfterLast('/').substringAfterLast('\\')
    .replace(Regex("[\\p{Cntrl}]"), "_").take(120).trim().takeIf { it.isNotEmpty() && it !in setOf(".", "..") } ?: "result"
