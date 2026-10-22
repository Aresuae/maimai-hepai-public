@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在准备麦麦合拍朋友入口...
call npm.cmd run share:build
if errorlevel 1 goto failed
call npm.cmd run share:start
:failed
pause
