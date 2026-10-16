@echo off
chcp 65001 >nul
title 在线答题系统
cd /d "%~dp0"

echo ================================================
echo   正在启动在线答题系统...
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装 Node.js 后重试。
  pause
  exit /b 1
)

REM 换端口改这里：set PORT=8080
if "%PORT%"=="" set PORT=3210

echo   答题页  : http://127.0.0.1:%PORT%/
echo   管理后台: http://127.0.0.1:%PORT%/admin
echo.
echo   关闭本窗口即可停止服务。
echo.

start "" http://127.0.0.1:%PORT%/admin
node server.js

echo.
echo 服务已停止。
pause
