@echo off
cd /d "%~dp0"
call npm.cmd run local:keepalive
pause
