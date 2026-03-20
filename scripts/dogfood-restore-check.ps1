[CmdletBinding()]
param(
  [string]$BackupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "dogfood-common.ps1")

$containerName = "quest-agent-dogfood-restore-check-{0}" -f ([System.Guid]::NewGuid().ToString("N").Substring(0, 12))
$cleanupContainer = $false
$sanitizedSchemaPath = $null
$sanitizedDataPath = $null

try {
  $resolvedBackupDirectory = Resolve-BackupDirectory -RequestedPath $BackupPath
  $manifest = Read-BackupManifest -BackupDirectory $resolvedBackupDirectory
  Assert-BackupArtifacts -BackupDirectory $resolvedBackupDirectory -Manifest $manifest

  $postgresImage = if ($manifest.postgres.PSObject.Properties.Name -contains "restoreCheckImage" -and -not [string]::IsNullOrWhiteSpace([string]$manifest.postgres.restoreCheckImage)) {
    [string]$manifest.postgres.restoreCheckImage
  } else {
    Resolve-RestoreCheckImage -MajorVersion ([int]$manifest.postgres.majorVersion)
  }
  $docker = Start-LocalPostgresContainer -Image $postgresImage -ContainerName $containerName
  $cleanupContainer = $true
  Wait-ForLocalPostgres -Docker $docker -ContainerName $containerName

  $schemaPath = Join-Path $resolvedBackupDirectory $manifest.artifacts.schema.file
  $dataPath = Join-Path $resolvedBackupDirectory $manifest.artifacts.data.file
  $sanitizedSchemaPath = Join-Path ([System.IO.Path]::GetTempPath()) ("quest-agent-restore-check-schema-{0}.sql" -f ([System.Guid]::NewGuid().ToString("N")))
  $sanitizedDataPath = Join-Path ([System.IO.Path]::GetTempPath()) ("quest-agent-restore-check-data-{0}.sql" -f ([System.Guid]::NewGuid().ToString("N")))
  $extensionSchemas = @(Get-ExtensionSchemasFromSchemaDump -SchemaPath $schemaPath)
  if ($extensionSchemas.Count -gt 0) {
    $schemaSetupCommands = @($extensionSchemas | ForEach-Object { "CREATE SCHEMA IF NOT EXISTS `"$($_)`";" })
    Invoke-PsqlInContainer `
      -Docker $docker `
      -ContainerName $containerName `
      -DbNameOrUrl "postgres" `
      -UserName "postgres" `
      -Commands $schemaSetupCommands
  }

  @(
    Get-Content -LiteralPath $schemaPath |
      Where-Object { $_ -notmatch '^\s*CREATE EXTENSION IF NOT EXISTS\s+' }
  ) | Set-Content -LiteralPath $sanitizedSchemaPath -Encoding utf8

  @(
    Get-Content -LiteralPath $dataPath |
      Where-Object { $_ -notmatch '^\s*SET\s+session_replication_role\s*=\s*replica;\s*$' }
  ) | Set-Content -LiteralPath $sanitizedDataPath -Encoding utf8

  Copy-ArtifactIntoContainer -Docker $docker -ContainerName $containerName -SourcePath $sanitizedSchemaPath -DestinationPath "/tmp/schema.sql"
  Copy-ArtifactIntoContainer -Docker $docker -ContainerName $containerName -SourcePath $sanitizedDataPath -DestinationPath "/tmp/data.sql"

  Invoke-PsqlInContainer `
    -Docker $docker `
    -ContainerName $containerName `
    -DbNameOrUrl "postgres" `
    -UserName "postgres" `
    -Files @("/tmp/schema.sql", "/tmp/data.sql") `
    -SingleTransaction

  $actualTablesJson = Invoke-PsqlInContainer `
    -Docker $docker `
    -ContainerName $containerName `
    -DbNameOrUrl "postgres" `
    -UserName "postgres" `
    -Commands @((Get-TableCountVerificationSql)) `
    -CaptureOutput

  $expectedTables = @($manifest.tables | Sort-Object name)
  $actualTables = @((Get-StructuredJsonFromCommandOutput -Output $actualTablesJson) | Sort-Object name)

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
  if ($sanitizedSchemaPath -and (Test-Path -LiteralPath $sanitizedSchemaPath)) {
    Remove-Item -LiteralPath $sanitizedSchemaPath -Force -ErrorAction SilentlyContinue
  }
  if ($sanitizedDataPath -and (Test-Path -LiteralPath $sanitizedDataPath)) {
    Remove-Item -LiteralPath $sanitizedDataPath -Force -ErrorAction SilentlyContinue
  }
  if ($cleanupContainer) {
    Stop-DockerContainer -Docker $docker -ContainerName $containerName
  }
}
