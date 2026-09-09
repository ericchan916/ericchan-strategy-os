$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $projectRoot

try {
  $nodeVersion = & node --version 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) {
    throw "Node.js 18 or newer is required. Install Node.js LTS from https://nodejs.org/ and run install.cmd again."
  }

  $majorVersion = [int](($nodeVersion -replace "^v", "").Split(".")[0])
  if ($majorVersion -lt 18) {
    throw "Node.js 18 or newer is required. Found $nodeVersion."
  }

  & npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

  if (-not (Test-Path -LiteralPath ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example. Add optional LLM or search keys only when you need them."
  } else {
    Write-Host "Preserved existing .env."
  }

  & npm test
  if ($LASTEXITCODE -ne 0) { throw "Verification tests failed." }

  Write-Host ""
  Write-Host "Installation complete. Start the local workspace with: npm run ask:ui"
  Write-Host "Then open: http://127.0.0.1:5177"
} finally {
  Pop-Location
}
