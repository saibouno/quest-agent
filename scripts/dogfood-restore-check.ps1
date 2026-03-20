[CmdletBinding()]
param(
  [string]$BackupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "dogfood-common.ps1")

$containerName = "quest-agent-dogfood-restore-check-{0}" -f ([System.Guid]::NewGuid().ToString("N").Substring(0, 12))
$cleanupContainer = $false

try {
  $resolvedBackupDirectory = Resolve-BackupDirectory -RequestedPath $BackupPath
  $manifest = Read-BackupManifest -BackupDirectory $resolvedBackupDirectory
  Assert-BackupArtifacts -BackupDirectory $resolvedBackupDirectory -Manifest $manifest

  $postgresImage = "postgres:{0}" -f $manifest.postgres.majorVersion
  $docker = Start-LocalPostgresContainer -Image $postgresImage -ContainerName $containerName
  $cleanupContainer = $true
  Wait-ForLocalPostgres -Docker $docker -ContainerName $containerName

  Copy-ArtifactIntoContainer -Docker $docker -ContainerName $containerName -SourcePath (Join-Path $resolvedBackupDirectory $manifest.artifacts.schema.file) -DestinationPath "/tmp/schema.sql"
  Copy-ArtifactIntoContainer -Docker $docker -ContainerName $containerName -SourcePath (Join-Path $resolvedBackupDirectory $manifest.artifacts.data.file) -DestinationPath "/tmp/data.sql"

  Invoke-PsqlInContainer `
    -Docker $docker `
    -ContainerName $containerName `
    -DbNameOrUrl "postgres" `
    -UserName "postgres" `
    -Files @("/tmp/schema.sql", "/tmp/data.sql") `
    -Commands @("SET session_replication_role = replica;") `
    -SingleTransaction

  $actualTablesJson = Invoke-PsqlInContainer `
    -Docker $docker `
    -ContainerName $containerName `
    -DbNameOrUrl "postgres" `
    -UserName "postgres" `
    -Commands @((Get-TableCountVerificationSql)) `
    -CaptureOutput

  $expectedTables = @($manifest.tables | Sort-Object name)
  $actualTables = @(($actualTablesJson | ConvertFrom-Json) | Sort-Object name)

  if ($expectedTables.Count -ne $actualTables.Count) {
    throw "Restore-check table count mismatch. Expected $($expectedTables.Count) rows in the manifest inventory and found $($actualTables.Count)."
  }

  for ($index = 0; $index -lt $expectedTables.Count; $index += 1) {
    if ($expectedTables[$index].name -ne $actualTables[$index].name) {
      throw "Restore-check table inventory mismatch at position $index. Expected '$($expectedTables[$index].name)' and found '$($actualTables[$index].name)'."
    }

    if ([int64]$expectedTables[$index].rowCount -ne [int64]$actualTables[$index].rowCount) {
      throw "Restore-check row count mismatch for '$($expectedTables[$index].name)'. Expected $($expectedTables[$index].rowCount), found $($actualTables[$index].rowCount)."
    }
  }

  Write-Output "Dogfood restore-check passed for: $resolvedBackupDirectory"
} finally {
  if ($cleanupContainer) {
    Stop-DockerContainer -Docker $docker -ContainerName $containerName
  }
}
