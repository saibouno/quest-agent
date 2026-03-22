Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:DogfoodScriptRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-DogfoodScriptRoot {
  return $script:DogfoodScriptRoot
}

function Get-DogfoodRequiredEnvironment {
  $repoRoot = Get-DogfoodScriptRoot
  $supabaseUrl = [string]$env:SUPABASE_URL
  $supabaseDbUrl = [string]$env:SUPABASE_DB_URL
  $expectedSupabaseUrl = [string]$env:QUEST_AGENT_EXPECTED_SUPABASE_URL
  $backupRoot = [string]$env:QUEST_AGENT_BACKUP_ROOT
  $deploymentTarget = [string]$env:QUEST_AGENT_DEPLOYMENT_TARGET

  $supabaseUrl = $supabaseUrl.Trim()
  $supabaseDbUrl = $supabaseDbUrl.Trim()
  $expectedSupabaseUrl = $expectedSupabaseUrl.Trim()
  $backupRoot = $backupRoot.Trim()
  $deploymentTarget = $deploymentTarget.Trim()

  if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
    throw "SUPABASE_URL is required for dogfood operations."
  }

  if ([string]::IsNullOrWhiteSpace($supabaseDbUrl)) {
    throw "SUPABASE_DB_URL is required for dogfood operations."
  }

  if ([string]::IsNullOrWhiteSpace($expectedSupabaseUrl)) {
    throw "QUEST_AGENT_EXPECTED_SUPABASE_URL is required for dogfood operations."
  }

  if ([string]::IsNullOrWhiteSpace($backupRoot)) {
    throw "QUEST_AGENT_BACKUP_ROOT is required for dogfood operations."
  }

  if ($expectedSupabaseUrl -ne $supabaseUrl) {
    throw "QUEST_AGENT_EXPECTED_SUPABASE_URL must match SUPABASE_URL."
  }

  if ($deploymentTarget -and $deploymentTarget -ne "preview/dogfood") {
    throw "QUEST_AGENT_DEPLOYMENT_TARGET must be preview/dogfood for dogfood operations."
  }

  return [pscustomobject]@{
    RepoRoot = $repoRoot
    SupabaseUrl = $supabaseUrl
    SupabaseDbUrl = $supabaseDbUrl
    ExpectedSupabaseUrl = $expectedSupabaseUrl
    BackupRoot = $backupRoot
    DeploymentTarget = $deploymentTarget
  }
}

function Get-DogfoodBackupDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BackupRoot
  )

  $path = Join-Path $BackupRoot "quest-agent-dogfood"
  if (-not (Test-Path $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }

  return $path
}

function Get-DogfoodTimestamp {
  return [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmssZ")
}

function Get-DogfoodBackupPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,
    [Parameter(Mandatory = $true)]
    [string]$Timestamp
  )

  return Join-Path $BackupDirectory ("quest-agent-dogfood-{0}.sql" -f $Timestamp)
}

function Get-DogfoodManifestPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath
  )

  return [System.IO.Path]::ChangeExtension($BackupPath, ".manifest.json")
}

function Get-DogfoodCriticalTables {
  return @(
    "goals",
    "milestones",
    "quests",
    "blockers",
    "reviews",
    "decisions",
    "artifacts",
    "events",
    "resume_queue_items",
    "work_sessions",
    "meta_work_flags",
    "bottleneck_interviews",
    "build_improve_decisions",
    "return_runs",
    "lead_metrics_daily"
  )
}

function Invoke-DogfoodNativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $output = & $FilePath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $message = @(
      "Command failed with exit code $exitCode:",
      "  $FilePath",
      "  $($Arguments -join ' ')",
      ($output -join [Environment]::NewLine)
    ) -join [Environment]::NewLine
    throw $message
  }

  return $output
}

function Test-DogfoodCommandAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CommandName
  )

  $null = Get-Command $CommandName -ErrorAction Stop
}

function Get-DogfoodTableCounts {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl
  )

  Test-DogfoodCommandAvailable -CommandName "psql"

  $selects = Get-DogfoodCriticalTables | ForEach-Object { "select '$($_)' as table_name, count(*)::bigint as row_count from $_" }
  $sql = ($selects -join "`nunion all `n") + "`norder by table_name;"

  $rows = Invoke-DogfoodNativeCommand -FilePath "psql" -Arguments @(
    "-X",
    "-q",
    "-t",
    "-A",
    "-F",
    "|",
    "-v",
    "ON_ERROR_STOP=1",
    "--dbname=$DatabaseUrl",
    "-c",
    $sql
  )

  $counts = [ordered]@{}
  foreach ($row in $rows) {
    if ([string]::IsNullOrWhiteSpace([string]$row)) {
      continue
    }

    $parts = ([string]$row).Split("|", 2)
    if ($parts.Count -ne 2) {
      throw "Unexpected count row: $row"
    }

    $counts[$parts[0]] = [int64]$parts[1]
  }

  return $counts
}

function ConvertTo-DogfoodManifest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,
    [Parameter(Mandatory = $true)]
    [hashtable]$TableCounts,
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Environment
  )

  return [pscustomobject]@{
    createdAt = [DateTime]::UtcNow.ToString("o")
    backupPath = $BackupPath
    backupFile = Split-Path -Leaf $BackupPath
    repoRoot = $Environment.RepoRoot
    backupRoot = $Environment.BackupRoot
    deploymentTarget = $Environment.DeploymentTarget
    supabaseUrl = $Environment.SupabaseUrl
    expectedSupabaseUrl = $Environment.ExpectedSupabaseUrl
    tableCounts = $TableCounts
  }
}

function Save-DogfoodJson {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [object]$Value
  )

  $json = $Value | ConvertTo-Json -Depth 8
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Read-DogfoodJson {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    throw "Manifest not found: $Path"
  }

  return Get-Content -Raw -Path $Path | ConvertFrom-Json
}

function Get-DogfoodLatestManifestPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory
  )

  $manifest = Get-ChildItem -Path $BackupDirectory -Filter "*.manifest.json" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

  if (-not $manifest) {
    throw "No dogfood manifest found in $BackupDirectory."
  }

  return $manifest.FullName
}

function ConvertFrom-DogfoodManifestCounts {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Manifest
  )

  $counts = [ordered]@{}
  foreach ($prop in $Manifest.tableCounts.PSObject.Properties) {
    $counts[$prop.Name] = [int64]$prop.Value
  }

  return $counts
}

function Format-DogfoodCounts {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$TableCounts
  )

  return ($TableCounts.GetEnumerator() |
    Sort-Object Name |
    ForEach-Object { "{0}={1}" -f $_.Name, $_.Value }) -join ", "
}
