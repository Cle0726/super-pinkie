# update.ps1 — pull the latest 超级碧琪 kit from its git remote and re-apply.
# Usage:  .\update.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "==> pulling updates from origin"
if (-not (Test-Path ".git")) {
  Write-Host "error: this kit is not a git checkout (clone it from the repo instead of downloading a zip)."
  exit 1
}
git fetch origin
if (-not (git pull --ff-only origin)) {
  Write-Host "local changes detected; stashing and retrying"
  git stash push -m "super-pinkie-update-$(Get-Date -UFormat %s)" | Out-Null
  git pull --ff-only origin
  git stash pop | Out-Null
}

Write-Host "==> re-applying prompts, patches and proxy"
& .\install.ps1
Write-Host "done. Restart the openclaw gateway if it was running."
