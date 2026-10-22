package one.agents.mobile

import java.io.File
import java.nio.file.Files
import org.junit.Test
import org.junit.Assert.*

class ArtifactFilesTest {
    private fun fixture(test: (File) -> Unit) {
        val root = Files.createTempDirectory("agents-one-artifact-test-").toFile()
        try { test(root) } finally {
            check(root.canonicalFile.parentFile == File(checkNotNull(System.getProperty("java.io.tmpdir"))).canonicalFile && root.name.startsWith("agents-one-artifact-test-"))
            root.deleteRecursively()
        }
    }
    // @lat: [[mobile-data#Mobile data#Android artifact staging cleanup]]
    @Test fun failedVerificationDeletesPartialBytesAndSuccessfulDeliveryCanBeDiscarded() = fixture { root ->
        val files = ArtifactFiles(root)
        try { files.stage { it.write("partial".toByteArray()); throw java.io.IOException("hash mismatch") }; fail("Accepted partial output") }
        catch (_: java.io.IOException) { }
        assertTrue(File(root, "artifact-transfers").listFiles()!!.isEmpty())
        val completed = files.stage { it.write("verified".toByteArray()) }
        assertEquals("verified", completed.readText())
        assertTrue(completed.name.matches(Regex("artifact-[0-9a-f-]{36}\\.tmp")))
        files.discard(completed)
        assertFalse(completed.exists())
    }
    // @lat: [[mobile-data#Mobile data#Android artifact cache ownership]]
    @Test fun cleanupPreservesUnknownFilesAndAnotherLiveDelivery() = fixture { root ->
        val first = ArtifactFiles(root)
        val live = first.stage { it.write(1) }
        val unknown = File(root, "artifact-transfers/user-file.pdf").apply { writeText("keep") }
        val stale = File(root, "artifact-transfers/artifact-00000000-0000-0000-0000-000000000000.tmp").apply { writeText("stale") }
        ArtifactFiles(root)
        assertTrue(live.exists()); assertTrue(unknown.exists()); assertFalse(stale.exists())
        first.clear()
        assertFalse(live.exists()); assertTrue(unknown.exists())
    }
    // @lat: [[mobile-data#Mobile data#Android artifact filename handling]]
    @Test fun remoteNamesNeverBecomeLocalPaths() {
        assertEquals("result.pdf", artifactDisplayName("../../result.pdf"))
        assertEquals("result.pdf", artifactDisplayName("D:\\private\\result.pdf"))
        assertEquals("result", artifactDisplayName(".."))
        assertEquals("a_b", artifactDisplayName("a\u0000b"))
        assertTrue(artifactDisplayName("x".repeat(400)).length <= 120)
    }
}
