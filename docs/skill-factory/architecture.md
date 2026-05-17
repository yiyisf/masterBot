# Skill Factory 2.0 — 架构设计

## 5 阶段流水线

```
用户意图（自然语言）
        │
        ▼
┌──────────────────┐
│  Stage 1         │  UNDERSTAND
│  NL Spec Builder │  SpecBuilder.build()
│                  │  · 多轮 LLM 对话澄清
│                  │  · Skill Catalog 去重检测
│                  │  → 输出: SkillSpec
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Stage 2         │  SYNTHESIZE
│  SkillSynthesizer│  SkillSynthesizer.synthesize()
│                  │  · LLM 生成 3 个文件
│                  │  · 最多 3 次重试
│                  │  → 输出: skillMd + indexTs + testTs
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Stage 3         │  VERIFY（双重验证）
│  StaticValidator │  · 3a 静态分析（frontmatter/kebab-case/export）
│  SecurityScanner │  · 3b 安全扫描（Semgrep优先→内置规则降级）
│                  │  → 输出: ValidationResult + SecurityScanResult
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Stage 4         │  EVAL（双重评估）
│  LocalSandbox    │  · 4a 沙箱执行 testCases（tsx→mock降级）
│  LLMJudge        │  · 4b LLM 4 维度评分（utility/robustness/security/doc）
│                  │  → 输出: SandboxTestResult + LLMJudgeResult（0-10）
└────────┬─────────┘
         │
    ┌────┴─────┐
    │分叉决策   │
    ▼          ▼
草稿安装    企业评审提交
(local/)   (skill_reviews)
    │          │
    └────┬─────┘
         ▼
┌──────────────────┐
│  Stage 5         │  PUBLISH
│  SkillPublisher  │  · 写入 skills/installed/
│                  │  · 更新 skill_catalog 表
│                  │  · 记录 admin_audit_log
│                  │  → 输出: publishPath + catalogEntry
└──────────────────┘
```

## 双段协同架构

```
┌─────────────────────────────────────┐    ┌─────────────────────────────────┐
│     客户端段 (LocalSkillFactory)     │    │  服务端段 (EnterpriseSkillFactory)│
│                                     │    │                                  │
│  Stage 1: SpecBuilder               │    │  重新执行 Stage 3b (安全扫描)     │
│  Stage 2: SkillSynthesizer          │    │  重新执行 Stage 4a (沙箱测试)    │
│  Stage 3: StaticValidator +         │──▶ │  重新执行 Stage 4b (LLM Judge)   │
│           SecurityScanner(内置规则) │    │  排队进入人工评审                │
│  Stage 4: LocalSandboxTester +      │    │  Stage 5: SkillPublisher         │
│           LLMJudge                  │    │  Auto-Curator 每日策展           │
│                                     │    │                                  │
│  submitForReview() → skill_reviews  │    │  approveAndPublish()             │
└─────────────────────────────────────┘    └─────────────────────────────────┘
```

## 关键组件交互

```
LocalSkillFactory
      │
      ├── SpecBuilder ──────────── LLMAdapter (claude-opus / config模型)
      │       └── queryCatalog() ─ 扫描 skills/ 目录 SKILL.md
      │
      ├── SkillSynthesizer ────── LLMAdapter
      │
      ├── StaticValidator ──────── 纯字符串分析，无 I/O
      │
      ├── SecurityScanner
      │       ├── trySemgrep()  ── semgrep CLI (可选)
      │       └── runBuiltinScan() ── 16 条内置正则规则
      │
      ├── LocalSandboxTester
      │       ├── checkTsx() ─── tsx CLI
      │       └── mockResult() ── 降级 mock
      │
      └── LLMJudge ─────────────── LLMAdapter

EnterpriseSkillFactory
      │
      ├── SecurityScanner (同上)
      ├── LocalSandboxTester (同上)
      ├── LLMJudge (同上)
      └── SkillPublisher ───────── DatabaseSync + 文件系统

AutoCurator
      └── skill_catalog + admin_audit_log (每日统计)
```

## 数据库表

| 表名 | 用途 |
|------|------|
| `skill_factory_jobs` | 流水线 Job 状态跟踪 |
| `skill_catalog` | 已发布技能目录 + 策展状态 |
| `skill_reviews` | 人工评审队列（Phase 8 扩展） |
| `admin_audit_log` | 操作审计（Phase 8 已有） |
