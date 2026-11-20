@echo off
rem Serve the Moonwards website locally.
rem A local server is needed because ES modules do not load over file:// links.
rem serve.py serves Website\ and tells the browser to check for a newer copy
rem of every file on each load, so a plain reload picks up edits.
cd /d "%~dp0"
echo Serving Website\ at http://localhost:8000/   (press Ctrl+C to stop)
rem Open the browser a couple of seconds from now, once the server below is
rem listening; opening it first can show "refused to connect".
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8000/"
py -3 serve.py 8000 2>nul || python serve.py 8000
if errorlevel 1 (
  echo.
  echo Python was not found. Install it from python.org, or run:  npx serve
  pause
)
