# Skill Factory 2.0 — 安全模型

## 安全扫描架构

```
SecurityScanner.scan(indexTs)
        │
        ├── trySemgrep(code)
        │       ├── 成功: 返回 Semgrep findings
        │       └── 失败(未安装/超时): 返回 null
        │
        └── 如果 Semgrep 返回 null → runBuiltinScan(code)
                └── 16 条内置正则规则
```

## 内置规则集（16 条）

| 规则 ID | 严重级别 | 检测内容 |
|---------|---------|---------|
| `hardcoded-api-key` | critical | 模式匹配 `api_key = 'xxx'` 等赋值 |
| `aws-access-key` | critical | `AKIA[0-9A-Z]{16}` AWS Key 格式 |
| `openai-key` | critical | `sk-[A-Za-z0-9]{20,}` |
| `github-token` | critical | `ghp_[A-Za-z0-9]{36}` |
| `slack-token` | critical | `xoxb-` 开头的 Slack Bot Token |
| `cmd-injection-exec-template` | high | `exec(\`...\${` 模板字符串 |
| `cmd-injection-spawn-sh` | high | `spawn('sh'...)` |
| `eval-usage` | high | `eval(...)` |
| `new-function` | high | `new Function(...)` |
| `sql-injection-template` | high | `` `SELECT...${`` 模板 SQL |
| `sql-injection-insert` | high | `` `INSERT...${`` 模板 SQL |
| `path-traversal` | medium | `../` 路径遍历 |
| `process-exit` | medium | `process.exit()` |
| `require-dynamic` | medium | 动态 `require(variable)` |
| `console-log-sensitive` | medium | `console.log(...password/secret/token...)` |
| `xmlhttprequest` | low | 使用 XMLHttpRequest（建议用 fetch） |

## 判定规则

- `critical` 或 `high` 发现 → `passed: false`（阻断流水线）
- 仅 `medium` / `low` 发现 → `passed: true`（附警告，可继续）

## Semgrep 集成（可选增强）

当系统安装了 `semgrep` CLI 时，SecurityScanner 会自动使用它：

```bash
# 安装 Semgrep
pip install semgrep

# 或通过 Homebrew
brew install semgrep

# 验证
semgrep --version
```

Semgrep 扫描使用 `--config auto`（自动选择规则集），超时 30 秒。
如果 Semgrep 扫描失败（未安装、网络问题、超时），自动降级到内置规则集，扫描仍会完成。

## Stage 3b 服务端重扫描

EnterpriseSkillFactory 在接收客户端提交时，会**重新执行**安全扫描（不信任客户端结果），确保：
1. 客户端不可绕过安全检查
2. 服务端可能有更完整的 Semgrep 规则集
3. 所有发布到 `skills/installed/` 的代码都经过服务端验证

## 已知局限

1. 内置正则规则基于静态文本匹配，**无法检测**：
   - 动态构造的恶意字符串（如 Base64 编码后 eval）
   - 间接依赖中的安全问题
2. 沙箱测试基于 `tsx` 进程隔离，非 gVisor/seccomp 级别
3. LLM Judge 安全维度基于模型知识，可能有误判
