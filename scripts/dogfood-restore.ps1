[CmdletBinding()]
param(
  [string]$BackupPath,
  [switch]$Apply,
  [switch]$IncludeRoles,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "dogfood-common.ps1")

$containerName = "quest-agent-dogfood-restore-{0}" -f ([System.Guid]::NewGuid().ToString("N").Substring(0, 12))
$cleanupContainer = $false
$cleanupFile = $null

try {
  Assert-DogfoodEnvironment -RequireDbUrl -RequireServiceRole
  $resolvedBackupDirectory = Resolve-BackupDirectory -RequestedPath $BackupPath
  $manifest = Read-BackupManifest -BackupDirectory $resolvedBackupDirectory
  Assert-BackupArtifacts -BackupDirectory $resolvedBackupDirectory -Manifest $manifest

  $projectRef = Get-ProjectRefFromSupabaseUrl -SupabaseUrl $env:SUPABASE_URL
  $postgresImage = "postgres:{0}" -f $manifest.postgres.majorVersion

  Write-Output ("Target deployment : {0}" -f $env:QUEST_AGENT_DEPLOYMENT_TARGET)
  Write-Output ("Target project    : {0}" -f $projectRef)
  Write-Output ("Target SUPABASE_URL: {0}" -f $env:SUPABASE_URL)
  Write-Output ("Backup directory  : {0}" -f $resolvedBackupDirectory)
  Write-Output ("Backup createdAt  : {0}" -f $manifest.createdAt)
  Write-Output ("Cleanup tables    : {0}" -f ($script:QuestAgentCleanupTables -join ", "))
  Write-Output ("Cleanup enum types: {0}" -f ($script:QuestAgentManagedEnumTypes -join ", "))
  Write-Output ("Include roles     : {0}" -f ([bool]$IncludeRoles))

  if (-not $Apply) {
    Write-Output "Dry-run only. Re-run with -Apply to restore the live dogfood database."
    return
  }

  if (-not $Force) {
    $confirmation = Read-Host ("Type '{0}' to confirm the live dogfood restore" -f $projectRef)
    if ($confirmation -ne $projectRef) {
      throw "Confirmation did not match the target project ref."
    }
  }

  $docker = Start-PostgresUtilityContainer -Image $postgresImage -ContainerName $containerName
  $cleanupContainer = $true

  $cleanupFile = Join-Path ([System.IO.Path]::GetTempPath()) ("quest-agent-dogfood-cleanup-{0}.sql" -f [System.Guid]::NewGuid().ToString("N"))
  Get-RestoreCleanupSql | Set-Content -LiteralPath $cleanupFile -Encoding utf8

  Copy-ArtifactIntoContainer -Docker $docker -ContainerName $containerName -SourcePath $cleanupFile -DestinationPath "/tmp/cleanup.sql"
  Copy-ArtifactIntoContainer -Docker $docker -ContainerName $containerName -SourcePath (Join-Path $resolvedBackupDirectory $manifest.artifacts.schema.file) -DestinationPath "/tmp/schema.sql"
  Copy-ArtifactIntoContainer -Docker $docker -ContainerName $containerName -SourcePath (Join-Path $resolvedBackupDirectory $manifest.artifacts.data.file) -DestinationPath "/tmp/data.sql"

  if ($IncludeRoles) {
    Copy-ArtifactIntoContainer -Docker $docker -ContainerName $containerName -SourcePath (Join-Path $resolvedBackupDirectory $manifest.artifacts.roles.file) -DestinationPath "/tmp/roles.sql"
    Invoke-PsqlInContainer -Docker $docker -ContainerName $containerName -DbNameOrUrl $env:SUPABASE_DB_URL -Files @("/tmp/roles.sql")
  }

  Invoke-PsqlInContainer `
    -Docker $docker `
    -ContainerName $containerName `
    -DbNameOrUrl $env:SUPABASE_DB_URL `
    -Files @("/tmp/cleanup.sql", "/tmp/schema.sql", "/tmp/data.sql") `
    -Commands @("SET session_replication_role = replica;") `
    -SingleTransaction

  Write-Output ("Dogfood live restore completed for project {0} from backup {1}" -f $projectRef, $resolvedBackupDirectory)
} finally {
  if ($cleanupFile -and (Test-Path -LiteralPath $cleanupFile)) {
    Remove-Item -LiteralPath $cleanupFile -Force -ErrorAction SilentlyContinue
  }

  if ($cleanupContainer) {
    Stop-DockerContainer -Docker $docker -ContainerName $containerName
  }
}
