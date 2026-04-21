#!/usr/bin/env powershell
# ============================================================================
# EGISZ-Monitor Build & Deployment Script (v1.1.0)
# Windows PowerShell
# ============================================================================

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

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "EGISZ-Monitor Build v$Version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Service: $Service"
Write-Host "Registry: $Registry"
Write-Host "Build Date: $BuildDate"
Write-Host "Commit: $CommitSha"
Write-Host ""

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

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Backend image built successfully" -ForegroundColor Green
    } else {
        Write-Host "Backend build failed" -ForegroundColor Red
        exit 1
    }
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

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Frontend image built successfully" -ForegroundColor Green
    } else {
        Write-Host "Frontend build failed" -ForegroundColor Red
        exit 1
    }
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

    Write-Host "Stack started" -ForegroundColor Green
    docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
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

    Write-Host "Stack deployed" -ForegroundColor Green
    docker compose -f docker-compose.prod.yml ps
}

function Show-Help {
    Write-Host @"
EGISZ-Monitor Build Script v1.1.0

Usage: .\start.ps1 -Version 1.1.0 -Service all -Action build

Parameters:
  -Version <string>        Version tag (default: 1.1.0)
  -Service <all|backend|frontend> (default: all)
  -Action <build|deploy|test|prod> (default: build)
  -Registry <string>       Docker registry (default: localhost:5000)

Examples:
  .\start.ps1 -Version 1.1.0 -Service all -Action build
  .\start.ps1 -Service backend -Action deploy
  .\start.ps1 -Action test
"@
}

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

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
