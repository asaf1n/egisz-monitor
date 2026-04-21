param(
  [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

function Get-ServicePort {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ContainerName,
    [Parameter(Mandatory = $true)]
    [string]$ContainerPort
  )

  $mapping = docker port $ContainerName $ContainerPort 2>$null

  if (-not $mapping) {
    return $null
  }

  $firstLine = ($mapping | Select-Object -First 1).Trim()
  $parts = $firstLine -split ":"

  if ($parts.Length -eq 0) {
    return $null
  }

  return $parts[$parts.Length - 1]
}

function Wait-ForHealthyContainer {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ContainerName,
    [int]$TimeoutSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $state = docker inspect $ContainerName --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" 2>$null

    if (-not $state) {
      Start-Sleep -Seconds 2
      continue
    }

    $normalized = $state.Trim().ToLowerInvariant()

    if ($normalized -eq "healthy" -or $normalized -eq "running") {
      return
    }

    if ($normalized -eq "unhealthy" -or $normalized -eq "exited" -or $normalized -eq "dead") {
      throw "Container '$ContainerName' did not start successfully. Current state: $normalized"
    }

    Start-Sleep -Seconds 2
  }

  throw "Timed out waiting for container '$ContainerName' to become healthy."
}

$composeArgs = @("compose", "up", "-d")

if (-not $NoBuild) {
  $composeArgs += "--build"
}

Write-Host "Starting EGISZ Monitor containers..." -ForegroundColor Cyan
& docker @composeArgs

Wait-ForHealthyContainer -ContainerName "egisz-monitor-db"
Wait-ForHealthyContainer -ContainerName "egisz-monitor-backend"
Wait-ForHealthyContainer -ContainerName "egisz-monitor-frontend"

$frontendPort = Get-ServicePort -ContainerName "egisz-monitor-frontend" -ContainerPort "80/tcp"
$backendPort = Get-ServicePort -ContainerName "egisz-monitor-backend" -ContainerPort "3000/tcp"
$dbPort = Get-ServicePort -ContainerName "egisz-monitor-db" -ContainerPort "5432/tcp"
Write-Host ""
Write-Host "EGISZ Monitor started successfully." -ForegroundColor Green
Write-Host "Frontend: http://localhost:$frontendPort"
Write-Host "Backend:  http://localhost:$backendPort"
Write-Host "API:      http://localhost:$backendPort/health"
Write-Host "Postgres: localhost:$dbPort"
