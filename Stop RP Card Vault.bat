@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem Stops the vault server on this copy's port (8790, or the port set in
rem vault.local next to this file).
rem
rem "Start RP Card Vault.bat" calls this first, with /quiet, so starting always
rem gives you the serve.js that is on disk right now. You can also run it on its
rem own to shut the vault down.
rem
rem Why it is needed at all: "RP Card Vault.vbs" starts node in a hidden window,
rem so closing a console does not stop it, and after you edit serve.js the OLD
rem code is still the thing answering requests.
rem
rem SAFETY: only a process that is LISTENING on this exact port AND is node.exe
rem is stopped, and it is stopped by PID. Never by image name - that would take
rem SillyTavern and every other node process with it.

set VAULT_PORT=8790
if exist "%~dp0vault.local" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0vault.local") do (
    if /i "%%a"=="port" set VAULT_PORT=%%b
  )
)
set FOUND=0
set QUIET=0
if /i "%~1"=="/quiet" set QUIET=1

if "%QUIET%"=="0" (
  echo.
  echo   Looking for a vault server on port %VAULT_PORT%...
  echo.
)

rem The first findstr is a cheap pre-filter over the whole netstat output; the
rem second checks that it is the LOCAL address that ends in our port, so a
rem browser's outgoing socket to this port can never match. Deliberately no filter on
rem "LISTENING": that word is translated on non-English Windows, and matching it
rem would make this silently find nothing.
for /f "tokens=2,5" %%a in ('netstat -ano -p TCP ^| findstr /c:":%VAULT_PORT% "') do (
  rem No space before the pipe. "echo %%a | findstr" would echo the trailing
  rem space too, so the line would end ":8790 " and /e (end of line) would never
  rem match - the loop finds nothing and nothing is ever stopped.
  echo %%a| findstr /e /c:":%VAULT_PORT%" >nul 2>nul
  if not errorlevel 1 (
    for /f "tokens=1" %%n in ('tasklist /fi "PID eq %%b" /nh ^| findstr /i /c:"node.exe"') do (
      rem Always announce a kill, even in quiet mode. Stopping someone's
      rem process silently is not a thing to do.
      echo   Stopping the running vault server: %%n ^(PID %%b^)
      taskkill /PID %%b /F >nul 2>nul
      if errorlevel 1 (
        echo     could not stop it - try again from an admin prompt
      ) else (
        set FOUND=1
      )
    )
  )
)

if "!FOUND!"=="1" (
  rem Give Windows a moment to release the socket before anything rebinds it.
  ping -n 2 127.0.0.1 >nul 2>nul
)

if "%QUIET%"=="1" goto :eof

if "!FOUND!"=="0" (
  echo   Nothing was listening on %VAULT_PORT%.
  echo.
  echo   If the vault is still reachable in your browser, something other than
  echo   node.exe is serving it - check with:  netstat -ano ^| findstr :%VAULT_PORT%
) else (
  echo.
  echo   Stopped. Start it again with "Start RP Card Vault.bat".
)

echo.
pause
