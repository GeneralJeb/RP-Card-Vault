# Creates Desktop and Start Menu shortcuts for RP Card Vault.
# Once the Start Menu entry exists you can search for "RP Card Vault" and
# right-click it to pin it to the taskbar.

$ErrorActionPreference = "Stop"
$base = Split-Path -Parent $MyInvocation.MyCommand.Path

$launcher = Join-Path $base "RP Card Vault.vbs"
$icon     = Join-Path $base "RP_Card_Vault.ico"

if (-not (Test-Path $launcher)) {
  Write-Host ""
  Write-Host "  Can't find 'RP Card Vault.vbs' next to this script." -ForegroundColor Red
  Write-Host "  Keep all the vault files together in one folder."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

# This copy's own settings, from vault.local next to this script if there is
# one (lines like  port=8791  and  label=test ). A label keeps a second copy's
# shortcuts from overwriting the first copy's.
$port  = "8790"
$label = ""
$local = Join-Path $base "vault.local"
if (Test-Path $local) {
  foreach ($line in Get-Content $local) {
    $k = $line.IndexOf("=")
    if ($k -gt 0) {
      $name  = $line.Substring(0, $k).Trim().ToLower()
      $value = $line.Substring($k + 1).Trim()
      if ($name -eq "port")  { $port  = $value }
      if ($name -eq "label") { $label = $value }
    }
  }
}

function New-VaultShortcut($path, $mode, $desc) {
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($path)
  $sc.TargetPath       = "$env:SystemRoot\System32\wscript.exe"
  $sc.Arguments        = '"' + $launcher + '"' + $(if ($mode) { " $mode" } else { "" })
  $sc.WorkingDirectory = $base
  $sc.Description      = $desc
  if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
  $sc.Save()
  return $path
}

# Two entry points, same server and same address - so they share your folder
# permissions, tags and notes. Pin whichever you prefer, or both.
$suffix = $(if ($label) { " ($label)" } else { "" })
$tabSuffix = $(if ($label) { " ($label, Tab)" } else { " (Tab)" })
$variants = @(
  @{ Name = "RP Card Vault$suffix";    Mode = "";    Desc = "RP Card Vault on port $port" },
  @{ Name = "RP Card Vault$tabSuffix"; Mode = "tab"; Desc = "RP Card Vault on port $port, in an ordinary browser tab" }
)

$made = @()
$targets = @()

$desktop = [Environment]::GetFolderPath("Desktop")
if ($desktop -and (Test-Path $desktop)) { $targets += $desktop }

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
if (Test-Path $startMenu) { $targets += $startMenu }

foreach ($t in $targets) {
  foreach ($v in $variants) {
    $made += New-VaultShortcut (Join-Path $t ($v.Name + ".lnk")) $v.Mode $v.Desc
  }
}

Write-Host ""
Write-Host "  Shortcuts created:" -ForegroundColor Green
foreach ($m in $made) { Write-Host "    $m" }
Write-Host ""
Write-Host ("  " + $variants[0].Name + " - standalone window, its own taskbar button") -ForegroundColor Cyan
Write-Host ("  " + $variants[1].Name + " - opens as a normal browser tab") -ForegroundColor Cyan
Write-Host ""
Write-Host "  Both start the server quietly if it isn't already running, and both"
Write-Host "  use the same address (port $port), so your folders, tags and notes"
Write-Host "  are identical either way."
Write-Host ""
Write-Host "  To pin one to the taskbar: press Start, type 'RP Card Vault',"
Write-Host "  right-click the result you want and choose 'Pin to taskbar'."
Write-Host ""
Read-Host "Press Enter to close"
