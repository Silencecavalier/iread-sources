@echo off
chcp 65001 >nul
title iread 书源库 · 管理后台
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 node.exe，请先安装 Node.js（https://nodejs.org）再双击这个文件。
  pause
  exit /b 1
)
echo 正在启动管理后台，浏览器会自动打开；关掉这个窗口就停止服务。
node server.js
echo.
echo 服务已停止。
pause
