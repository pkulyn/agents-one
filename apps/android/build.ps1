param(
    [string]$JdkPath = $env:JAVA_HOME,
    [string]$AndroidSdkPath = $env:ANDROID_SDK_ROOT,
    [string]$GradleCachePath = $env:GRADLE_USER_HOME,
    [string]$PortableGradlePath = $env:GRADLE_HOME,
    [switch]$CoreOnly,
    [string[]]$Tasks = @('assembleDebug')
)
$ErrorActionPreference = 'Stop'
if (-not $JdkPath) { throw 'Supply -JdkPath or set JAVA_HOME to a user-installed JDK 17.' }
if (-not $AndroidSdkPath) { $AndroidSdkPath = $env:ANDROID_HOME }
if (-not $CoreOnly -and -not $AndroidSdkPath) { throw 'Supply -AndroidSdkPath or set ANDROID_SDK_ROOT.' }
$javaExecutable = Join-Path $JdkPath 'bin\java.exe'
if (-not (Test-Path -LiteralPath $javaExecutable)) { throw 'Portable JDK 17 is missing. Supply -JdkPath.' }
if (-not $CoreOnly -and -not (Test-Path -LiteralPath (Join-Path $AndroidSdkPath 'platforms\android-36\android.jar'))) {
    throw 'Android SDK platform 36 is missing. Install the SDK after accepting the Google SDK license, or run -CoreOnly -Tasks :core:test.'
}
$savedJavaHome = $env:JAVA_HOME
$savedSdkRoot = $env:ANDROID_SDK_ROOT
$savedAndroidHome = $env:ANDROID_HOME
$savedGradleCache = $env:GRADLE_USER_HOME
Push-Location $PSScriptRoot
try {
    $env:JAVA_HOME = $JdkPath
    $env:ANDROID_SDK_ROOT = $AndroidSdkPath
    $env:ANDROID_HOME = $AndroidSdkPath
    $env:GRADLE_USER_HOME = $GradleCachePath
    $portableLauncher = if ($PortableGradlePath) { Join-Path $PortableGradlePath 'lib\gradle-launcher-8.13.jar' } else { $null }
    if ($portableLauncher -and (Test-Path -LiteralPath $portableLauncher)) {
        $buildArguments = @('-Xms32m', '-Xmx128m', '-classpath', $portableLauncher, 'org.gradle.launcher.GradleMain', '--no-daemon', '--console=plain')
    } else {
        $buildArguments = @('-Xms32m', '-Xmx128m', '-classpath', (Join-Path $PSScriptRoot 'gradle\wrapper\gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', '--console=plain')
    }
    if ($CoreOnly) { $buildArguments += '-PcoreOnly' }
    & $javaExecutable @buildArguments @Tasks
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed (exit $LASTEXITCODE)." }
} finally {
    Pop-Location
    $env:JAVA_HOME = $savedJavaHome
    $env:ANDROID_SDK_ROOT = $savedSdkRoot
    $env:ANDROID_HOME = $savedAndroidHome
    $env:GRADLE_USER_HOME = $savedGradleCache
}
