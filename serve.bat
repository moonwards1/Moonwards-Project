@echo off
rem Serve the Moonwards website locally.
rem A local server is needed because ES modules do not load over file:// links.
cd /d "%~dp0Website"
echo Serving Website\ at http://localhost:8000/   (press Ctrl+C to stop)
rem Open the browser a couple of seconds from now, once the server below is
rem listening; opening it first can show "refused to connect".
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8000/"
py -3 -m http.server 8000 2>nul || python -m http.server 8000
if errorlevel 1 (
  echo.
  echo Python was not found. Install it from python.org, or run:  npx serve
  pause
)
