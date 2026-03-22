param(
  [string]$BackupRoot = $env:QUEST_AGENT_BACKUP_ROOT
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "dogfood-common.ps1")

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

  Test-DogfoodCommandAvailable -CommandName "pg_dump"

  $backupDirectory = Get-DogfoodBackupDirectory -BackupRoot $environment.BackupRoot
  $timestamp = Get-DogfoodTimestamp
  $backupPath = Get-DogfoodBackupPath -BackupDirectory $backupDirectory -Timestamp $timestamp
  $manifestPath = Get-DogfoodManifestPath -BackupPath $backupPath

  Invoke-DogfoodNativeCommand -FilePath "pg_dump" -Arguments @(
    "--dbname=$($environment.SupabaseDbUrl)",
    "--file=$backupPath",
    "--no-owner",
    "--no-acl"
  ) | Out-Null

  $tableCounts = Get-DogfoodTableCounts -DatabaseUrl $environment.SupabaseDbUrl
  $manifest = ConvertTo-DogfoodManifest -BackupPath $backupPath -TableCounts $tableCounts -Environment $environment

  Save-DogfoodJson -Path $manifestPath -Value $manifest

  Write-Host ("Dogfood backup created: {0}" -f $backupPath)
  Write-Host ("Dogfood manifest created: {0}" -f $manifestPath)
  Write-Host ("Table counts: {0}" -f (Format-DogfoodCounts -TableCounts $tableCounts))
}
catch {
  Write-Error $_
  exit 1
}
