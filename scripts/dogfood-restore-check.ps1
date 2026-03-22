param(
  [string]$BackupRoot = $env:QUEST_AGENT_BACKUP_ROOT,
  [string]$ManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "dogfood-common.ps1")

function Compare-DogfoodCounts {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Expected,
    [Parameter(Mandatory = $true)]
    [hashtable]$Actual
  )

  $differences = New-Object System.Collections.Generic.List[string]
  foreach ($name in ($Expected.Keys + $Actual.Keys | Sort-Object -Unique)) {
    $expectedValue = if ($Expected.ContainsKey($name)) { [int64]$Expected[$name] } else { $null }
    $actualValue = if ($Actual.ContainsKey($name)) { [int64]$Actual[$name] } else { $null }
    if ($expectedValue -ne $actualValue) {
      $differences.Add(("{0}: expected={1} actual={2}" -f $name, $expectedValue, $actualValue))
    }
  }

  return $differences
}

try {
  $environment = Get-DogfoodRequiredEnvironment
  $resolvedBackupRoot = [string]$BackupRoot
  $resolvedBackupRoot = $resolvedBackupRoot.Trim()
  if (-not [string]::IsNullOrWhiteSpace($resolvedBackupRoot)) {
    $environment = [pscustomobject]@{
      RepoRoot = $environment.RepoRoot
      SupabaseUrl = $environment.SupabaseUrl
      SupabaseDbUrl = $environment.SupabaseDbUrl
      ExpectedSupabaseUrl = $environment.ExpectedSupabaseUrl
      BackupRoot = $resolvedBackupRoot
      DeploymentTarget = $environment.DeploymentTarget
    }
  }

  Test-DogfoodCommandAvailable -CommandName "psql"

  $backupDirectory = Get-DogfoodBackupDirectory -BackupRoot $environment.BackupRoot
  $resolvedManifestPath = [string]$ManifestPath
  $resolvedManifestPath = $resolvedManifestPath.Trim()
  if ([string]::IsNullOrWhiteSpace($resolvedManifestPath)) {
    $resolvedManifestPath = Get-DogfoodLatestManifestPath -BackupDirectory $backupDirectory
  }

  $manifest = Read-DogfoodJson -Path $resolvedManifestPath
  $expectedCounts = ConvertFrom-DogfoodManifestCounts -Manifest $manifest
  $backupPath = if ($manifest.backupPath) { [string]$manifest.backupPath } else { [System.IO.Path]::ChangeExtension($resolvedManifestPath, ".sql") }
  if (-not (Test-Path $backupPath)) {
    throw "Backup artifact not found: $backupPath"
  }
  $actualCounts = Get-DogfoodTableCounts -DatabaseUrl $environment.SupabaseDbUrl
  $differences = Compare-DogfoodCounts -Expected $expectedCounts -Actual $actualCounts

  if ($differences.Count -gt 0) {
    Write-Error ("Dogfood restore-check failed for {0}" -f $resolvedManifestPath)
    foreach ($difference in $differences) {
      Write-Error $difference
    }
    exit 1
  }

  Write-Host ("Dogfood restore-check OK: {0}" -f $resolvedManifestPath)
  Write-Host ("Backup artifact: {0}" -f $backupPath)
  Write-Host ("Table counts: {0}" -f (Format-DogfoodCounts -TableCounts $actualCounts))
}
catch {
  Write-Error $_
  exit 1
}
