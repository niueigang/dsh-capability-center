@echo off
setlocal
title DSH Capability Center - one click install
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $ErrorActionPreference = 'Stop'; irm https://raw.githubusercontent.com/niueigang/dsh-capability-center/main/install.ps1 | iex }"
echo.
pause
