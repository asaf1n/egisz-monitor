#!/usr/bin/env powershell

param(
    [string]$Version = "1.1.0",
    [string]$Service = "all",
    [string]$Action = "build",
    [string]$Registry = "localhost:5000"
)

$ErrorActionPreference = "Stop"

$BuildDate = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
$CommitSha = (git rev-parse --short HEAD 2>$null)
if (-not $CommitSha) {
    $CommitSha = "unknown"
}

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

function Build-Backend {
    Write-Host "[1/2] Building backend v$Version..." -ForegroundColor Yellow

    docker build `
        --progress=plain `
        --build-arg VERSION="$Version" `
        --build-arg BUILD_DATE="$BuildDate" `
        --build-arg COMMIT_SHA="$CommitSha" `
        -t "$Registry/egisz-backend:$Version" `
        -t "$Registry/egisz-backend:$Version-$BuildDate" `
        -t "$Registry/egisz-backend:sha-$CommitSha" `
        -t "$Registry/egisz-backend:latest" `
        -f backend/Dockerfile `
        backend/

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Backend build failed" -ForegroundColor Red
        exit 1
    }

    Write-Host "Backend image built successfully" -ForegroundColor Green
}

function Build-Frontend {
    Write-Host "[2/2] Building frontend v$Version..." -ForegroundColor Yellow

    docker build `
        --progress=plain `
        --build-arg VERSION="$Version" `
        --build-arg BUILD_DATE="$BuildDate" `
        --build-arg COMMIT_SHA="$CommitSha" `
        -t "$Registry/egisz-frontend:$Version" `
        -t "$Registry/egisz-frontend:$Version-$BuildDate" `
        -t "$Registry/egisz-frontend:sha-$CommitSha" `
        -t "$Registry/egisz-frontend:latest" `
        -f frontend/Dockerfile `
        frontend/

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Frontend build failed" -ForegroundColor Red
        exit 1
    }

    Write-Host "Frontend image built successfully" -ForegroundColor Green
}

function Test-Security {
    Write-Host ""
    Write-Host "[Security] Checking non-root users..." -ForegroundColor Cyan

    Write-Host "Backend user:" -NoNewline
    $BackendUser = docker run --rm "$Registry/egisz-backend:$Version" whoami
    if ($BackendUser -eq "node") {
        Write-Host " $BackendUser" -ForegroundColor Green
    } else {
        Write-Host " $BackendUser (expected: node)" -ForegroundColor Red
        exit 1
    }

    Write-Host "Frontend user:" -NoNewline
    $FrontendUser = docker run --rm "$Registry/egisz-frontend:$Version" whoami
    if ($FrontendUser -eq "nginx") {
        Write-Host " $FrontendUser" -ForegroundColor Green
    } else {
        Write-Host " $FrontendUser (expected: nginx)" -ForegroundColor Red
        exit 1
    }
}

function Get-ImageSize {
    Write-Host ""
    Write-Host "[Size] Image information:" -ForegroundColor Cyan
    docker image ls --filter "reference=$Registry/egisz-*:$Version" --format "table {{.Repository}}:{{.Tag}}`t{{.Size}}"
}

function Show-Endpoints {
    Write-Banner "EGISZ Monitor"
    Write-Host "Control panel:        http://localhost:8812" -ForegroundColor Cyan
    Write-Host "Metabase full UI:     http://localhost:3001" -ForegroundColor Green
    Write-Host "Public dashboards:    http://localhost:3002" -ForegroundColor Green
    Write-Host "Backend healthcheck:  http://localhost:3000/health" -ForegroundColor Yellow
}

function Deploy-Dev {
    Write-Host ""
    Write-Host "[Deploy] Starting development stack..." -ForegroundColor Cyan
    $env:BACKEND_VERSION = $Version
    $env:FRONTEND_VERSION = $Version
    $env:BUILD_DATE = $BuildDate
    $env:COMMIT_SHA = $CommitSha

    docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Development stack deployment failed" -ForegroundColor Red
        exit 1
    }

    Write-Host "Development stack started" -ForegroundColor Green
    docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
    Show-Endpoints
}

function Deploy-Prod {
    Write-Host ""
    Write-Host "[Deploy] Starting production stack..." -ForegroundColor Cyan
    $env:REGISTRY = $Registry
    $env:BACKEND_VERSION = $Version
    $env:FRONTEND_VERSION = $Version

    docker compose -f docker-compose.prod.yml up -d --build

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Production stack deployment failed" -ForegroundColor Red
        exit 1
    }

    Write-Host "Production stack deployed" -ForegroundColor Green
    docker compose -f docker-compose.prod.yml ps
    Show-Endpoints
}

function Show-Help {
    Write-Host @"
EGISZ-Monitor Build Script v1.1.0

Usage: .\start.ps1 -Version 1.1.0 -Service all -Action build

Parameters:
  -Version <string>                 Version tag (default: 1.1.0)
  -Service <all|backend|frontend>   Service scope (default: all)
  -Action <build|deploy|test|prod>  Action to run (default: build)
  -Registry <string>                Docker registry (default: localhost:5000)

Examples:
  .\start.ps1 -Version 1.1.0 -Service all -Action build
  .\start.ps1 -Service backend -Action deploy
  .\start.ps1 -Action test
"@
}

Write-Banner "EGISZ-Monitor Build v$Version"
Write-Host "Service: $Service"
Write-Host "Registry: $Registry"
Write-Host "Build Date: $BuildDate"
Write-Host "Commit: $CommitSha"

if ($Action -eq "build") {
    if ($Service -eq "all" -or $Service -eq "backend") {
        Build-Backend
    }
    if ($Service -eq "all" -or $Service -eq "frontend") {
        Build-Frontend
    }
    Test-Security
    Get-ImageSize
} elseif ($Action -eq "deploy") {
    Deploy-Dev
} elseif ($Action -eq "test") {
    Test-Security
    Get-ImageSize
} elseif ($Action -eq "prod") {
    Deploy-Prod
} else {
    Show-Help
}

Write-Banner "Complete" "Green"
