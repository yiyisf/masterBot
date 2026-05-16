import type { SkillSpec, ValidationResult } from '../types.js';

const HARDCODED_KEY_PATTERNS = [
    /sk-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /(?:sk|pk|api|key)[_-]?(?:secret|token|key)\s*=\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
    /ghp_[A-Za-z0-9]{36}/,
    /xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+/,
    /Bearer\s+[A-Za-z0-9_-]{32,}/,
];

const KEBAB_CASE_RE = /^[a-z][a-z0-9-]*$/;

export class StaticValidator {
    validate(
        files: { skillMd: string; indexTs: string; testTs: string },
        spec: SkillSpec
    ): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // File emptiness
        if (!files.skillMd || files.skillMd.trim().length === 0) errors.push('SKILL.md 不能为空');
        if (!files.indexTs || files.indexTs.trim().length === 0) errors.push('index.ts 不能为空');
        if (!files.testTs || files.testTs.trim().length === 0) warnings.push('unit.test.ts 为空，建议补充测试');

        // SKILL.md frontmatter
        const frontmatterMatch = files.skillMd.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            errors.push('SKILL.md 缺少 YAML frontmatter (--- ... ---)');
        } else {
            const fm = frontmatterMatch[1];
            const requiredFields = ['name', 'version', 'description', 'author'];
            for (const field of requiredFields) {
                if (!new RegExp(`^${field}:`, 'm').test(fm)) {
                    errors.push(`SKILL.md frontmatter 缺少字段: ${field}`);
                }
            }

            // skill name kebab-case
            const nameMatch = fm.match(/^name:\s*(.+)$/m);
            if (nameMatch) {
                const skillName = nameMatch[1].trim();
                if (!KEBAB_CASE_RE.test(skillName)) {
                    errors.push(`skill name "${skillName}" 不符合 kebab-case 格式 (^[a-z][a-z0-9-]*$)`);
                }
                if (skillName !== spec.name) {
                    errors.push(`SKILL.md name "${skillName}" 与 spec.name "${spec.name}" 不一致`);
                }
            }
        }

        // index.ts — each spec action should have export function
        const actionNames = Object.keys(spec.inputs).length > 0
            ? [spec.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
            : [];

        // Check export functions exist — look for any "export async function" or "export function"
        const exportCount = (files.indexTs.match(/export\s+(?:async\s+)?function\s+\w+/g) || []).length;
        if (exportCount === 0) {
            errors.push('index.ts 中未找到任何导出函数 (export [async] function)');
        }

        // Hardcoded keys check
        for (const pattern of HARDCODED_KEY_PATTERNS) {
            if (pattern.test(files.indexTs)) {
                errors.push(`index.ts 疑似包含硬编码密钥，匹配规则: ${pattern.source.substring(0, 40)}...`);
                break;
            }
        }

        // testTs should reference spec testCase names if not empty
        if (files.testTs && files.testTs.trim().length > 0) {
            if (!files.testTs.includes('describe') && !files.testTs.includes('it(') && !files.testTs.includes('test(')) {
                warnings.push('unit.test.ts 未发现 describe/it/test 测试块');
            }
        }

        return {
            passed: errors.length === 0,
            warnings,
            errors,
        };
    }
}
