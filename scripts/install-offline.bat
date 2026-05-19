@echo off
REM CMaster Bot — Windows 内网离线安装入口
REM 适用场景：无法访问 GitHub 的内网环境
REM 请在项目根目录以管理员权限运行本脚本

echo.
echo  CMaster Bot — 内网离线安装模式
echo  ================================
echo  正在启动 PowerShell 离线安装脚本...
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0install-offline.ps1"
