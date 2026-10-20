@echo off
chcp 65001 >nul
echo ========================================================
echo   正在啟動 WEALTH HORIZON (財富推進器) 本機服務...
echo ========================================================
start "" http://localhost:8085
python -m http.server 8085
pause
