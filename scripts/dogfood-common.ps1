$script:QuestAgentManagedTables = @(
  "goals",
  "portfolio_settings",
  "milestones",
  "quests",
  "blockers",
  "reviews",
  "decisions",
  "artifacts",
  "events",
  "resume_queue_items",
  "build_improve_decisions",
  "work_sessions",
  "meta_work_flags",
  "bottleneck_interviews",
  "return_runs",
  "lead_metrics_daily",
  "ui_preferences"
)

$script:QuestAgentCleanupTables = @(
  "work_sessions",
  "return_runs",
  "bottleneck_interviews",
  "build_improve_decisions",
  "resume_queue_items",
  "events",
  "artifacts",
  "decisions",
  "reviews",
  "blockers",
  "quests",
  "milestones",
  "meta_work_flags",
  "lead_metrics_daily",
  "portfolio_settings",
  "ui_preferences",
  "goals"
)

$script:QuestAgentManagedEnumTypes = @(
  "goal_status",
  "stop_mode",
  "resume_trigger_type",
  "resume_queue_status",
  "milestone_status",
  "quest_status",
  "priority_level",
  "quest_type",
  "blocker_type",
  "blocker_status",
  "severity_level",
  "entity_type",
  "artifact_type",
  "session_category",
  "main_connection_kind",
  "build_improve_mode",
  "meta_work_flag_type",
  "bottleneck_type",
  "return_decision"
)

function Resolve-Executable {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Names
  )

  foreach ($name in $Names) {
    $command = Get-Command -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) {
      return $command.Source
    }
  }

  throw "Required executable not found. Tried: $($Names -join ', ')."
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [switch]$CaptureOutput,
    [string]$ErrorMessage
  )

  if ($CaptureOutput) {
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()

    try {
      $previousErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      try {
        & $FilePath @Arguments 1> $stdoutPath 2> $stderrPath
        $exitCode = $LASTEXITCODE
      }
      finally {
        $ErrorActionPreference = $previousErrorActionPreference
      }

      $stdout = if (Test-Path -LiteralPath $stdoutPath) {
        Get-Content -LiteralPath $stdoutPath -Raw
      }
      else {
        ""
      }

      $stderr = if (Test-Path -LiteralPath $stderrPath) {
        Get-Content -LiteralPath $stderrPath -Raw
      }
      else {
        ""
      }

      if ($exitCode -ne 0) {
        $detailParts = @(@($stdout, $stderr) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $detail = if ($detailParts.Length -gt 0) { ($detailParts -join [Environment]::NewLine).Trim() } else { "exit code $exitCode" }
        if (-not $ErrorMessage) {
          $ErrorMessage = "Command failed: $FilePath $($Arguments -join ' ')"
        }
        throw "$ErrorMessage`n$detail"
      }

      return $stdout.Trim()
    }
    finally {
      Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
  }

  & $FilePath @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    if (-not $ErrorMessage) {
      $ErrorMessage = "Command failed: $FilePath $($Arguments -join ' ')"
    }
    throw "$ErrorMessage (exit code $exitCode)."
  }
}

function Get-QuestAgentRepoRoot {
  return (Split-Path -Parent $PSScriptRoot)
}

function Get-BackupRoot {
  $repoRoot = Get-QuestAgentRepoRoot
  $configuredRoot = $env:QUEST_AGENT_BACKUP_ROOT

  if ([string]::IsNullOrWhiteSpace($configuredRoot)) {
    return (Join-Path $repoRoot "backups\dogfood")
  }

  if ([System.IO.Path]::IsPathRooted($configuredRoot)) {
    return $configuredRoot
  }

  return (Join-Path $repoRoot $configuredRoot)
}

function Get-ProjectRefFromSupabaseUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SupabaseUrl
  )

  $uri = [System.Uri]$SupabaseUrl
  return ($uri.Host -split "\.")[0]
}

function Assert-DogfoodEnvironment {
  param(
    [switch]$RequireDbUrl,
    [switch]$RequireServiceRole
  )

  if ($env:QUEST_AGENT_DEPLOYMENT_TARGET -ne "preview/dogfood") {
    throw "QUEST_AGENT_DEPLOYMENT_TARGET must be preview/dogfood."
  }

  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_URL)) {
    throw "SUPABASE_URL is required for preview/dogfood operations."
  }

  if ([string]::IsNullOrWhiteSpace($env:QUEST_AGENT_EXPECTED_SUPABASE_URL)) {
    throw "QUEST_AGENT_EXPECTED_SUPABASE_URL is required for preview/dogfood operations."
  }

  if ($env:SUPABASE_URL -ne $env:QUEST_AGENT_EXPECTED_SUPABASE_URL) {
    throw "SUPABASE_URL must match QUEST_AGENT_EXPECTED_SUPABASE_URL."
  }

  if ($RequireServiceRole -and [string]::IsNullOrWhiteSpace($env:SUPABASE_SERVICE_ROLE_KEY)) {
    throw "SUPABASE_SERVICE_ROLE_KEY is required for this preview/dogfood operation."
  }

  if ($RequireDbUrl -and [string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
    throw "SUPABASE_DB_URL is required for backup and restore operations."
  }
}

function Assert-DockerAvailable {
  $docker = Resolve-Executable -Names @("docker.exe", "docker")
  [void](Invoke-CheckedCommand -FilePath $docker -Arguments @("info", "--format", "{{.ServerVersion}}") -CaptureOutput -ErrorMessage "Docker is required but not available.")
  return $docker
}

function Get-NpxCommand {
  return (Resolve-Executable -Names @("npx.cmd", "npx"))
}

function Get-GitMetadata {
  $git = Resolve-Executable -Names @("git.exe", "git")
  $branch = Invoke-CheckedCommand -FilePath $git -Arguments @("rev-parse", "--abbrev-ref", "HEAD") -CaptureOutput -ErrorMessage "Could not resolve the current git branch."
  $commit = Invoke-CheckedCommand -FilePath $git -Arguments @("rev-parse", "HEAD") -CaptureOutput -ErrorMessage "Could not resolve the current git commit."
  $shortCommit = Invoke-CheckedCommand -FilePath $git -Arguments @("rev-parse", "--short", "HEAD") -CaptureOutput -ErrorMessage "Could not resolve the short git commit."
  $status = Invoke-CheckedCommand -FilePath $git -Arguments @("status", "--short") -CaptureOutput -ErrorMessage "Could not inspect git status."

  return [pscustomobject]@{
    branch = $branch
    commit = $commit
    shortCommit = $shortCommit
    dirty = -not [string]::IsNullOrWhiteSpace($status)
  }
}

function Get-ArtifactMetadata {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()

  return [pscustomobject]@{
    file = $item.Name
    sizeBytes = [int64]$item.Length
    sha256 = $hash
  }
}

function Get-StructuredJsonFromCommandOutput {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Output
  )

  $jsonLine = @(
    $Output -split "\r?\n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -match '^[\{\[]' }
  ) | Select-Object -Last 1

  if ([string]::IsNullOrWhiteSpace($jsonLine)) {
    throw "Expected JSON output, but no JSON payload was found."
  }

  return ($jsonLine | ConvertFrom-Json)
}

function Get-SourceMetadataSql {
  $tableValuesSql = (($script:QuestAgentManagedTables | ForEach-Object {
    "('$($_)')"
  }) -join ("," + [Environment]::NewLine + "    "))

  return (@'
CREATE OR REPLACE FUNCTION pg_temp.quest_agent_count_rows(target_table_name text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  row_count bigint;
BEGIN
  IF to_regclass(format('public.%I', target_table_name)) IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE format('SELECT COUNT(*)::bigint FROM public.%I', target_table_name) INTO row_count;
  RETURN COALESCE(row_count, 0);
END;
$$;

WITH expected_tables(table_name) AS (
  VALUES
    {0}
),
table_counts AS (
  SELECT
    expected.table_name,
    pg_temp.quest_agent_count_rows(expected.table_name) AS row_count
  FROM expected_tables AS expected
)
SELECT json_build_object(
  'serverVersion', current_setting('server_version'),
  'serverVersionNum', current_setting('server_version_num'),
  'extensions', COALESCE((SELECT json_agg(extname ORDER BY extname) FROM pg_extension), '[]'::json),
  'tables', COALESCE((SELECT json_agg(json_build_object('name', table_name, 'rowCount', row_count) ORDER BY table_name) FROM table_counts), '[]'::json)
);
'@) -f $tableValuesSql
}

function Get-SourceDatabaseMetadata {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DbUrl,
    [string]$Image = "postgres:17"
  )

  $docker = Assert-DockerAvailable
  $sql = Get-SourceMetadataSql
  $output = Invoke-CheckedCommand `
    -FilePath $docker `
    -Arguments @("run", "--rm", $Image, "psql", "--no-psqlrc", "--dbname", $DbUrl, "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", $sql) `
    -CaptureOutput `
    -ErrorMessage "Could not read metadata from the dogfood database."

  return (Get-StructuredJsonFromCommandOutput -Output $output)
}

function Get-PostgresMajorVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ServerVersionNum
  )

  if ($ServerVersionNum.Length -le 4) {
    return [int]$ServerVersionNum
  }

  return [int]$ServerVersionNum.Substring(0, $ServerVersionNum.Length - 4)
}

function Resolve-RestoreCheckImage {
  param(
    [Parameter(Mandatory = $true)]
    [int]$MajorVersion
  )

  $docker = Assert-DockerAvailable
  $output = Invoke-CheckedCommand `
    -FilePath $docker `
    -Arguments @("images", "public.ecr.aws/supabase/postgres", "--format", "{{.Repository}}:{{.Tag}}") `
    -CaptureOutput `
    -ErrorMessage "Could not inspect local Supabase Postgres images."

  $candidates = @(
    $output -split "\r?\n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Where-Object { $_ -match ":$MajorVersion(\.|$)" }
  )

  if ($candidates.Length -gt 0) {
    return ($candidates | Select-Object -First 1)
  }

  return "postgres:$MajorVersion"
}

function Resolve-BackupDirectory {
  param(
    [string]$RequestedPath
  )

  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    $path = if ([System.IO.Path]::IsPathRooted($RequestedPath)) {
      $RequestedPath
    } else {
      Join-Path (Get-QuestAgentRepoRoot) $RequestedPath
    }

    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
      throw "Backup directory not found: $path"
    }

    return (Resolve-Path -LiteralPath $path).Path
  }

  $backupRoot = Get-BackupRoot
  if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    throw "No backup directory found at $backupRoot"
  }

  $latest = Get-ChildItem -LiteralPath $backupRoot -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "manifest.json") } |
    Sort-Object Name -Descending |
    Select-Object -First 1

  if ($null -eq $latest) {
    throw "No backup with a manifest.json was found under $backupRoot"
  }

  return $latest.FullName
}

function Read-BackupManifest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory
  )

  $manifestPath = Join-Path $BackupDirectory "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "manifest.json not found in $BackupDirectory"
  }

  return (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
}

function Assert-BackupArtifacts {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,
    [Parameter(Mandatory = $true)]
    $Manifest
  )

  foreach ($artifactName in @("roles", "schema", "data")) {
    $artifact = $Manifest.artifacts.$artifactName
    if ($null -eq $artifact) {
      throw "manifest.json is missing metadata for '$artifactName'."
    }

    $artifactPath = Join-Path $BackupDirectory $artifact.file
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
      throw "Backup artifact missing: $artifactPath"
    }

    $actualMetadata = Get-ArtifactMetadata -Path $artifactPath
    if ($actualMetadata.sha256 -ne $artifact.sha256) {
      throw "Hash mismatch for $artifactName ($artifactPath)."
    }

    if ([int64]$actualMetadata.sizeBytes -ne [int64]$artifact.sizeBytes) {
      throw "Size mismatch for $artifactName ($artifactPath)."
    }
  }
}

function Get-ExtensionSchemasFromSchemaDump {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SchemaPath
  )

  if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) {
    throw "Schema dump not found: $SchemaPath"
  }

  $matches = Select-String -LiteralPath $SchemaPath -Pattern 'CREATE EXTENSION IF NOT EXISTS "[^"]+" WITH SCHEMA "([^"]+)";' -AllMatches
  $schemas = foreach ($match in $matches) {
    foreach ($capture in $match.Matches) {
      $capture.Groups[1].Value
    }
  }

  return @(
    $schemas |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Sort-Object -Unique
  )
}

function Start-LocalPostgresContainer {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Image,
    [Parameter(Mandatory = $true)]
    [string]$ContainerName
  )

  $docker = Assert-DockerAvailable
  [void](Invoke-CheckedCommand `
    -FilePath $docker `
    -Arguments @("run", "--rm", "-d", "--name", $ContainerName, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=postgres", $Image) `
    -CaptureOutput `
    -ErrorMessage "Could not start a scratch Postgres container.")

  return $docker
}

function Start-PostgresUtilityContainer {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Image,
    [Parameter(Mandatory = $true)]
    [string]$ContainerName
  )

  $docker = Assert-DockerAvailable
  [void](Invoke-CheckedCommand `
    -FilePath $docker `
    -Arguments @("run", "--rm", "-d", "--name", $ContainerName, $Image, "tail", "-f", "/dev/null") `
    -CaptureOutput `
    -ErrorMessage "Could not start a Postgres utility container.")

  return $docker
}

function Wait-ForLocalPostgres {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Docker,
    [Parameter(Mandatory = $true)]
    [string]$ContainerName,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $null = & $Docker exec $ContainerName pg_isready -U postgres -d postgres 2>$null
    if ($LASTEXITCODE -eq 0) {
      return
    }

    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for scratch Postgres container '$ContainerName' to become ready."
}

function Stop-DockerContainer {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Docker,
    [Parameter(Mandatory = $true)]
    [string]$ContainerName
  )

  & $Docker rm -f $ContainerName *> $null
}

function Copy-ArtifactIntoContainer {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Docker,
    [Parameter(Mandatory = $true)]
    [string]$ContainerName,
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,
    [Parameter(Mandatory = $true)]
    [string]$DestinationPath
  )

  Invoke-CheckedCommand `
    -FilePath $Docker `
    -Arguments @("cp", $SourcePath, "$ContainerName`:$DestinationPath") `
    -ErrorMessage "Could not copy '$SourcePath' into container '$ContainerName'."
}

function Invoke-PsqlInContainer {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Docker,
    [Parameter(Mandatory = $true)]
    [string]$ContainerName,
    [Parameter(Mandatory = $true)]
    [string]$DbNameOrUrl,
    [string]$UserName,
    [string[]]$Files = @(),
    [string[]]$Commands = @(),
    [switch]$SingleTransaction,
    [switch]$CaptureOutput
  )

  $arguments = @("exec", $ContainerName, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1")
  if ($SingleTransaction) {
    $arguments += "--single-transaction"
  }

  if (-not [string]::IsNullOrWhiteSpace($UserName)) {
    $arguments += @("--username", $UserName)
  }

  $arguments += @("--dbname", $DbNameOrUrl)

  foreach ($command in $Commands) {
    $arguments += @("--command", $command)
  }

  foreach ($file in $Files) {
    $arguments += @("--file", $file)
  }

  if ($CaptureOutput) {
    $arguments += @("--tuples-only", "--no-align")
  }

  return (Invoke-CheckedCommand -FilePath $Docker -Arguments $arguments -CaptureOutput:$CaptureOutput -ErrorMessage "psql execution failed.")
}

function Get-TableCountVerificationSql {
  $tableValuesSql = (($script:QuestAgentManagedTables | ForEach-Object {
    "('$($_)')"
  }) -join ("," + [Environment]::NewLine + "    "))

  return (@'
CREATE OR REPLACE FUNCTION pg_temp.quest_agent_count_rows(target_table_name text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  row_count bigint;
BEGIN
  IF to_regclass(format('public.%I', target_table_name)) IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE format('SELECT COUNT(*)::bigint FROM public.%I', target_table_name) INTO row_count;
  RETURN COALESCE(row_count, 0);
END;
$$;

WITH expected_tables(table_name) AS (
  VALUES
    {0}
),
table_counts AS (
  SELECT
    expected.table_name,
    pg_temp.quest_agent_count_rows(expected.table_name) AS row_count
  FROM expected_tables AS expected
)
SELECT json_agg(json_build_object('name', table_name, 'rowCount', row_count) ORDER BY table_name)
FROM table_counts;
'@) -f $tableValuesSql
}

function Get-RestoreCleanupSql {
  $tableDrops = ($script:QuestAgentCleanupTables | ForEach-Object {
    "DROP TABLE IF EXISTS public.$_ CASCADE;"
  }) -join [Environment]::NewLine

  $typeDrops = ($script:QuestAgentManagedEnumTypes | ForEach-Object {
    "DROP TYPE IF EXISTS public.$_ CASCADE;"
  }) -join [Environment]::NewLine

  return (@'
{0}
{1}
DO $$
DECLARE
  seq_record RECORD;
BEGIN
  FOR seq_record IN
    SELECT quote_ident(ns.nspname) || '.' || quote_ident(cls.relname) AS sequence_name
    FROM pg_class AS cls
    INNER JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
    WHERE cls.relkind = 'S'
      AND ns.nspname = 'public'
  LOOP
    EXECUTE 'DROP SEQUENCE IF EXISTS ' || seq_record.sequence_name || ' CASCADE';
  END LOOP;
END $$;
'@) -f $tableDrops, $typeDrops
}
