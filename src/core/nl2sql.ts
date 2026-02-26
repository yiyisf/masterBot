import type { LLMAdapter, Logger } from '../types.js';

export interface TableSchema {
    tableName: string;
    columns: Array<{
        name: string;
        type: string;
        nullable?: boolean;
        comment?: string;
    }>;
}

export interface NL2SQLResult {
    sql: string;
    explanation: string;
    echartsConfig?: Record<string, unknown>;
    suggestedChartType?: 'bar' | 'line' | 'pie' | 'scatter' | 'table';
}

/**
 * Schema-Aware NL2SQL: converts natural language to safe SQL
 * with optional ECharts config generation for visualization.
 */
export class NL2SQL {
    private llm: LLMAdapter;
    private logger: Logger;

    constructor(llm: LLMAdapter, logger: Logger) {
        this.llm = llm;
        this.logger = logger;
    }

    /**
     * Generate SQL from natural language query given table schemas
     */
    async generateSQL(
        query: string,
        schemas: TableSchema[],
        opts?: { maxRows?: number }
    ): Promise<NL2SQLResult> {
        const { maxRows = 1000 } = opts || {};

        const schemaContext = schemas.map(s => {
            const cols = s.columns.map(c =>
                `  - ${c.name} (${c.type})${c.comment ? ': ' + c.comment : ''}`
            ).join('\n');
            return `Table: ${s.tableName}\nColumns:\n${cols}`;
        }).join('\n\n');

        const prompt = `你是一个数据分析助手，需要将自然语言问题转换为安全的 SQL 查询。

## 数据库 Schema
${schemaContext}

## 安全规则
- 只生成 SELECT 查询（不允许 INSERT/UPDATE/DELETE/DROP）
- 添加适当的 LIMIT（最大 ${maxRows} 行）
- 不访问可能含敏感信息的字段（phone、id_card、password 等）

## 用户问题
${query}

请以 JSON 格式返回：
{
  "sql": "SELECT ...",
  "explanation": "查询说明：...",
  "suggestedChartType": "bar|line|pie|scatter|table",
  "echartsConfig": {
    "title": { "text": "..." },
    "xAxis": { "type": "category", "data": ["{{x_field}}"] },
    "yAxis": { "type": "value" },
    "series": [{ "type": "bar", "data": ["{{y_field}}"] }]
  }
}

注意：echartsConfig 中用 {{field_name}} 表示从查询结果中提取的字段名。如果是纯数据查询不需要图表，echartsConfig 可以省略。`;

        this.logger.info(`[NL2SQL] Generating SQL for: ${query.substring(0, 100)}`);

        const response = await this.llm.chat([{ role: 'user', content: prompt }]);
        const content = typeof response.content === 'string' ? response.content : '';

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('NL2SQL: LLM did not return valid JSON');
        }

        const result = JSON.parse(jsonMatch[0]) as NL2SQLResult;
        return result;
    }

    /**
     * Fill ECharts config template with actual query results
     */
    fillEChartsConfig(
        config: Record<string, unknown>,
        rows: Record<string, unknown>[]
    ): Record<string, unknown> {
        if (!rows.length) return config;

        const filled = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
        const configStr = JSON.stringify(filled);

        // Find field placeholder patterns like {{field_name}}
        const placeholders = [...configStr.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);

        if (placeholders.length === 0) return filled;

        // Build replacement map
        const replacements: Record<string, unknown[]> = {};
        for (const field of placeholders) {
            replacements[field] = rows.map(r => r[field] ?? '');
        }

        const filledStr = configStr.replace(/"\{\{(\w+)\}\}"/g, (_: string, field: string) => {
            return JSON.stringify(replacements[field] || []);
        }).replace(/\{\{(\w+)\}\}/g, (_: string, field: string) => {
            const vals = replacements[field];
            return vals ? JSON.stringify(vals) : '[]';
        });

        return JSON.parse(filledStr);
    }
}
