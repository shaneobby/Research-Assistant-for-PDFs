<#
  One-command dev start (Windows): creates the venv, installs deps if missing,
  copies .env.example -> .env, then runs backend (:8000) and frontend (:5173).
  Usage:  powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
  Press Ctrl+C to stop both servers.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$venvPy = Join-Path $backend '.venv\Scripts\python.exe'

# --- backend setup ---
if (-not (Test-Path $venvPy)) {
    Write-Host '==> Creating Python venv' -ForegroundColor Cyan
    $made = $false
    foreach ($cmd in @(@('py', '-3.12'), @('py', '-3'), @('python'))) {
        if (Get-Command $cmd[0] -ErrorAction SilentlyContinue) {
            & $cmd[0] @($cmd[1..($cmd.Count)] | Where-Object { $_ }) -m venv (Join-Path $backend '.venv')
            if ($LASTEXITCODE -eq 0) { $made = $true; break }
        }
    }
    if (-not $made) { throw 'Python 3.12+ not found. Install it from python.org.' }
}
$stamp = Join-Path $backend '.venv\.deps-installed'
$req = Join-Path $backend 'requirements.txt'
if (-not (Test-Path $stamp) -or (Get-Item $req).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
    Write-Host '==> Installing backend dependencies' -ForegroundColor Cyan
    & $venvPy -m pip install -q -r $req
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
    New-Item -ItemType File -Force $stamp | Out-Null
}
$envFile = Join-Path $backend '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $backend '.env.example') $envFile
    Write-Host '==> Created backend\.env (mock provider, no API key needed)' -ForegroundColor Cyan
}

# --- frontend setup ---
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ not found. Install it from nodejs.org.' }
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host '==> Installing frontend dependencies' -ForegroundColor Cyan
    Push-Location $frontend; npm install; Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

# --- run ---
Write-Host '==> Backend  http://localhost:8000   Frontend  http://localhost:5173' -ForegroundColor Green
$api = Start-Process -FilePath $venvPy -ArgumentList '-m', 'uvicorn', 'app.main:app', '--port', '8000' -WorkingDirectory $backend -NoNewWindow -PassThru
try {
    Start-Process 'http://localhost:5173' -ErrorAction SilentlyContinue
    Push-Location $frontend
    npm run dev
    Pop-Location
} finally {
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force }
}
