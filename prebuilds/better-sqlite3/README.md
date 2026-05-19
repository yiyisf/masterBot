# better-sqlite3 Windows 预编译文件

本目录存放 `better-sqlite3 v12.10.0` 的 Windows 平台原生模块预编译文件，
供内网（无法直接访问 GitHub）环境离线安装使用。

## 文件说明

| 文件名 | 适用平台 | Node.js ABI |
|--------|----------|-------------|
| `better-sqlite3-v12.10.0-node-v127-win32-x64.tar.gz` | Windows x64（64位） | Node.js 22.x |
| `better-sqlite3-v12.10.0-node-v127-win32-arm64.tar.gz` | Windows ARM64 | Node.js 22.x |

> **关于 Windows x86 32位（ia32）**
>
> Node.js 22 已停止对 Windows 32 位（x86/ia32）的支持，因此不存在对应的预编译文件。
> 本项目要求 Node.js >= 22，**不支持在 32 位 Windows 系统上运行**。
> 如需 32 位支持，请参阅文档末尾的说明。

## 文件来源

官方下载地址（需要互联网访问）：
```
https://github.com/WiseLibs/better-sqlite3/releases/download/v12.10.0/
```

## 使用方法

请参阅 [`docs/offline-install.md`](../../docs/offline-install.md) 中的完整安装说明，
或直接运行：

```bat
scripts\install-offline.bat
```
