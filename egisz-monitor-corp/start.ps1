#!/usr/bin/env powershell
# egisz-monitor-corp: полный деплой в Kubernetes (по умолчанию) или локальная среда dev (Docker Compose + venv).

param(
    [ValidateSet(
        "deploy", "build", "apply", "status", "help",
        "dev", "dev-up", "dev-down", "dev-ps", "dev-logs", "dev-schema", "dev-venv", "dev-ui"
    )]
    [string]$Action = "deploy",
    [switch]$SkipSchema,
    [switch]$WithAirflow
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

function Write-Banner {
    param([string]$Title, [string]$Color = "Cyan")
    Write-Host ""
    Write-Host "========================================" -ForegroundColor $Color
    Write-Host $Title -ForegroundColor $Color
    Write-Host "========================================" -ForegroundColor $Color
}

function Show-Help {
    Write-Host @"
egisz-monitor-corp\start.ps1

Kubernetes (по умолчанию):
  deploy (default)  docker build (corp-web + corp-metabase) + kubectl apply + Jobs (metabase_app + схема DWH) + сводка
  build             только docker build
  apply             kubectl apply + jobs (без build)
  status            kubectl get pods,svc -n egisz-corp
  help

  -WithAirflow      после основного apply вызвать helm upgrade --install (нужны helm и chart apache-airflow)

Перед первым deploy:
  1) kubectl cluster-info
  2) cp k8s\postgres\postgres-secret.example.yaml k8s\postgres\postgres-credentials.yaml  (отредактировать пароли)
  3) cp k8s\metabase-admin-secret.example.yaml k8s\metabase-admin-secret.yaml
  4) Подготовить config\egisz_corp.yaml для кластера (postgres.host = postgres.egisz-corp.svc.cluster.local) и:
       kubectl -n egisz-corp create secret generic egisz-corp-web-config --from-file=egisz_corp.yaml=config\egisz_corp.yaml --dry-run=client -o yaml | kubectl apply -f -
     Шаблон: config\egisz_corp.k8s.example.yaml

Локальная разработка (Compose + venv, без k8s):
  dev          .env + config, docker compose Postgres, venv, pip install -e, apply-schema (кроме -SkipSchema)
  dev-up       docker compose up -d
  dev-down     docker compose down
  dev-ps       docker compose ps
  dev-logs     docker compose logs -f db
  dev-schema   только egisz-corp apply-schema
  dev-venv     только venv + pip install -e ".[dev]"
  dev-ui       Flask UI (порт FLASK_RUN_PORT, по умолчанию 8765)

См. README.md, k8s\README.md, AGENTS.md
"@
}

function Invoke-DockerBuild {
    Write-Host "[Docker] Building egisz-corp-web..." -ForegroundColor Yellow
    docker build -f docker/web/Dockerfile -t egisz-corp-web:latest $Root
    if ($LASTEXITCODE -ne 0) { exit 1 }
    Write-Host "[Docker] Building egisz-corp-metabase..." -ForegroundColor Yellow
    docker build -f metabase/Dockerfile -t egisz-corp-metabase:latest $Root
    if ($LASTEXITCODE -ne 0) { exit 1 }
    Write-Host "[Docker] OK" -ForegroundColor Green
}

function Test-K8sSecretExists {
    param([string]$Name)
    $null = & kubectl -n egisz-corp get secret $Name -o name 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-KubectlApplyPostgres {
    kubectl apply -f (Join-Path $Root "k8s\postgres\namespace.yaml")
    if (-not (Test-Path (Join-Path $Root "k8s\postgres\postgres-credentials.yaml"))) {
        Write-Host "ERROR: missing k8s\postgres\postgres-credentials.yaml (copy from postgres-secret.example.yaml)" -ForegroundColor Red
        exit 1
    }
    kubectl apply -f (Join-Path $Root "k8s\postgres\postgres-credentials.yaml")
    kubectl apply -f (Join-Path $Root "k8s\postgres\postgres-statefulset.yaml")
    kubectl apply -f (Join-Path $Root "k8s\postgres\postgres-service.yaml")
}

function Invoke-MetabaseAdminSecret {
    if (-not (Test-Path (Join-Path $Root "k8s\metabase-admin-secret.yaml"))) {
        Write-Host "WARN: k8s\metabase-admin-secret.yaml not found; Metabase will fail. Copy from metabase-admin-secret.example.yaml" -ForegroundColor Yellow
    }
    else {
        kubectl apply -f (Join-Path $Root "k8s\metabase-admin-secret.yaml")
    }
}

function Wait-PostgresReady {
    Write-Host "[kubectl] Waiting for postgres..." -ForegroundColor Cyan
    kubectl -n egisz-corp rollout status statefulset/postgres --timeout=300s
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

function Invoke-JobFile {
    param([string]$RelativePath)
    $p = Join-Path $Root $RelativePath
    kubectl apply -f $p
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

function Remove-JobIfExists {
    param([string]$JobName)
    kubectl -n egisz-corp delete job $JobName --ignore-not-found 2>$null | Out-Null
}

function Wait-JobComplete {
    param([string]$JobName, [int]$TimeoutSec = 300)
    kubectl -n egisz-corp wait --for=condition=complete "job/$JobName" --timeout="${TimeoutSec}s"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Job $JobName failed or timed out. Logs:" -ForegroundColor Red
        kubectl -n egisz-corp logs "job/$JobName" --tail=200 2>$null
        exit 1
    }
}

function Invoke-BootstrapAndSchemaJobs {
    if (-not (Test-K8sSecretExists "egisz-corp-web-config")) {
        Write-Host "ERROR: Secret egisz-corp-web-config not found. Create it, e.g.:" -ForegroundColor Red
        Write-Host '  kubectl -n egisz-corp create secret generic egisz-corp-web-config --from-file=egisz_corp.yaml=config\egisz_corp.yaml --dry-run=client -o yaml | kubectl apply -f -' -ForegroundColor Gray
        exit 1
    }

    Remove-JobIfExists "egisz-corp-pg-bootstrap-metabase"
    Invoke-JobFile "k8s\jobs\pg-bootstrap-metabase-db.yaml"
    Wait-JobComplete "egisz-corp-pg-bootstrap-metabase"

    Remove-JobIfExists "egisz-corp-apply-dwh-schema"
    Invoke-JobFile "k8s\jobs\apply-dwh-schema.yaml"
    Wait-JobComplete "egisz-corp-apply-dwh-schema"
}

function Invoke-KubectlApplyApps {
    Invoke-MetabaseAdminSecret
    kubectl apply -f (Join-Path $Root "k8s\metabase.yaml")
    kubectl apply -f (Join-Path $Root "k8s\web.yaml")
}

function Invoke-HelmAirflow {
    if (-not (Get-Command helm -ErrorAction SilentlyContinue)) {
        Write-Host "WARN: helm not found; skip Airflow" -ForegroundColor Yellow
        return
    }
    Write-Host "[helm] Installing/upgrading Airflow (namespace egisz-corp)..." -ForegroundColor Cyan
    helm repo add apache-airflow https://airflow.apache.org/charts 2>$null
    helm repo update | Out-Null
    $values = Join-Path $Root "k8s\airflow\values-corp.example.yaml"
    if (-not (Test-Path $values)) {
        Write-Host "WARN: values file missing: $values" -ForegroundColor Yellow
        return
    }
    helm upgrade --install airflow apache-airflow/airflow --namespace egisz-corp -f $values --create-namespace
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARN: helm upgrade airflow failed (check secrets and values)" -ForegroundColor Yellow
    }
}

function Invoke-KubectlApply {
    Invoke-KubectlApplyPostgres
    Wait-PostgresReady
    if ($WithAirflow) {
        kubectl apply -f (Join-Path $Root "k8s\postgres\airflow-metadata-init-job.yaml") 2>$null
    }
    Invoke-BootstrapAndSchemaJobs
    Invoke-KubectlApplyApps
    if ($WithAirflow) {
        Invoke-HelmAirflow
    }
    Write-Host "[kubectl] Applied manifests and jobs" -ForegroundColor Green
}

function Show-DeployInfo {
    Write-Banner "Сервисы (namespace egisz-corp)"
    kubectl -n egisz-corp get pods,svc 2>$null
    Write-Host ""
    Write-Host "Port-forward (с ПК):" -ForegroundColor Cyan
    Write-Host "  Web:      kubectl -n egisz-corp port-forward svc/corp-web 8080:8080   -> http://127.0.0.1:8080/" -ForegroundColor White
    Write-Host "  Metabase: kubectl -n egisz-corp port-forward svc/metabase 3001:3000 -> http://127.0.0.1:3001/" -ForegroundColor White
    Write-Host "  Postgres: kubectl -n egisz-corp port-forward svc/postgres 5432:5432" -ForegroundColor White
    if ($WithAirflow) {
        Write-Host "  Airflow:  kubectl -n egisz-corp port-forward svc/airflow-webserver 8081:8080" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "DNS внутри кластера:" -ForegroundColor Cyan
    Write-Host "  postgres.egisz-corp.svc.cluster.local:5432  (БД витрины из Secret POSTGRES_DB)" -ForegroundColor Gray
    Write-Host "  metabase.egisz-corp.svc.cluster.local:3000" -ForegroundColor Gray
    Write-Host "  corp-web.egisz-corp.svc.cluster.local:8080" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Проверки после данных в витрине:" -ForegroundColor Yellow
    Write-Host "  UTF-8: откройте Web и Metabase, убедитесь что кириллица в подписях дашбордов читается." -ForegroundColor Gray
    Write-Host "  Синхронизация: на Web нажмите «Запустить синхронизацию» или: kubectl -n egisz-corp exec deploy/corp-web -- egisz-corp sync" -ForegroundColor Gray
    Write-Banner "Complete" Green
}

# --- Локальный dev (docker-compose + venv) ---

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
    Copy-IfMissing (Join-Path $Root ".env.example") (Join-Path $Root ".env") | Out-Null
}

function Ensure-CorpConfig {
    $example = Join-Path $Root "config\egisz_corp.example.yaml"
    $target = Join-Path $Root "config\egisz_corp.yaml"
    if (-not (Test-Path $target)) {
        Copy-Item $example $target
        Write-Host "Created config\egisz_corp.yaml (edit Firebird/Postgres if needed)" -ForegroundColor Green
    }
}

function Sync-CorpPostgresEnvFromDotEnv {
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) { return }
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith("#")) { return }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { return }
        $k = $line.Substring(0, $eq).Trim()
        $v = $line.Substring($eq + 1).Trim()
        Set-Item -Path "Env:$k" -Value $v
    }
    if ($env:CORP_DB_PORT) { $env:EGISZ_CORP_POSTGRES_PORT = $env:CORP_DB_PORT }
    if ($env:POSTGRES_USER) { $env:EGISZ_CORP_POSTGRES_USER = $env:POSTGRES_USER }
    if ($env:POSTGRES_PASSWORD) { $env:EGISZ_CORP_POSTGRES_PASSWORD = $env:POSTGRES_PASSWORD }
    if ($env:POSTGRES_DB) { $env:EGISZ_CORP_POSTGRES_DB = $env:POSTGRES_DB }
}

function Start-CorpPostgres {
    Write-Host "[Docker] Starting PostgreSQL (egisz_corp)..." -ForegroundColor Cyan
    docker compose -f (Join-Path $Root "docker-compose.yml") up -d
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

function Wait-PostgresHealthyCompose {
    $composeFile = Join-Path $Root "docker-compose.yml"
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        $raw = docker inspect egisz-corp-db 2>$null
        if (-not $raw) { Start-Sleep -Seconds 2; continue }
        $info = $raw | ConvertFrom-Json
        $hc = $info[0].State.Health
        if (-not $hc) { Start-Sleep -Seconds 2; continue }
        $st = [string]$hc.Status
        if ($st -eq "healthy") {
            Write-Host "PostgreSQL is healthy" -ForegroundColor Green
            return
        }
        if ($st -eq "unhealthy") {
            docker compose -f $composeFile logs --tail 80 db
            exit 1
        }
        Start-Sleep -Seconds 2
    }
    Write-Host "Timeout waiting for PostgreSQL health" -ForegroundColor Red
    exit 1
}

function Install-CorpVenv {
    $venv = Join-Path $Root ".venv"
    if (-not (Test-Path $venv)) {
        if (Get-Command py -ErrorAction SilentlyContinue) { py -3 -m venv $venv }
        else { python -m venv $venv }
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }
    $pip = Join-Path $venv "Scripts\pip.exe"
    $py = Join-Path $venv "Scripts\python.exe"
    & $py -m pip install --upgrade pip -q
    & $pip install -e ".[dev]"
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

function Invoke-ApplySchemaLocal {
    $egiszCorp = Join-Path $Root ".venv\Scripts\egisz-corp.exe"
    $cfg = Join-Path $Root "config\egisz_corp.yaml"
    Sync-CorpPostgresEnvFromDotEnv
    $env:EGISZ_CORP_CONFIG = $cfg
    & $egiszCorp apply-schema
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

function Invoke-DevDeploy {
    Write-Banner "egisz-monitor-corp dev (Compose)"
    Ensure-DotEnv
    Ensure-CorpConfig
    Start-CorpPostgres
    Wait-PostgresHealthyCompose
    Install-CorpVenv
    if (-not $SkipSchema) { Invoke-ApplySchemaLocal }
    Write-Host "Dev: Postgres compose + venv готовы. UI: .\start.ps1 -Action dev-ui" -ForegroundColor Green
}

function Invoke-DevUi {
    Ensure-DotEnv
    Ensure-CorpConfig
    Install-CorpVenv
    $egiszCorp = Join-Path $Root ".venv\Scripts\egisz-corp.exe"
    $cfg = Join-Path $Root "config\egisz_corp.yaml"
    Sync-CorpPostgresEnvFromDotEnv
    $env:EGISZ_CORP_CONFIG = $cfg
    & $egiszCorp config-ui
}

$compose = Join-Path $Root "docker-compose.yml"

switch ($Action) {
    "help" { Show-Help }
    "build" { Invoke-DockerBuild }
    "apply" {
        Invoke-KubectlApplyPostgres
        Wait-PostgresReady
        Invoke-BootstrapAndSchemaJobs
        Invoke-KubectlApplyApps
        if ($WithAirflow) { Invoke-HelmAirflow }
        Show-DeployInfo
    }
    "status" { kubectl -n egisz-corp get pods,svc }
    "deploy" {
        Write-Banner "egisz-monitor-corp Kubernetes"
        Invoke-DockerBuild
        Invoke-KubectlApply
        Show-DeployInfo
    }
    "dev" { Invoke-DevDeploy }
    "dev-up" {
        Ensure-DotEnv
        docker compose -f $compose up -d
        Wait-PostgresHealthyCompose
    }
    "dev-down" { docker compose -f $compose down }
    "dev-ps" { docker compose -f $compose ps }
    "dev-logs" { docker compose -f $compose logs -f db }
    "dev-schema" {
        Ensure-CorpConfig
        Install-CorpVenv
        Invoke-ApplySchemaLocal
    }
    "dev-venv" { Install-CorpVenv }
    "dev-ui" { Invoke-DevUi }
}
