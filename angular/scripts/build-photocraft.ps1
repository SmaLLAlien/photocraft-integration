# Пересобирает веб-версию PhotoCraft и кладёт её в public/photocraft.
# Нужно один раз:  rustup target add wasm32-unknown-unknown ;  cargo install trunk --locked
# Запуск:          npm run photocraft:build
$ErrorActionPreference = 'Stop'
$angular = Split-Path -Parent $PSScriptRoot
$repo    = Join-Path (Split-Path -Parent $angular) 'photocraft'
$web     = Join-Path $repo 'apps\photocraft-web'
$dist    = Join-Path $repo 'dist\web'
$target  = Join-Path $angular 'public\photocraft'

Push-Location $web
try { trunk build --release } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "trunk build failed ($LASTEXITCODE)" }

if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Copy-Item $dist $target -Recurse
Write-Host "PhotoCraft скопирован в $target"
