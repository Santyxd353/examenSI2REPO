[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-vestidor18',
  [string]$Location = 'eastus2',
  [string]$Prefix = 'vestidor18',
  [string]$SubscriptionId = '',
  [string]$PostgresAdminPassword = '',
  [string]$JwtSecret = '',
  [string]$ImageTag = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function New-RandomSecret([int]$Bytes = 48) {
  $data = [byte[]]::new($Bytes)
  [Security.Cryptography.RandomNumberGenerator]::Fill($data)
  return 'Aa1' + [Convert]::ToBase64String($data).Replace('+', 'A').Replace('/', 'B').Replace('=', 'C')
}

function Invoke-AzJson([string[]]$Arguments) {
  $raw = & az @Arguments --only-show-errors --output json
  if ($LASTEXITCODE -ne 0) { throw "Azure CLI falló: az $($Arguments -join ' ')" }
  return ($raw -join "`n") | ConvertFrom-Json
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw 'Azure CLI no está instalado. Instala https://aka.ms/installazurecliwindows y ejecuta az login.'
}

$account = Invoke-AzJson @('account', 'show')
if ($SubscriptionId) {
  & az account set --subscription $SubscriptionId
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo seleccionar la suscripción indicada.' }
  $account = Invoke-AzJson @('account', 'show')
}
Write-Host "Suscripción: $($account.name) ($($account.id))"

foreach ($namespace in @('Microsoft.App', 'Microsoft.ContainerRegistry', 'Microsoft.DBforPostgreSQL', 'Microsoft.ManagedIdentity', 'Microsoft.OperationalInsights', 'Microsoft.Storage')) {
  & az provider register --namespace $namespace --wait --only-show-errors | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo registrar $namespace." }
}

if (-not $PostgresAdminPassword) { $PostgresAdminPassword = $env:AZURE_POSTGRES_PASSWORD }
if (-not $JwtSecret) { $JwtSecret = $env:AZURE_JWT_SECRET }
if (-not $PostgresAdminPassword) { $PostgresAdminPassword = New-RandomSecret 36 }
if (-not $JwtSecret) { $JwtSecret = New-RandomSecret 64 }
if ($PostgresAdminPassword.Length -lt 24) { throw 'PostgresAdminPassword debe tener al menos 24 caracteres.' }
if ($JwtSecret.Length -lt 48) { throw 'JwtSecret debe tener al menos 48 caracteres.' }
if ($Prefix -notmatch '^[a-z][a-z0-9-]{2,17}$') { throw 'Prefix debe usar 3-18 caracteres: minúsculas, números o guiones.' }

if (-not $ImageTag) {
  $ImageTag = (& git -C $repoRoot rev-parse --short=12 HEAD 2>$null)
  if (-not $ImageTag) { $ImageTag = Get-Date -Format 'yyyyMMddHHmmss' }
}
$ImageTag = $ImageTag -replace '[^a-zA-Z0-9_.-]', '-'

& az group create --name $ResourceGroup --location $Location --only-show-errors --output none
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear o actualizar el grupo de recursos.' }

$mainParametersPath = Join-Path ([IO.Path]::GetTempPath()) "vestidor-main-$([guid]::NewGuid()).json"
$appParametersPath = Join-Path ([IO.Path]::GetTempPath()) "vestidor-app-$([guid]::NewGuid()).json"
try {
  $mainParameters = @{
    '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
    contentVersion = '1.0.0.0'
    parameters = @{
      prefix = @{ value = $Prefix }
      location = @{ value = $Location }
      postgresAdminPassword = @{ value = $PostgresAdminPassword }
    }
  }
  [IO.File]::WriteAllText($mainParametersPath, ($mainParameters | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

  $deploymentName = "vestidor-infra-$ImageTag"
  $outputs = Invoke-AzJson @(
    'deployment', 'group', 'create', '--name', $deploymentName,
    '--resource-group', $ResourceGroup,
    '--template-file', (Join-Path $repoRoot 'infra/azure/main.bicep'),
    '--parameters', "@$mainParametersPath", '--query', 'properties.outputs'
  )

  $acrName = $outputs.acrName.value
  $image = "$($outputs.acrLoginServer.value)/vestidor18:$ImageTag"
  Write-Host "Construyendo imagen $image en Azure Container Registry..."
  & az acr build --registry $acrName --image "vestidor18:$ImageTag" --file (Join-Path $repoRoot 'Dockerfile.azure') $repoRoot --only-show-errors
  if ($LASTEXITCODE -ne 0) { throw 'Falló la construcción de la imagen.' }

  $webOrigin = "https://$($outputs.appName.value).$($outputs.environmentDefaultDomain.value)"
  $encodedDatabasePassword = [Uri]::EscapeDataString($PostgresAdminPassword)
  $databaseUrl = "postgresql://$($outputs.postgresAdminLogin.value):$encodedDatabasePassword@$($outputs.postgresFqdn.value):5432/$($outputs.databaseName.value)?sslmode=require"
  $appParameters = @{
    '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
    contentVersion = '1.0.0.0'
    parameters = @{
      location = @{ value = $Location }
      appName = @{ value = $outputs.appName.value }
      environmentName = @{ value = $outputs.environmentName.value }
      environmentStorageName = @{ value = $outputs.environmentStorageName.value }
      acrName = @{ value = $acrName }
      identityName = @{ value = $outputs.identityName.value }
      image = @{ value = $image }
      webOrigin = @{ value = $webOrigin }
      databaseUrl = @{ value = $databaseUrl }
      jwtSecret = @{ value = $JwtSecret }
    }
  }
  [IO.File]::WriteAllText($appParametersPath, ($appParameters | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

  $appOutputs = Invoke-AzJson @(
    'deployment', 'group', 'create', '--name', "vestidor-app-$ImageTag",
    '--resource-group', $ResourceGroup,
    '--template-file', (Join-Path $repoRoot 'infra/azure/app.bicep'),
    '--parameters', "@$appParametersPath", '--query', 'properties.outputs'
  )
  $url = $appOutputs.url.value

  $healthy = $false
  for ($attempt = 1; $attempt -le 24; $attempt++) {
    try {
      $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 10
      if ($health.status -eq 'ok') { $healthy = $true; break }
    } catch {
      Start-Sleep -Seconds 10
    }
  }
  if (-not $healthy) { throw "Despliegue creado, pero $url/api/health no respondió correctamente." }

  Write-Host "Aplicación: $url"
  Write-Host "Salud: $url/api/health"
  Write-Host "App móvil: EXPO_PUBLIC_API_URL=$url/api"
} finally {
  Remove-Item -LiteralPath $mainParametersPath, $appParametersPath -Force -ErrorAction SilentlyContinue
}
