<#
GTLNAV — E2E static-deploy smoke test (PowerShell).

Walks through:
  1. POST /api/deployments/start
  2. polls /api/deployments/<id>/status until terminal
  3. curls the resulting deployment_url

Requires a GTLNAV API key with `deployments:write` scope.

Usage:
    $env:GTLNAV_APP_URL = "https://app.gtlnav.app"
    $env:GTLNAV_API_KEY = "gtlnav_live_pat_..."
    $env:GTLNAV_PROJECT_ID = "<uuid>"
    $env:GTLNAV_BRANCH = "main"   # optional
    ./scripts/smoke-test-deploy.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$AppUrl    = $env:GTLNAV_APP_URL
$ApiKey    = $env:GTLNAV_API_KEY
$ProjectId = $env:GTLNAV_PROJECT_ID
$Branch    = if ($env:GTLNAV_BRANCH) { $env:GTLNAV_BRANCH } else { "main" }

if (-not $AppUrl)    { throw "GTLNAV_APP_URL is required." }
if (-not $ApiKey)    { throw "GTLNAV_API_KEY is required." }
if (-not $ProjectId) { throw "GTLNAV_PROJECT_ID is required." }

$AppUrl = $AppUrl.TrimEnd("/")

Write-Host "[smoke] starting deployment for project $ProjectId on branch $Branch..."
$startBody = @{ project_id = $ProjectId; branch = $Branch } | ConvertTo-Json -Compress
$startResp = Invoke-RestMethod -Method Post `
    -Uri "$AppUrl/api/deployments/start" `
    -Headers @{
        Authorization = "Bearer $ApiKey"
        "Content-Type" = "application/json"
        Accept = "application/json"
    } `
    -Body $startBody

$startResp | ConvertTo-Json -Depth 6 | Write-Host

$deploymentId = $startResp.deployment.id
$deploymentUrl = $startResp.deployment.deployment_url

if (-not $deploymentId) {
    throw "[smoke] FAIL - start API did not return a deployment id."
}

Write-Host "[smoke] deployment_id=$deploymentId"

$deadline = (Get-Date).AddMinutes(10)
$status = $null
while ((Get-Date) -lt $deadline) {
    $statusResp = Invoke-RestMethod -Method Get `
        -Uri "$AppUrl/api/deployments/$deploymentId/status" `
        -Headers @{ Authorization = "Bearer $ApiKey"; Accept = "application/json" }
    $status = $statusResp.deployment.status
    Write-Host ("[smoke] {0} status={1}" -f (Get-Date).ToString("HH:mm:ss"), $status)
    if ($status -in @("active", "failed", "canceled")) { break }
    Start-Sleep -Seconds 5
}

if ($status -ne "active") {
    throw "[smoke] FAIL - deployment ended in status '$status'."
}

if ($deploymentUrl) {
    Write-Host "[smoke] HEAD $deploymentUrl ..."
    try {
        $resp = Invoke-WebRequest -Uri $deploymentUrl -Method Head -UseBasicParsing -TimeoutSec 15
        Write-Host "[smoke] HTTP $($resp.StatusCode) on $deploymentUrl"
    } catch {
        Write-Warning "[smoke] WARN - URL probe failed: $($_.Exception.Message)"
    }
}

# Phase 6D — verify runtime_instances row was actually created. Catches the
# Phase 6C schema-mismatch failure mode locally so the operator gets an
# immediate red signal instead of an empty dashboard.
Write-Host "[smoke] verifying runtime_instances row..."
$riResp = Invoke-RestMethod -Method Get `
    -Uri "$AppUrl/api/runtime/instances?project_id=$ProjectId" `
    -Headers @{ Authorization = "Bearer $ApiKey"; Accept = "application/json" }
$riCount = if ($riResp.instances) { $riResp.instances.Count } else { 0 }
$ri = if ($riCount -gt 0) { $riResp.instances[0] } else { $null }
Write-Host ("[smoke] runtime_instances: count={0} runtime_kind={1} status={2}" -f `
    $riCount, $ri.runtime_kind, $ri.status)
if ($riCount -lt 1) {
    throw "[smoke] FAIL - no runtime_instances row for project $ProjectId. Check worker logs and Phase 6C migration 0008."
}
if ($ri.status -ne "running") {
    throw "[smoke] FAIL - runtime_instance.status is '$($ri.status)' (expected 'running')."
}

Write-Host "[smoke] OK - deployment $deploymentId is active, runtime_instance is running."
