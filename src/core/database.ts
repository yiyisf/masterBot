import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '../../');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'cmaster.db');

/**
 * 数据库初始化与管理
 */
export function initDatabase(): DatabaseSync {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }

    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');

    // 创建表结构
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_pinned BOOLEAN DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            tool_call_id TEXT,
            tool_calls TEXT, -- JSON string
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            name TEXT,
            type TEXT,
            url TEXT,
            base64 TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            dependencies TEXT DEFAULT '[]',
            result TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);

        CREATE TABLE IF NOT EXISTS feedback (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            rating TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_feedback_message ON feedback(message_id);

        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            cron_expr TEXT NOT NULL,
            prompt TEXT NOT NULL,
            session_id TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_run TEXT,
            next_run TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);

        CREATE TABLE IF NOT EXISTS knowledge_nodes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL DEFAULT 'document',
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            embedding TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type ON knowledge_nodes(type);

        CREATE TABLE IF NOT EXISTS knowledge_edges (
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            relation TEXT NOT NULL,
            weight REAL NOT NULL DEFAULT 1.0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (from_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
            FOREIGN KEY (to_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_edges_from ON knowledge_edges(from_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_edges_to ON knowledge_edges(to_id);

        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            definition TEXT NOT NULL,
            created_by TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS webhooks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            secret TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            description TEXT,
            created_at TEXT NOT NULL,
            last_triggered_at TEXT,
            trigger_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS token_usage (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL DEFAULT 'openai',
            model TEXT NOT NULL,
            session_id TEXT,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at);
        CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);

        CREATE TABLE IF NOT EXISTS improvement_events (
            id TEXT PRIMARY KEY,
            trigger TEXT NOT NULL,
            session_id TEXT,
            analysis TEXT,
            action TEXT NOT NULL,
            skill_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_improvement_events_created ON improvement_events(created_at);

        CREATE TABLE IF NOT EXISTS prompt_templates (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            prompt TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'general',
            is_builtin INTEGER NOT NULL DEFAULT 0,
            use_count INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates(category);
    `);

    // Auto-migration for existing databases
    try {
        db.prepare('ALTER TABLE sessions ADD COLUMN is_pinned BOOLEAN DEFAULT 0').run();
    } catch (error: any) {
        // Ignore error if column already exists
        if (!error.message.includes('duplicate column name')) {
            // Log but don't crash if it's another error, though for this simple setup it's fine
        }
    }

    // Seed built-in prompt templates (idempotent via INSERT OR IGNORE)
    const builtinTemplates = [
        // HR 类
        { id: 'builtin-hr-01', title: '查询薪资构成', description: '了解当月薪资明细', prompt: '请查询我本月的薪资构成，包括基本工资、绩效奖金、各项扣款明细', category: 'HR' },
        { id: 'builtin-hr-02', title: '申请调岗流程', description: '发起部门内调岗申请', prompt: '我想申请调岗，请帮我了解调岗流程并起草一份调岗申请书', category: 'HR' },
        { id: 'builtin-hr-03', title: '生成绩效摘要', description: '整理本季度工作绩效', prompt: '请帮我整理本季度的工作绩效摘要，包括目标完成情况、主要成果和改进方向', category: 'HR' },
        { id: 'builtin-hr-04', title: '查询假期余额', description: '查看年假、调休等余额', prompt: '查询我当前的年假余额、调休余额以及本年度已休假记录', category: 'HR' },
        // 数据 类
        { id: 'builtin-data-01', title: '生成销售周报', description: '自动汇总本周销售数据', prompt: '查询本周各产品线的销售数据，生成包含对比分析和趋势图的周报', category: '数据' },
        { id: 'builtin-data-02', title: 'NL2SQL 数据查询', description: '自然语言转SQL查询', prompt: '用自然语言描述你的查询需求，我将转为SQL并返回结果，例如：查询上月华东区订单金额排名前10的客户', category: '数据' },
        { id: 'builtin-data-03', title: '异常数据标记', description: '识别数据中的异常点', prompt: '分析指定数据集中的异常数据，标记离群值并给出可能的原因分析', category: '数据' },
        { id: 'builtin-data-04', title: '生成数据可视化', description: '将数据转为图表', prompt: '根据提供的数据生成合适的可视化图表，并解读关键发现', category: '数据' },
        // 运维 类
        { id: 'builtin-ops-01', title: '日志异常分析', description: '分析应用日志中的错误', prompt: '分析最近1小时的应用日志，找出高频错误、异常堆栈，并给出修复建议', category: '运维' },
        { id: 'builtin-ops-02', title: '告警根因推断', description: '定位监控告警的根本原因', prompt: '根据以下告警信息推断根本原因并给出处理方案：[粘贴告警内容]', category: '运维' },
        { id: 'builtin-ops-03', title: '容量趋势预测', description: '预测资源使用趋势', prompt: '基于历史资源使用数据，预测未来30天的容量趋势，并给出扩容建议', category: '运维' },
        // 文档 类
        { id: 'builtin-doc-01', title: '合同关键条款提取', description: '从合同中提取重要条款', prompt: '请分析上传的合同文件，提取关键条款（交付物、付款条件、违约责任）和潜在风险点', category: '文档' },
        { id: 'builtin-doc-02', title: '会议纪要整理', description: '将会议内容转为结构化纪要', prompt: '将以下会议录音/记录整理成标准格式的会议纪要，包括决策事项、行动项和责任人：[粘贴内容]', category: '文档' },
        { id: 'builtin-doc-03', title: '技术方案评审', description: '评审技术设计方案', prompt: '请评审以下技术方案，从可行性、风险、成本和时间维度给出评价和改进建议', category: '文档' },
        { id: 'builtin-doc-04', title: 'Excel数据分析', description: '分析上传的Excel文件', prompt: '请分析我上传的Excel文件，提取关键指标、发现数据规律，并生成分析报告', category: '文档' },
        // 流程 类
        { id: 'builtin-proc-01', title: '采购申请起草', description: '起草标准采购申请', prompt: '帮我起草一份采购申请，物品：[填写]，数量：[填写]，预算：[填写]，用途：[填写]', category: '流程' },
        { id: 'builtin-proc-02', title: '报销单审核', description: '审核报销单据合规性', prompt: '请审核以下报销单据，检查是否符合公司财务规定，标注需要补充的材料', category: '流程' },
        { id: 'builtin-proc-03', title: '项目周报生成', description: '自动生成项目周报', prompt: '基于本周工作内容生成项目周报，包括进度更新、风险提示和下周计划：[粘贴本周工作记录]', category: '流程' },
        { id: 'builtin-proc-04', title: '自动生成新技能', description: '让AI学习新技能', prompt: '帮我生成一个新的AI技能，描述：[填写你想要的技能功能]', category: '流程' },
        { id: 'builtin-proc-05', title: '了解全部能力', description: '探索CMaster Bot能力', prompt: '详细介绍你能帮企业员工做哪些事，每项给出具体示例，包括数据查询、知识检索、流程自动化等方面', category: '流程' },
    ];

    const insertTemplate = db.prepare(
        'INSERT OR IGNORE INTO prompt_templates (id, title, description, prompt, category, is_builtin) VALUES (?, ?, ?, ?, ?, 1)'
    );
    for (const t of builtinTemplates) {
        insertTemplate.run(t.id, t.title, t.description, t.prompt, t.category);
    }

    return db;
}

export const db: DatabaseSync = initDatabase();
