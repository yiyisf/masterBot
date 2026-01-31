import { readFile } from 'fs/promises';
import { resolve } from 'path';
import YAML from 'yaml';
import type { Config } from './types.js';

/**
 * 加载配置文件
 */
export async function loadConfig(configPath?: string): Promise<Config> {
    const path = configPath || resolve(process.cwd(), 'config/default.yaml');
    const content = await readFile(path, 'utf-8');
    const rawConfig = YAML.parse(content);

    // 替换环境变量
    return resolveEnvVariables(rawConfig) as Config;
}

/**
 * 递归解析环境变量
 */
function resolveEnvVariables(obj: unknown): unknown {
    if (typeof obj === 'string') {
        // 匹配 ${VAR_NAME} 或 ${VAR_NAME:default}
        return obj.replace(/\$\{(\w+)(?::([^}]*))?\}/g, (_, name, defaultValue) => {
            return process.env[name] ?? defaultValue ?? '';
        });
    }

    if (Array.isArray(obj)) {
        return obj.map(resolveEnvVariables);
    }

    if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = resolveEnvVariables(value);
        }
        return result;
    }

    return obj;
}
