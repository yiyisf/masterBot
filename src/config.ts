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

import { registerSecret } from './utils/secret-ref.js';

/**
 * 递归解析环境变量 (并对敏感字段进行 SecretRef 注册)
 */
function resolveEnvVariables(obj: unknown, parentKey?: string): unknown {
    if (typeof obj === 'string') {
        // 匹配 ${VAR_NAME} 或 ${VAR_NAME:default}
        const resolved = obj.replace(/\$\{(\w+)(?::([^}]*))?\}/g, (_, name, defaultValue) => {
            return process.env[name] ?? defaultValue ?? '';
        });

        // 自动将名称中包含 key/token/password/secret 的字段注册为脱敏引用
        if (parentKey && /key|token|password|secret/i.test(parentKey)) {
            return registerSecret(resolved);
        }
        return resolved;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => resolveEnvVariables(item));
    }

    if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = resolveEnvVariables(value, key);
        }
        return result;
    }

    return obj;
}
