# Skill Factory 2.0 — 用户指南

## 快速上手：5 步创建第一个技能

### Step 1：打开 Skill Factory

访问 `/skills/factory`（或从 `/skills` 页面点击"创建技能"按钮）。

### Step 2：描述你的技能

在文本框中用自然语言描述技能的功能，例如：

```
创建一个能查询 GitHub 仓库 PR 列表并按优先级排序的技能，
支持按标签和状态（open/closed）过滤，返回 JSON 格式结果。
```

点击"分析需求并生成 Spec"，等待 AI 分析意图。

### Step 3：确认 SkillSpec

AI 会生成结构化的 SkillSpec，包含：
- 技能名称（kebab-case）
- 输入参数定义
- 测试用例

可以直接修改名称或描述，确认无误后点击"确认并生成代码"。

> 如果检测到相似技能（如 `github-issues-tracker`），系统会提示你避免重复开发。

### Step 4：等待代码生成

AI 会自动生成 3 个文件：
- `SKILL.md`：技能文档
- `index.ts`：实现代码
- `unit.test.ts`：单元测试

可在预览面板中检查代码，然后点击"进入验证测试"。

### Step 5：验证并发布

系统自动运行 4 层质量检查：

| 检查 | 说明 |
|------|------|
| 静态检查 | frontmatter 完整性、kebab-case、export 函数存在 |
| 安全扫描 | 检测硬编码密钥、命令注入、SQL 注入等 |
| 沙箱测试 | 在隔离环境中执行 testCases |
| LLM Judge | 实用性/健壮性/安全性/文档质量评分 |

检查通过后，选择：
- **安装为个人草稿**：安装到 `skills/local/`，立即可用
- **提交企业评审**：进入审批队列，审批通过后部署到 `skills/installed/`

---

## 提交企业评审流程

1. 完成 Steps 1-4，确保所有质量检查通过（LLM Judge 分数 ≥ 7）
2. 点击"提交企业评审"
3. 系统返回 `reviewId`，可在 Admin Console 中跟踪
4. 管理员在 `/api/admin/skill-factory/reviews/:id/approve` 批准
5. 系统自动执行 Stage 5（SkillPublisher），技能部署到 `skills/installed/`

### 管理员审批 API

```bash
# 批准
curl -X POST /api/admin/skill-factory/reviews/{reviewId}/approve \
  -H 'X-Admin-Key: your-key' \
  -d '{"notes": "代码质量良好，安全无虞"}'

# 拒绝
curl -X POST /api/admin/skill-factory/reviews/{reviewId}/reject \
  -H 'X-Admin-Key: your-key' \
  -d '{"reason": "缺少错误处理，请补充 try/catch"}'
```

---

## 通过 API 直接使用（无 UI）

```bash
# 1. 创建 Job
JOB=$(curl -s -X POST /api/admin/skill-factory/jobs \
  -H 'X-Admin-Key: admin-key' \
  -d '{"intent": "查询 Jira Issue 状态"}' | jq -r .id)

# 2. 运行全部阶段
curl -X POST /api/admin/skill-factory/jobs/$JOB/run \
  -H 'X-Admin-Key: admin-key' \
  -d '{"stages": ["all"]}'

# 3. 安装草稿
curl -X POST /api/admin/skill-factory/jobs/$JOB/install \
  -H 'X-Admin-Key: admin-key'

# 4. 或提交评审
curl -X POST /api/admin/skill-factory/jobs/$JOB/submit \
  -H 'X-Admin-Key: admin-key'
```

---

## FAQ

**Q: 为什么 LLM Judge 分数低于 7？**

LLM Judge 从 4 个维度评分，任一维度不足都会拉低总分。常见原因：
- 代码缺少 try/catch（健壮性低）
- SKILL.md 参数描述不够详细（文档分低）
- 测试用例覆盖率不足

建议重新提交描述时，明确说明"需要完善错误处理"和"需要详细文档"。

**Q: 沙箱测试显示"mock"是什么意思？**

当系统未安装 `tsx` 时，沙箱测试会以 mock 模式运行（不真实执行代码）。安装 tsx：

```bash
npm install -g tsx
```

**Q: 安全扫描报告 path-traversal 但我的代码没问题？**

内置规则检测 `../` 字符串，可能有误报。medium 级别问题不阻断流水线，可以继续发布。提交企业评审时，管理员会做最终判断。

**Q: 如何批量查看所有技能的使用情况？**

```bash
curl /api/admin/skill-catalog -H 'X-Admin-Key: admin-key'
# 返回所有技能的 curation_status 和 usage_30d
```

**Q: 可以直接编辑生成的代码吗？**

目前 Web UI 不支持在线编辑代码，但生成后安装为草稿（`skills/local/`），可以在本地用编辑器直接修改文件。修改后需要重启服务或触发热重载。
