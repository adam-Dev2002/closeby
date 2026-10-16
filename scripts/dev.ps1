param(
    [ValidateSet('start', 'web', 'android', 'typecheck', 'check')]
    [string]$Task = 'start'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$localRuntime = Get-ChildItem -Path (Join-Path $projectDirectory '.tools/node-*-win-*') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } |
    Sort-Object Name -Descending |
    Select-Object -First 1

if ($localRuntime) {
    $env:Path = $localRuntime.FullName + [IO.Path]::PathSeparator + $env:Path
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js LTS from https://nodejs.org or run: python scripts/bootstrap-node.py'
}

$env:npm_config_cache = Join-Path $projectDirectory '.npm-cache'
if ($Task -eq 'android') {
    $localAndroidSdk = Join-Path $projectDirectory '.tools/android-sdk'
    if (Test-Path -LiteralPath (Join-Path $localAndroidSdk 'emulator/emulator.exe')) {
        $env:ANDROID_HOME = $localAndroidSdk
        $env:ANDROID_SDK_ROOT = $localAndroidSdk
        $googleAvdDirectory = Join-Path $projectDirectory '.tools/android-avd-google'
        $env:ANDROID_AVD_HOME = if (Test-Path -LiteralPath (Join-Path $googleAvdDirectory 'Closeby_Phone_Google_API_36.ini')) { $googleAvdDirectory } else { Join-Path $projectDirectory '.tools/android-avd' }
        $env:ANDROID_USER_HOME = Join-Path $projectDirectory '.tools/android-user'
        $env:__UNSAFE_EXPO_HOME_DIRECTORY = Join-Path $projectDirectory '.tools/expo-cache'
        $env:Path = (Join-Path $localAndroidSdk 'platform-tools') + [IO.Path]::PathSeparator + $env:Path
        New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME | Out-Null
    }
}
Push-Location $projectDirectory
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    if ($Task -eq 'android') { & npm.cmd run start -- --android }
    else { & npm.cmd run $Task }
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
