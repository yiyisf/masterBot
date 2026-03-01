@echo off
REM CMaster Bot — Windows CMD 入口，调用 PowerShell 安装脚本
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
