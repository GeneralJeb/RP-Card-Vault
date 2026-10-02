@echo off
rem Makes Desktop + Start Menu shortcuts for RP Card Vault, so it can be
rem pinned to the taskbar like any other app. Run this once.
title RP Card Vault - create shortcuts
cd /d "%~dp0"

if not exist "Create Shortcut.ps1" (
  echo.
  echo   Create Shortcut.ps1 is missing from this folder.
  echo   Keep all the vault files together.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Create Shortcut.ps1"
