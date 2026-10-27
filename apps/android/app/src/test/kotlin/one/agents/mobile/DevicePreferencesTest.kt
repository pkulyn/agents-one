package one.agents.mobile

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import javax.crypto.spec.SecretKeySpec
import one.agents.mobile.contract.Credentials
import one.agents.mobile.contract.Limits
import one.agents.mobile.contract.OwnerSpace
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DevicePreferencesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")

    @After
    fun clearPreferences() {
        context.getSharedPreferences("connection", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun ownerContextIsEncryptedAndBoundToEndpointDeviceAndGrant() {
        val preferences = DevicePreferences(context) { key }
        preferences.endpoint = "https://connect.example"
        val credentials = credentials()
        val owner = owner()
        preferences.saveLastOwnerContext(owner, credentials.grantRevision, credentials)

        val stored = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
            .getString("last_owner_context", null)
        assertNotNull(stored)
        assertFalse(stored!!.contains(owner.ownerId))
        val restored = preferences.lastOwnerContext(credentials)
        assertNotNull(restored)
        assertEquals(owner.ownerId, restored!!.owner.ownerId)
        assertEquals(listOf("conversation:read", "schedule:read"), restored.owner.capabilities)

        preferences.endpoint = "https://other.example"
        assertNull(preferences.lastOwnerContext(credentials))
        preferences.endpoint = "https://connect.example"
        assertNull(preferences.lastOwnerContext(credentials.copy(deviceId = "other-device")))
        assertNull(preferences.lastOwnerContext(credentials.copy(grantRevision = "8")))
    }

    @Test
    fun forgettingCredentialsAlsoRemovesOwnerPointerWithoutDeletingOtherPreferences() {
        val preferences = DevicePreferences(context) { key }
        preferences.endpoint = "https://connect.example"
        preferences.language = "zh-CN"
        val credentials = credentials()
        preferences.saveCredentials(credentials)
        preferences.saveLastOwnerContext(owner(), credentials.grantRevision, credentials)

        preferences.forgetCredentials()

        assertNull(preferences.credentials())
        assertNull(preferences.lastOwnerContext(credentials))
        assertEquals("https://connect.example", preferences.endpoint)
        assertEquals("zh-CN", preferences.language)
    }

    private fun credentials() = Credentials(
        deviceId = "device-1",
        accessToken = "access",
        accessExpiresAt = "2030-01-01T00:00:00Z",
        refreshCredential = "refresh",
        refreshExpiresAt = "2031-01-01T00:00:00Z",
        grantRevision = "7",
    )

    private fun owner() = OwnerSpace(
        ownerId = "owner-1",
        spaceId = "space-1",
        label = "My desktop",
        ownerType = "desktop",
        online = true,
        executionAvailable = true,
        schedulerOnline = true,
        schedulerTimeZone = "Asia/Shanghai",
        capabilities = listOf("conversation:read", "conversation:create", "schedule:read", "schedule:manage"),
        limits = Limits(100, 65_536, 262_144, 60_000, 14, 10_000, 600_000),
        dataEpoch = "epoch-1",
    )
}
