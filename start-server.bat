@echo off
chcp 65001 >nul
title Hidden Chess - Online Server
cd /d "%~dp0"

set NODE_EXE=C:\Users\10716\.workbuddy\binaries\node\versions\22.22.2\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node

"%NODE_EXE%" server.js

echo.
echo Server stopped. Press any key to close.
pause >nul
