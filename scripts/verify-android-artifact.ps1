[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ApkPath,
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,
  [string]$ExpectedPackage = '',
  [switch]$AllowDebugCertificate
)

$ErrorActionPreference = 'Stop'

function Find-AndroidBuildTool([string]$name) {
  $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  $candidate = foreach ($directory in (Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
    foreach ($extension in @('.exe', '.bat')) {
      $path = Join-Path $directory.FullName "$name$extension"
      if (Test-Path -LiteralPath $path) { $path; break }
    }
    if ($path -and (Test-Path -LiteralPath $path)) { break }
  }
  if (-not $candidate) { throw "No se encontró $name.exe en el Android SDK ($sdk)." }
  return $candidate
}

$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
if (-not $resolvedApk.EndsWith('.apk', [StringComparison]::OrdinalIgnoreCase)) { throw 'ApkPath debe referirse a un archivo .apk.' }
$uri = [Uri]$ApiUrl
if ($uri.Scheme -ne 'https' -or -not $uri.AbsolutePath.EndsWith('/api')) { throw 'ApiUrl debe usar HTTPS y terminar exactamente en /api.' }

$aapt = Find-AndroidBuildTool 'aapt'
$apksigner = Find-AndroidBuildTool 'apksigner'
$badging = & $aapt dump badging $resolvedApk
if ($LASTEXITCODE -ne 0) { throw 'aapt no pudo leer el APK.' }
$packageLine = $badging | Select-String "^package:"
if (-not $packageLine) { throw 'No se encontró metadato package en el APK.' }
$packageName = [regex]::Match($packageLine, "name='([^']+)'").Groups[1].Value
$versionCode = [regex]::Match($packageLine, "versionCode='([^']+)'").Groups[1].Value
$versionName = [regex]::Match($packageLine, "versionName='([^']+)'").Groups[1].Value
if ($ExpectedPackage -and $packageName -ne $ExpectedPackage) { throw "El paquete es $packageName; se esperaba $ExpectedPackage." }

$signing = & $apksigner verify --verbose --print-certs $resolvedApk 2>&1
if ($LASTEXITCODE -ne 0) { throw "La firma APK no es válida.`n$($signing -join "`n")" }
$debugSigned = ($signing -join "`n") -match 'CN=Android Debug'
if ($debugSigned -and -not $AllowDebugCertificate) { throw 'El APK usa certificado Android Debug. Solo es aceptable para QA con -AllowDebugCertificate.' }

$file = Get-Item -LiteralPath $resolvedApk
$result = [ordered]@{
  apk = $resolvedApk
  sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedApk).Hash
  bytes = $file.Length
  package = $packageName
  versionName = $versionName
  versionCode = [int]$versionCode
  apiUrl = $uri.AbsoluteUri.TrimEnd('/')
  certificate = if ($debugSigned) { 'debug (solo QA)' } else { 'no-debug verificado' }
  verifiedAtUtc = [DateTime]::UtcNow.ToString('o')
}

$result | ConvertTo-Json
