#!/usr/bin/env powershell
# Сборка среды egisz-monitor-corp: Postgres (docker-compose в этом каталоге), venv, SQL-схема.
# Веб-конфиг и Metabase deploy сюда не входят — см. справку после deploy.

param(
    [ValidateSet("deploy", "up", "down", "ps", "logs", "schema", "venv", "ui", "help")]
    [string]$Action = "deploy",
    [switch]$SkipSchema
)

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot
Set-Location $ScriptRoot

function Write-Banner {
    param(
        [string]$Title,
        [string]$Color = "Cyan"
    )
    Write-Host ""
    Write-Host "========================================" -ForegroundColor $Color
    Write-Host $Title -ForegroundColor $Color
    Write-Host "========================================" -ForegroundColor $Color
}

function Show-Help {
    Write-Host @"
egisz-monitor-corp\start.ps1

  deploy   (default) .env + config from examples, Docker Postgres, venv, pip install -e, apply-schema
  up       docker compose up -d only
  down     docker compose down
  ps       docker compose ps
  logs     docker compose logs -f db
  schema   egisz-corp apply-schema only (Postgres must be reachable)
  venv     create .venv and pip install -e ".[dev]"
  ui       Flask config editor (blocks until Ctrl+C) -> http://127.0.0.1:8765
  help     this text

Switches:
  -SkipSchema   on deploy, skip apply-schema

Env (optional):
  EGISZ_CORP_CONFIG   path to egisz_corp.yaml (default: config\egisz_corp.yaml)

After deploy:
  .\start.ps1 -Action ui
  .\.venv\Scripts\Activate.ps1
  egisz-corp test-fb
  egisz-corp test-pg
  egisz-corp sync
"@
}

function Copy-IfMissing {
    param([string]$Source, [string]$Dest)
    if (-not (Test-Path $Dest)) {
        Copy-Item $Source $Dest
        Write-Host "Created $Dest from $Source" -ForegroundColor Green
        return $true
    }
    Write-Host "Exists: $Dest" -ForegroundColor DarkGray
    return $false
}

function Ensure-DotEnv {
    Copy-IfMissing (Join-Path $ScriptRoot ".env.example") (Join-Path $ScriptRoot ".env") | Out-Null
}

function Ensure-CorpConfig {
    $example = Join-Path $ScriptRoot "config\egisz_corp.example.yaml"
    $target = Join-Path $ScriptRoot "config\egisz_corp.yaml"
    if (-not (Test-Path $target)) {
        Copy-Item $example $target
        Write-Host "Created config\egisz_corp.yaml (edit Firebird/Postgres if needed)" -ForegroundColor Green
    } else {
        Write-Host "Exists: config\egisz_corp.yaml" -ForegroundColor DarkGray
    }
}

function Sync-CorpPostgresEnvFromDotEnv {
    $envFile = Join-Path $ScriptRoot ".env"
    if (-not (Test-Path $envFile)) {
        return
    }
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith("#")) {
            return
        }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) {
            return
        }
        $k = $line.Substring(0, $eq).Trim()
        $v = $line.Substring($eq + 1).Trim()
        Set-Item -Path "Env:$k" -Value $v
    }
    if ($env:CORP_DB_PORT) {
        $env:EGISZ_CORP_POSTGRES_PORT = $env:CORP_DB_PORT
    }
    if ($env:POSTGRES_USER) {
        $env:EGISZ_CORP_POSTGRES_USER = $env:POSTGRES_USER
    }
    if ($env:POSTGRES_PASSWORD) {
        $env:EGISZ_CORP_POSTGRES_PASSWORD = $env:POSTGRES_PASSWORD
    }
    if ($env:POSTGRES_DB) {
        $env:EGISZ_CORP_POSTGRES_DB = $env:POSTGRES_DB
    }
}

function Start-CorpPostgres {
    Write-Host ""
    Write-Host "[Docker] Starting PostgreSQL (egisz_corp)..." -ForegroundColor Cyan
    docker compose -f (Join-Path $ScriptRoot "docker-compose.yml") up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Host "docker compose up failed" -ForegroundColor Red
        exit 1
    }
}

function Wait-PostgresHealthy {
    Write-Host "[Docker] Waiting for database health..." -ForegroundColor Cyan
    $composeFile = Join-Path $ScriptRoot "docker-compose.yml"
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        $raw = docker inspect egisz-corp-db 2>$null
        if (-not $raw) {
            Start-Sleep -Seconds 2
            continue
        }
        $info = $raw | ConvertFrom-Json
        $hc = $info[0].State.Health
        if (-not $hc) {
            Start-Sleep -Seconds 2
            continue
        }
        $st = [string]$hc.Status
        if ($st -eq "healthy") {
            Write-Host "PostgreSQL is healthy" -ForegroundColor Green
            return
        }
        if ($st -eq "unhealthy") {
            Write-Host "PostgreSQL healthcheck reported unhealthy" -ForegroundColor Red
            docker compose -f $composeFile logs --tail 80 db
            exit 1
        }
        Start-Sleep -Seconds 2
    }
    Write-Host "Timeout waiting for PostgreSQL health" -ForegroundColor Red
    docker compose -f $composeFile logs --tail 80 db
    exit 1
}

function Install-CorpVenv {
    Write-Host ""
    Write-Host "[Python] venv + editable install..." -ForegroundColor Cyan
    $venv = Join-Path $ScriptRoot ".venv"
    if (-not (Test-Path $venv)) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            py -3 -m venv $venv
        } else {
            python -m venv $venv
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "python -m venv failed (install Python 3.10+ or use py launcher)" -ForegroundColor Red
            exit 1
        }
    }
    $pip = Join-Path $venv "Scripts\pip.exe"
    $py = Join-Path $venv "Scripts\python.exe"
    if (-not (Test-Path $py)) {
        Write-Host ".venv is broken or incomplete" -ForegroundColor Red
        exit 1
    }
    & $py -m pip install --upgrade pip -q
    & $pip install -e ".[dev]"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "pip install failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Python environment ready" -ForegroundColor Green
}

function Invoke-ApplySchema {
    Write-Host ""
    Write-Host "[ETL] apply-schema..." -ForegroundColor Cyan
    $egiszCorp = Join-Path $ScriptRoot ".venv\Scripts\egisz-corp.exe"
    if (-not (Test-Path $egiszCorp)) {
        Write-Host "egisz-corp not found; run -Action venv first" -ForegroundColor Red
        exit 1
    }
    $cfg = Join-Path $ScriptRoot "config\egisz_corp.yaml"
    if (-not (Test-Path $cfg)) {
        Write-Host "Missing $cfg" -ForegroundColor Red
        exit 1
    }
    Sync-CorpPostgresEnvFromDotEnv
    $env:EGISZ_CORP_CONFIG = $cfg
    & $egiszCorp apply-schema
    if ($LASTEXITCODE -ne 0) {
        Write-Host "apply-schema failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Schema applied" -ForegroundColor Green
}

function Read-DotEnvKey {
    param(
        [string]$Key,
        [string]$Default = ""
    )
    $path = Join-Path $ScriptRoot ".env"
    if (-not (Test-Path $path)) {
        return $Default
    }
    foreach ($line in Get-Content $path) {
        $t = $line.Trim()
        if ($t.Length -eq 0 -or $t.StartsWith("#")) {
            continue
        }
        if ($t -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') {
            if ($Matches[1] -eq $Key) {
                return [string]$Matches[2].Trim()
            }
        }
    }
    return $Default
}

function Show-DeploySummary {
    Write-Banner "Справка: сервисы и адреса"
    $composeFile = Join-Path $ScriptRoot "docker-compose.yml"
    $pgPort = Read-DotEnvKey "CORP_DB_PORT" "5433"
    $pgDb = Read-DotEnvKey "POSTGRES_DB" "egisz_corp"
    $pgUser = Read-DotEnvKey "POSTGRES_USER" "egisz_corp"

    Write-Host "[1] Docker Compose (dev на одной машине; prod Postgres/Airflow — k8s, см. k8s\README.md)" -ForegroundColor Cyan
    docker compose -f $composeFile ps 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  (docker compose ps завершился с ошибкой — проверьте Docker)" -ForegroundColor DarkYellow
    }
    Write-Host "  Витрина PostgreSQL (хост Windows, не кластер):" -ForegroundColor White
    Write-Host "    host=127.0.0.1 (или localhost)  port=$pgPort  database=$pgDb  user=$pgUser" -ForegroundColor Gray
    Write-Host "    контейнер: egisz-corp-db  (внутри контейнера порт 5432)" -ForegroundColor Gray

    Write-Host ""
    Write-Host "[2] Python / ETL (на хосте, не в Docker)" -ForegroundColor Cyan
    Write-Host "    venv: $ScriptRoot\.venv" -ForegroundColor Gray
    Write-Host "    CLI:  egisz-corp test-fb | test-pg | sync | apply-schema" -ForegroundColor Gray
    Write-Host "    конфиг: $ScriptRoot\config\egisz_corp.yaml (или EGISZ_CORP_CONFIG)" -ForegroundColor Gray

    Write-Host ""
    Write-Host "[3] Веб-интерфейс настроек (Flask) — не запускается автоматически" -ForegroundColor Cyan
    Write-Host "    .\start.ps1 -Action ui" -ForegroundColor White
    $uiPort = if ($env:FLASK_RUN_PORT) { $env:FLASK_RUN_PORT } else { "8765" }
    Write-Host "    URL:  http://127.0.0.1:$uiPort/" -ForegroundColor Gray

    Write-Host ""
    Write-Host "[4] Kubernetes (prod): Postgres + Airflow — k8s\README.md ; Metabase — отдельно в кластере" -ForegroundColor Yellow
    Write-Host "    Подключение Metabase к витрине: docs\METABASE.md" -ForegroundColor Gray

    Write-Host ""
    Write-Host "[5] Firebird — внешний сервер" -ForegroundColor Cyan
    Write-Host "    Параметры только в config\egisz_corp.yaml и в веб-форме; deploy их не поднимает." -ForegroundColor Gray

    Write-Host ""
    Write-Host "Синхронизация FB -> PG: активируйте venv, затем egisz-corp sync" -ForegroundColor Green
}

function Invoke-ConfigUi {
    Ensure-DotEnv
    Ensure-CorpConfig
    $egiszCorp = Join-Path $ScriptRoot ".venv\Scripts\egisz-corp.exe"
    if (-not (Test-Path $egiszCorp)) {
        Install-CorpVenv
    }
    if (-not (Test-Path $egiszCorp)) {
        Write-Host "egisz-corp not found after venv install" -ForegroundColor Red
        exit 1
    }
    $cfg = Join-Path $ScriptRoot "config\egisz_corp.yaml"
    if (-not (Test-Path $cfg)) {
        Write-Host "Missing $cfg" -ForegroundColor Red
        exit 1
    }
    Sync-CorpPostgresEnvFromDotEnv
    $env:EGISZ_CORP_CONFIG = $cfg
    $uiHost = if ($env:FLASK_RUN_HOST) { $env:FLASK_RUN_HOST } else { "127.0.0.1" }
    $uiPort = if ($env:FLASK_RUN_PORT) { $env:FLASK_RUN_PORT } else { "8765" }
    Write-Host ""
    Write-Host "Starting config UI at http://${uiHost}:${uiPort}/  (Ctrl+C to stop)" -ForegroundColor Cyan
    & $egiszCorp config-ui
}

function Invoke-Deploy {
    Write-Banner "egisz-monitor-corp deploy"
    Ensure-DotEnv
    Ensure-CorpConfig
    Start-CorpPostgres
    Wait-PostgresHealthy
    Install-CorpVenv
    if (-not $SkipSchema) {
        Invoke-ApplySchema
    } else {
        Write-Host "[ETL] Skipped apply-schema (-SkipSchema)" -ForegroundColor Yellow
    }
    Show-DeploySummary
    Write-Banner "Complete" "Green"
}

$compose = Join-Path $ScriptRoot "docker-compose.yml"

switch ($Action) {
    "help" { Show-Help }
    "deploy" { Invoke-Deploy }
    "up" {
        Ensure-DotEnv
        docker compose -f $compose up -d
        if ($LASTEXITCODE -ne 0) { exit 1 }
        Wait-PostgresHealthy
        Show-DeploySummary
    }
    "down" {
        docker compose -f $compose down
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }
    "ps" {
        docker compose -f $compose ps
    }
    "logs" {
        docker compose -f $compose logs -f db
    }
    "schema" {
        Ensure-CorpConfig
        $cfgPath = Join-Path $ScriptRoot "config\egisz_corp.yaml"
        $env:EGISZ_CORP_CONFIG = $cfgPath
        Install-CorpVenv
        Invoke-ApplySchema
    }
    "venv" {
        Install-CorpVenv
    }
    "ui" {
        Invoke-ConfigUi
    }
}
