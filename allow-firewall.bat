@echo off
chcp 65001 >nul
title Allow TCP 8080 for Hidden Chess

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   [!] Need administrator rights.
  echo   [!] Right-click this file  -^>  "Run as administrator"
  echo.
  pause
  exit /b
)

netsh advfirewall firewall delete rule name="HiddenChess 8080" >nul 2>&1
netsh advfirewall firewall add rule name="HiddenChess 8080" dir=in action=allow protocol=TCP localport=8080

echo.
echo   OK - TCP port 8080 is now allowed through Windows Firewall.
echo   Your friend can reach the game now.
echo.
pause
