<#
.SYNOPSIS
    Registers (or re-configures) the Dashboard IoT Global backend as a Windows
    Service via NSSM.

.DESCRIPTION
    Idempotent: run it again after a `git pull` or a config change and it stops
    the service, rewrites every setting, and starts it back up.

    The service runs node.exe against tsx's CLI rather than `npm start`, because
    NSSM would otherwise supervise cmd.exe and see a clean exit the moment npm
    hands off - a crashed API would look like a healthy service.

    Must run from an elevated PowerShell (service registration needs it).

.PARAMETER RepoRoot
    Checkout root - the folder holding package.json. Defaults to this script's
    parent.

.PARAMETER ServiceName
    Windows service name. Defaults to DashboardIotApi.

.PARAMETER Nssm
    Path to nssm.exe. Defaults to whatever is on PATH.

.PARAMETER LogDir
    Where stdout/stderr are written. Defaults to <RepoRoot>\logs, which is
    already gitignored.

.EXAMPLE
    .\scripts\install-service.ps1 -Nssm C:\tools\nssm\nssm.exe
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$ServiceName = 'DashboardIotApi',
    [string]$DisplayName = 'Dashboard IoT Global API',
    [string]$Nssm = 'nssm.exe',
    [string]$LogDir
)

$ErrorActionPreference = 'Stop'

function Assert-Path {
    param([string]$Path, [string]$What, [string]$Fix)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$What not found at: $Path`n  -> $Fix"
    }
}

# --- Preconditions -----------------------------------------------------------

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated PowerShell ("Run as Administrator").'
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not $LogDir) { $LogDir = Join-Path $RepoRoot 'logs' }

$nssmCmd = Get-Command $Nssm -ErrorAction SilentlyContinue
if (-not $nssmCmd) {
    throw "nssm.exe not found (looked for '$Nssm'). Download it from https://nssm.cc/download, unzip win64\nssm.exe somewhere like C:\tools\nssm, then re-run with -Nssm C:\tools\nssm\nssm.exe"
}
$Nssm = $nssmCmd.Source

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'node.exe is not on PATH. Install Node.js LTS (>= 20.19) and reopen PowerShell.' }
$node = $nodeCmd.Source

# `node -v` prints v20.19.0; strip the v and compare against the engines floor.
$nodeVersion = [version]((& $node -v).TrimStart('v'))
if ($nodeVersion -lt [version]'20.19.0') {
    throw "Node $nodeVersion is below the >= 20.19 floor in package.json. Upgrade before installing the service."
}

$serverDir = Join-Path $RepoRoot 'server'
$tsxCli    = Join-Path $RepoRoot 'node_modules\tsx\dist\cli.mjs'
$envFile   = Join-Path $serverDir '.env'

Assert-Path $serverDir 'server/ directory' 'Is -RepoRoot pointing at the checkout root?'
Assert-Path $tsxCli    'tsx CLI'          'Run `npm ci` at the repo root first. Do NOT use --omit=dev: tsx is a devDependency and the service runs on it.'
Assert-Path $envFile   'server/.env'      'Copy server/.env.example to server/.env and fill in the InfluxDB values. It is gitignored, so a fresh clone never has one.'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# --- What server/.env is actually asking for ----------------------------------
#
# Read rather than trusted: STATIC_DIR pointing at a folder nobody has built is
# a service that starts, answers /api/v1 and 404s every page - the failure that
# looks like a broken deploy and is a missing `npm run build`.

$envValues = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $pair = $line -split '=', 2
    $envValues[$pair[0].Trim()] = $pair[1].Trim()
}

$port = if ($envValues['PORT']) { $envValues['PORT'] } else { '4000' }
$staticDir = $envValues['STATIC_DIR']

if ([string]::IsNullOrWhiteSpace($staticDir)) {
    Write-Warning "STATIC_DIR is blank in server\.env - the service will serve the API only and every page will 404. Set it to the absolute path of dist\ unless a reverse proxy is serving the frontend."
} else {
    Assert-Path $staticDir 'STATIC_DIR' 'Set it to an absolute path - the service runs with server\ as its working directory, so a relative one resolves somewhere else.'
    Assert-Path (Join-Path $staticDir 'index.html') 'dist\index.html' 'The folder exists but has not been built. Run `npm run build` at the repo root.'
}

if ($envValues['CORS_ORIGIN'] -eq '*') {
    Write-Warning "CORS_ORIGIN is '*', which browsers reject alongside the credentials this API sends. Harmless while the page and the API share an origin; a silent failure the day they do not."
}

# --- Register ----------------------------------------------------------------

# Quoted: the checkout may sit under a path with spaces.
$appParameters = '"{0}" --env-file=.env src/index.ts' -f $tsxCli

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Service '$ServiceName' exists - stopping and re-configuring."
    & $Nssm stop $ServiceName | Out-Null
} else {
    Write-Host "Installing service '$ServiceName'."
    & $Nssm install $ServiceName $node
    if ($LASTEXITCODE -ne 0) { throw "nssm install failed (exit $LASTEXITCODE)." }
}

$settings = @(
    @('Application',       $node),
    @('AppDirectory',      $serverDir),
    @('AppParameters',     $appParameters),
    @('DisplayName',       $DisplayName),
    @('Description',       'Global IoT dashboard. Serves the built frontend and /api/v1 on the port in server/.env.'),
    @('Start',             'SERVICE_AUTO_START'),
    # Ctrl-C first: index.ts installs a SIGINT handler that closes Fastify and
    # stops the snapshot poller. Killing the process instead leaves the InfluxDB
    # request in flight.
    @('AppStopMethodConsole', '15000'),
    @('AppStdout',         (Join-Path $LogDir 'api-out.log')),
    @('AppStderr',         (Join-Path $LogDir 'api-err.log')),
    @('AppRotateFiles',    '1'),
    @('AppRotateOnline',   '1'),
    @('AppRotateBytes',    '10485760'),
    @('AppExit',           'Default', 'Restart'),
    @('AppRestartDelay',   '5000')
)

foreach ($s in $settings) {
    & $Nssm set $ServiceName @s | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "nssm set $($s[0]) failed (exit $LASTEXITCODE)." }
}

& $Nssm start $ServiceName
if ($LASTEXITCODE -ne 0) { throw "nssm start failed (exit $LASTEXITCODE). Check $LogDir\api-err.log." }

Write-Host ''
Write-Host "Started. Verify with:" -ForegroundColor Green
Write-Host "  Invoke-RestMethod http://127.0.0.1:$port/healthz"
Write-Host "  Invoke-WebRequest http://127.0.0.1:$port/"
Write-Host "  Get-Content '$LogDir\api-err.log' -Tail 20"
