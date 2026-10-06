@echo off
setlocal
cd /d "%~dp0"

rem The port the vault runs on. Browser storage is keyed to the address, so
rem every port is a separate vault: its own database and folder permissions.
rem To run a second copy side by side, give it its own port in a file named
rem vault.local next to this one (see HOW TO RUN.txt), e.g.  port=8791
set VAULT_PORT=8790
set VAULT_LABEL=
if exist "%~dp0vault.local" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0vault.local") do (
    if /i "%%a"=="port" set VAULT_PORT=%%b
    if /i "%%a"=="label" set VAULT_LABEL=%%b
  )
)
rem Brackets inside an if block need ^ before them, or cmd ends the block there.
if defined VAULT_LABEL (
  title RP Card Vault ^(%VAULT_LABEL%, port %VAULT_PORT%^)
) else (
  title RP Card Vault ^(port %VAULT_PORT%^)
)

if not exist "RP_Card_Vault.html" (
  echo.
  echo   RP_Card_Vault.html is not in this folder:
  echo     %~dp0
  echo.
  echo   Put this .bat file next to RP_Card_Vault.html and run it again.
  echo.
  pause
  exit /b 1
)

rem Always start from a clean slate. "RP Card Vault.vbs" leaves node running in
rem a hidden window, so without this you would edit serve.js, run this, be told
rem the vault is "already running", and go on testing the OLD code.
rem
rem --restart does the work: the new server asks the running one to stand down
rem over HTTP and then takes the port. No netstat parsing, no PID matching, and
rem it can only ever stop a server that answers to the vault's own API.
rem
rem Stop RP Card Vault.bat stays as the fallback for the two cases HTTP cannot
rem cover: a server too old to have the shutdown route, and one that has wedged.
rem A portable Node kept with the vault comes first (node\node.exe, or node.exe
rem next to this file), so the vault can run from a USB drive on a computer
rem that has no Node installed. Download the Windows "zip" build from
rem nodejs.org and unpack it into a folder named node here.
set NODE_EXE=
if exist "%~dp0node\node.exe" set NODE_EXE=%~dp0node\node.exe
if not defined NODE_EXE if exist "%~dp0node.exe" set NODE_EXE=%~dp0node.exe
if defined NODE_EXE (
  echo   Starting with the portable Node on port %VAULT_PORT%...
  "%NODE_EXE%" "%~dp0serve.js" %VAULT_PORT% --restart
  goto :done
)

rem Then an installed Node - you already have it if you run SillyTavern.
where node >nul 2>nul
if %errorlevel%==0 (
  echo   Starting with Node on port %VAULT_PORT%...
  node "%~dp0serve.js" %VAULT_PORT% --restart
  goto :done
)

rem Fall back to Python if Node is missing. This serves the page and nothing
rem else: python -m http.server knows nothing about /__vault/, so the AI relay
rem and the front-end bridge are both dead in this mode. Everything that runs
rem in the browser - scanning, tagging, editing - still works.
rem
rem python -m http.server would serve EVERY file in its folder (the agent's
rem workspace, vault.local, .git), so it serves a copy of just the app's own
rem files, made fresh in a temporary folder each time.
set STAGE=%TEMP%\rp-card-vault-web-%VAULT_PORT%
where py >nul 2>nul
if %errorlevel%==0 goto :stage
where python >nul 2>nul
if %errorlevel%==0 goto :stage
goto :nopython

:stage
if exist "%STAGE%" rmdir /s /q "%STAGE%"
robocopy "%~dp0." "%STAGE%" RP_Card_Vault.html manifest.webmanifest sw.js icon-192.png icon-512.png RP_Card_Vault.ico /NJH /NJS /NFL /NDL /NP >nul
robocopy "%~dp0lib" "%STAGE%\lib" /E /NJH /NJS /NFL /NDL /NP >nul
where py >nul 2>nul
if %errorlevel%==0 (
  echo   Node not found - using Python instead.
  echo   WARNING: no /__vault/ relay, so the AI features and the front-end
  echo            upload bridge will not work. Install Node.js to get them.
  echo   Open: http://127.0.0.1:%VAULT_PORT%/RP_Card_Vault.html
  start "" "http://127.0.0.1:%VAULT_PORT%/RP_Card_Vault.html"
  py -m http.server %VAULT_PORT% --bind 127.0.0.1 --directory "%STAGE%"
  goto :done
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo   Node not found - using Python instead.
  echo   WARNING: no /__vault/ relay, so the AI features and the front-end
  echo            upload bridge will not work. Install Node.js to get them.
  echo   Open: http://127.0.0.1:%VAULT_PORT%/RP_Card_Vault.html
  start "" "http://127.0.0.1:%VAULT_PORT%/RP_Card_Vault.html"
  python -m http.server %VAULT_PORT% --bind 127.0.0.1 --directory "%STAGE%"
  goto :done
)

:nopython
echo.
echo   Neither Node.js nor Python was found on this machine.
echo.
echo   Node.js is the easier fix - https://nodejs.org  (LTS installer)
echo   If you run SillyTavern, you already have it; this window just
echo   cannot see it, which usually means Node is not on your PATH.
echo.

:done
echo.
echo   Server stopped.
echo.
echo   Running this again always restarts from the serve.js on disk, so there
echo   is no need to stop anything by hand after an edit.
echo.
pause
