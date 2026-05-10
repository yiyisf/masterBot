# 基础设施清单

后续各 Phase 需要的基础设施，分两类：**立即需要**（影响当前开发）和**上线前需要**（影响 Phase 10+）。

---

## 开发期基础设施（Phase 1–9 需要）

### npm Registry

| 项目 | 说明 | 状态 |
|------|------|------|
| 公共 npmjs.org | 默认使用 | ✅ 已可用 |
| 企业内部 Nexus / Verdaccio | 如需私有包分发时配置 | ⬜ 按需 |

> **Phase 0 发现**：`npm install` 时存在 `Unknown user config "registy"` 警告（拼写错误），
> 需清理 `~/.npmrc` 或项目 `.npmrc` 中的错误配置。

### 代码仓库 & CI

| 项目 | 说明 | 状态 |
|------|------|------|
| GitHub 仓库 (yiyisf/cmasterBot) | 主仓库 | ✅ 已可用 |
| GitHub Actions CI | 现有 `.github/workflows/ci.yml` | ✅ 已可用 |
| CI 中 `--legacy-peer-deps` | Phase 2 升级 zod 前临时需要 | ⬜ 需配置 |

### 可观测性（Phase 1 前完成）

| 项目 | 说明 | 部署方式 | 状态 |
|------|------|---------|------|
| Langfuse self-hosted | OTel trace 可视化 | docker-compose 新增 service | ⬜ Phase 1 |
| OpenTelemetry Collector（可选）| 汇聚 OTel 数据 | docker container | ⬜ 按需 |

### LLM 网关（Phase 2.5 前完成）

| 项目 | 说明 | 状态 |
|------|------|------|
| Anthropic API Key | 用于 Claude SDK 路径 | ✅ 已有（.env） |
| LLM Gateway（企业部署时）| 统一管理凭据，防止 key 散落客户端 | ⬜ Phase 2.5 |
| Bedrock / Vertex 账号（可选）| 企业 VPC 内 Anthropic 调用 | ⬜ 按需 |

---

## 上线期基础设施（Phase 10+ 需要）

### 企业 SSO（Phase 2.5 设计，Phase 10 强制）

| 项目 | 说明 | 状态 |
|------|------|------|
| IdP（Okta / Azure AD / 飞书 IdP） | SAML 2.0 / OIDC | ⬜ 需企业提供 |
| SCIM 端点配置 | 用户自动同步 | ⬜ Phase 2.5 实现 |

### 数据库（Phase 6 前完成）

| 项目 | 说明 | 状态 |
|------|------|------|
| SQLite（当前）| 本地分发默认 | ✅ 已可用 |
| PostgreSQL + pgvector | Phase 6 长期记忆向量检索 | ⬜ Phase 6 |

### 审计回传（Phase 10 前完成）

| 项目 | 说明 | 状态 |
|------|------|------|
| 审计日志回传接口 | 客户端本地审计异步上报 | ⬜ Phase 8 |
| 不可篡改日志存储（WORM）| 企业合规要求 | ⬜ Phase 8 |

---

## 桌面应用发布（Phase 14+ 需要）

### 代码签名

| 平台 | 证书类型 | 状态 |
|------|---------|------|
| macOS | Apple Developer ID Application 证书 | ⬜ Phase 13 前申请 |
| Windows | EV Code Signing Certificate（OV 最低）| ⬜ Phase 13 前申请 |

### 分发渠道

| 渠道 | 说明 | 状态 |
|------|------|------|
| GitHub Releases | 公开分发用 | ⬜ Phase 14 |
| 企业内部分发服务 | IT 批量部署（MSI/PKG） | ⬜ Phase 16 |

### 自动升级服务

| 项目 | 说明 | 状态 |
|------|------|------|
| Electron Forge / electron-updater | 应用自动更新 | ⬜ Phase 15 |
| 技能同步 Registry | 技能增量推送 | ⬜ Phase 15 |
| 配置热更新端点 | 无需重启更新配置 | ⬜ Phase 15 |

---

## 已知问题 & 风险

| 问题 | 影响 | 缓解措施 |
|------|------|---------|
| npm 配置存在 `registy` 拼写错误 | 每次 npm install 时警告 | 检查 `~/.npmrc` 并修正 |
| `@anthropic-ai/claude-agent-sdk` requires zod v4 | CI 需加 `--legacy-peer-deps` | Phase 2 升级 zod 3→4 |
| `node:sqlite` 同步 API 在高并发场景有阻塞风险 | Web 服务器并发时性能 | Phase 6 评估迁移 Turso/libSQL |
