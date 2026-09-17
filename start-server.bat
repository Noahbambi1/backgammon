@echo off
REM Serves the app locally and opens it. Needs Python 3 (or use: npx serve .)
cd /d "%~dp0"
start "" http://localhost:8123/
python -m http.server 8123
