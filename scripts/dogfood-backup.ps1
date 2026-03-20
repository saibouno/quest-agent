[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "dogfood-common.ps1")

$repoRoot = Get-QuestAgentRepoRoot
$backupRoot = Get-BackupRoot
$temporaryDirectory = $null
$finalDirectory = $null

try {
  Assert-DogfoodEnvironment -RequireDbUrl -RequireServiceRole
  $docker = Assert-DockerAvailable
  $npx = Get-NpxCommand
  $git = Get-GitMetadata

  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmssZ")
  $backupId = "$timestamp-$($git.shortCommit)"
  $temporaryDirectory = Join-Path $backupRoot ".$backupId.tmp"
  $finalDirectory = Join-Path $backupRoot $backupId

  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }

  if (Test-Path -LiteralPath $finalDirectory) {
    throw "Backup directory already exists: $finalDirectory"
  }

  New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null

  $rolesPath = Join-Path $temporaryDirectory "roles.sql"
  $schemaPath = Join-Path $temporaryDirectory "schema.sql"
  $dataPath = Join-Path $temporaryDirectory "data.sql"

  $supabaseVersionOutput = Invoke-CheckedCommand -FilePath $npx -Arguments @("supabase", "--version") -CaptureOutput -ErrorMessage "Could not resolve the Supabase CLI version."
  $supabaseVersion = ($supabaseVersionOutput -split "(\r?\n)+" | Where-Object { $_ -match "^\d+\." } | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($supabaseVersion)) {
    $supabaseVersion = $supabaseVersionOutput
  }
  $sourceMetadata = Get-SourceDatabaseMetadata -DbUrl $env:SUPABASE_DB_URL
  $projectRef = Get-ProjectRefFromSupabaseUrl -SupabaseUrl $env:SUPABASE_URL
  $postgresMajorVersion = Get-PostgresMajorVersion -ServerVersionNum ([string]$sourceMetadata.serverVersionNum)

  Push-Location $repoRoot
  try {
    Invoke-CheckedCommand `
      -FilePath $npx `
      -Arguments @("supabase", "db", "dump", "--db-url", $env:SUPABASE_DB_URL, "--file", $rolesPath, "--role-only") `
      -ErrorMessage "Could not create roles.sql."

    Invoke-CheckedCommand `
      -FilePath $npx `
      -Arguments @("supabase", "db", "dump", "--db-url", $env:SUPABASE_DB_URL, "--file", $schemaPath, "--schema", "public") `
      -ErrorMessage "Could not create schema.sql."

    Invoke-CheckedCommand `
      -FilePath $npx `
      -Arguments @("supabase", "db", "dump", "--db-url", $env:SUPABASE_DB_URL, "--file", $dataPath, "--schema", "public", "--data-only", "--use-copy") `
      -ErrorMessage "Could not create data.sql."
  } finally {
    Pop-Location
  }

  $restoreCheckImage = Resolve-RestoreCheckImage -MajorVersion $postgresMajorVersion

  $manifest = [ordered]@{
    backupId = $backupId
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    deploymentTarget = "preview/dogfood"
    supabaseUrl = $env:SUPABASE_URL
    projectRef = $projectRef
    postgres = [ordered]@{
      serverVersion = $sourceMetadata.serverVersion
      serverVersionNum = $sourceMetadata.serverVersionNum
      majorVersion = $postgresMajorVersion
      restoreCheckImage = $restoreCheckImage
      extensions = @($sourceMetadata.extensions)
    }
    git = [ordered]@{
      branch = $git.branch
      commit = $git.commit
      shortCommit = $git.shortCommit
      dirty = [bool]$git.dirty
    }
    cli = [ordered]@{
      supabase = $supabaseVersion
      docker = (Invoke-CheckedCommand -FilePath $docker -Arguments @("info", "--format", "{{.ServerVersion}}") -CaptureOutput -ErrorMessage "Could not resolve the Docker server version.")
    }
    tables = @($sourceMetadata.tables)
    artifacts = [ordered]@{
      roles = Get-ArtifactMetadata -Path $rolesPath
      schema = Get-ArtifactMetadata -Path $schemaPath
      data = Get-ArtifactMetadata -Path $dataPath
    }
  }

  $manifestPath = Join-Path $temporaryDirectory "manifest.json"
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8

  Move-Item -LiteralPath $temporaryDirectory -Destination $finalDirectory
  $temporaryDirectory = $null

  Write-Output "Dogfood backup created: $finalDirectory"
} catch {
  if ($temporaryDirectory -and (Test-Path -LiteralPath $temporaryDirectory)) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }

  throw
}
