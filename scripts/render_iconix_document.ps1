param(
  [string]$DocumentPath = 'docs/Lumina_SaaS_ICONIX_Grupo18.docx',
  [string]$OutputDirectory = '.local/iconix/render',
  [switch]$SkipRaster
)
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskDoc = [IO.Path]::GetFullPath((Join-Path $taskRepo $DocumentPath))
$taskOut = [IO.Path]::GetFullPath((Join-Path $taskRepo $OutputDirectory))
if (-not $taskDoc.StartsWith($taskRepo + [IO.Path]::DirectorySeparatorChar)) { throw 'Documento fuera del proyecto.' }
New-Item -ItemType Directory -Force -Path $taskOut | Out-Null
$taskPdf = Join-Path $taskOut (([IO.Path]::GetFileNameWithoutExtension($taskDoc)) + '.pdf')
$taskWord = $null
$taskOpened = $null
try {
  $taskWord = New-Object -ComObject Word.Application
  $taskWord.Visible = $false
  $taskWord.DisplayAlerts = 0
  $taskWord.AutomationSecurity = 3
  $taskOpened = $taskWord.Documents.Open($taskDoc, $false, $false, $false)
  for ($taskRound = 0; $taskRound -lt 3; $taskRound++) {
    $taskOpened.Repaginate()
    $null = $taskOpened.Fields.Update()
    # Fields.Update ya reconstruye TOC y sus PAGEREF. Repetir Update sobre la
    # colección COM durante su reconstrucción puede invalidar el enumerador.
  }
  $taskOpened.Save()
  $taskOpened.ExportAsFixedFormat($taskPdf, 17, $false, 0, 0, 1, 9999, 0, $true, $true, 1, $true, $true, $false)
  Write-Output ('Word: ' + $taskOpened.ComputeStatistics(2) + ' páginas; ' + $taskOpened.TablesOfContents.Count + ' índice; ' + $taskOpened.Bookmarks.Count + ' marcadores.')
} finally {
  if ($null -ne $taskOpened) { $taskOpened.Close($false); [Runtime.InteropServices.Marshal]::ReleaseComObject($taskOpened) | Out-Null }
  if ($null -ne $taskWord) { $taskWord.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($taskWord) | Out-Null }
}
if (-not $SkipRaster) {
  $taskPython = 'C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
  $env:PATH = 'C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin;' + $env:PATH
  & $taskPython -X utf8 (Join-Path $PSScriptRoot 'raster_iconix_document.py') $taskDoc $taskPdf $taskOut
  if ($LASTEXITCODE -ne 0) { throw 'Falló la rasterización del documento.' }
}
