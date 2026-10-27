plugins {
    id("com.android.application") version "8.13.2" apply false
    id("com.android.library") version "8.13.2" apply false
    kotlin("jvm") version "2.2.21" apply false
    kotlin("android") version "2.2.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.21" apply false
    kotlin("plugin.serialization") version "2.2.21" apply false
    id("com.google.devtools.ksp") version "2.2.21-2.0.5" apply false
    id("androidx.room") version "2.8.5" apply false
}
allprojects {
    dependencyLocking { lockAllConfigurations() }
}
