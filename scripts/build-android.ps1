param(
    [ValidateSet('x86_64', 'arm64-v8a', 'phone-and-emulator', 'all')][string]$Architecture = 'x86_64',
    [ValidateSet('debug', 'release')][string]$Variant = 'debug',
    [switch]$SkipPrebuild,
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$taskJdk = Get-ChildItem -Path (Join-Path $projectDirectory '.tools/jdk-*') -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/javac.exe') } | Sort-Object Name -Descending | Select-Object -First 1
$taskNode = Get-ChildItem -Path (Join-Path $projectDirectory '.tools/node-*-win-*') -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $taskJdk -or -not $taskNode) { throw 'Run python scripts/bootstrap-native.py and scripts/bootstrap-node.py first.' }
$env:JAVA_HOME = $taskJdk.FullName
$env:ANDROID_HOME = Join-Path $projectDirectory '.tools/android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = Join-Path $projectDirectory '.tools/android-user'
# Keep native dependency header paths below Windows' 260-character limit.
$taskGradleCache = Join-Path $projectDirectory '.tools/g'
$env:GRADLE_USER_HOME = $taskGradleCache
$env:NODE_ENV = if ($Variant -eq 'release') { 'production' } else { 'development' }
$env:Path = (Join-Path $taskJdk.FullName 'bin') + ';' + $taskNode.FullName + ';' + (Join-Path $env:ANDROID_HOME 'platform-tools') + ';' + $env:Path
$taskSigningVariables = @('CLOSEBY_RELEASE_STORE_FILE', 'CLOSEBY_RELEASE_STORE_PASSWORD', 'CLOSEBY_RELEASE_KEY_ALIAS', 'CLOSEBY_RELEASE_KEY_PASSWORD')
$taskPreviousSigning = @{}
foreach ($taskName in $taskSigningVariables) { $taskPreviousSigning[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
Push-Location $projectDirectory
try {
    if ($Variant -eq 'release') {
        $taskSigningDirectory = Join-Path $projectDirectory '.private/android-release'
        New-Item -ItemType Directory -Force -Path $taskSigningDirectory | Out-Null
        # Only this Windows account and SYSTEM may read the private signing files.
        $taskSigningSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        & icacls.exe $taskSigningDirectory /inheritance:r /grant:r "*${taskSigningSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not protect the release signing directory.' }
        & node scripts/android-release-key.cjs ensure
        if ($LASTEXITCODE -ne 0) { throw 'Release signing setup failed.' }
        $taskCredentials = Get-Content -LiteralPath (Join-Path $taskSigningDirectory 'credentials.json') -Raw -Encoding utf8 | ConvertFrom-Json
        $env:CLOSEBY_RELEASE_STORE_FILE = Join-Path $taskSigningDirectory 'closeby-release.p12'
        $env:CLOSEBY_RELEASE_STORE_PASSWORD = $taskCredentials.storePassword
        $env:CLOSEBY_RELEASE_KEY_ALIAS = $taskCredentials.alias
        $env:CLOSEBY_RELEASE_KEY_PASSWORD = $taskCredentials.storePassword
    }
    if ($SkipPrebuild) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'android/gradlew.bat'))) { throw 'Generate the Android project before using -SkipPrebuild.' }
    } else {
        & node node_modules/expo/bin/cli prebuild --platform android --no-install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    $taskVariantName = if ($Variant -eq 'release') { 'Release' } else { 'Debug' }
    $taskArguments = @((":app:assemble" + $taskVariantName), '--max-workers=2', '--no-daemon', '--console=plain')
    if ($Variant -eq 'release') { $taskArguments += @('--init-script', (Join-Path $PSScriptRoot 'release-signing.gradle')) }
    $taskJavaPaths = (Get-ChildItem -Path (Join-Path $projectDirectory '.tools/jdk-*') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/javac.exe') } | ForEach-Object { $_.FullName }) -join ','
    $taskArguments += "-Porg.gradle.java.installations.paths=$taskJavaPaths"
    $taskReactArtifact = Join-Path $projectDirectory ".tools/maven/com/facebook/react/react-android/0.86.3/react-android-0.86.3-$Variant.aar"
    if (Test-Path -LiteralPath $taskReactArtifact) {
        $taskHash = (Get-FileHash -LiteralPath $taskReactArtifact -Algorithm SHA256).Hash.ToLowerInvariant()
        $taskExpectedHash = if ($Variant -eq 'release') { '59b66e453d8775a54df66a321c0d5002b98716d68c4bd9edb8e64d7110ff8d28' } else { '21235cb3b34912f2c5042dfd293be3334735a7beafcf28c0c59f1ccbd13733e8' }
        if ($taskHash -ne $taskExpectedHash) { throw 'The local React Native artifact failed checksum validation.' }
        $taskArguments += @('--init-script', (Join-Path $PSScriptRoot 'verified-maven.gradle'), "-PclosebyVerifiedMaven=$(Join-Path $projectDirectory '.tools/maven')")
    }
    if ($Architecture -ne 'all') {
        $taskArchitectures = if ($Architecture -eq 'phone-and-emulator') { 'arm64-v8a,x86_64' } else { $Architecture }
        $taskArguments += "-PreactNativeArchitectures=$taskArchitectures"
    }
    Push-Location (Join-Path $projectDirectory 'android')
    try { & .\gradlew.bat @taskArguments; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }
    $taskApk = Join-Path $projectDirectory "android/app/build/outputs/apk/$Variant/app-$Variant.apk"
    Write-Output "Android $Variant APK: $taskApk"
    if ($Variant -eq 'release') {
        $taskBuildTools = Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
        $taskVerification = & (Join-Path $taskBuildTools.FullName 'apksigner.bat') verify --verbose --print-certs $taskApk
        if ($LASTEXITCODE -ne 0) { throw 'Release APK signature verification failed.' }
        $taskCertificate = Get-Content -LiteralPath (Join-Path $taskSigningDirectory 'certificate.json') -Raw -Encoding utf8 | ConvertFrom-Json
        $taskSignerMatch = [regex]::Match(($taskVerification -join "`n"), 'Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)')
        if (-not $taskSignerMatch.Success -or $taskSignerMatch.Groups[1].Value -ne $taskCertificate.sha256.Replace(':', '')) {
            throw 'APK was not signed with the expected private release key; refusing to export it.'
        }
        $taskVerification | Write-Output
        $taskDistributionDirectory = Join-Path $projectDirectory 'dist/android'
        New-Item -ItemType Directory -Force -Path $taskDistributionDirectory | Out-Null
        $taskVersion = (Get-Content -LiteralPath (Join-Path $projectDirectory 'app.json') -Raw -Encoding utf8 | ConvertFrom-Json).expo.version
        $taskDistributionApk = Join-Path $taskDistributionDirectory "Closeby-$taskVersion.apk"
        Copy-Item -LiteralPath $taskApk -Destination $taskDistributionApk -Force
        $taskChecksum = (Get-FileHash -LiteralPath $taskDistributionApk -Algorithm SHA256).Hash.ToLowerInvariant()
        "$taskChecksum  Closeby-$taskVersion.apk" | Set-Content -LiteralPath "$taskDistributionApk.sha256" -Encoding ascii
        Copy-Item -LiteralPath (Join-Path $taskSigningDirectory 'certificate.json') -Destination (Join-Path $taskDistributionDirectory 'signing-certificate.json') -Force
        Write-Output "Share this standalone APK: $taskDistributionApk"
        Write-Output 'Keep .private/android-release backed up privately; never share that directory with the APK.'
    }
    if ($Install) { & adb install -r $taskApk; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
} finally {
    foreach ($taskName in $taskSigningVariables) { [Environment]::SetEnvironmentVariable($taskName, $taskPreviousSigning[$taskName], 'Process') }
    Pop-Location
}
