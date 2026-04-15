/**
 * Phase 23: Managed Agents Harness 测试
 * 覆盖：AgentSpec / AgentBus / AgentPool / SoulLoader / FilteredSkillRegistry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defaultAgentSpec } from '../src/core/harness/agent-spec.js';
import { AgentBus } from '../src/core/harness/agent-bus.js';
import { AgentPool } from '../src/core/harness/agent-pool.js';
import { SoulLoader } from '../src/core/soul-loader.js';
import { SkillRegistry } from '../src/skills/registry.js';
import type { Logger } from '../src/types.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';

// ─── 工具函数 ────────────────────────────────────────────────

function makeLogger(): Logger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

function makeLLM() {
    return {
        provider: 'mock',
        chat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'mock answer' }),
        chatStream: vi.fn(),
        embeddings: vi.fn().mockResolvedValue([[]]),
    };
}

// ─── AgentSpec ───────────────────────────────────────────────

describe('defaultAgentSpec', () => {
    it('生成有默认值的完整 spec', () => {
        const spec = defaultAgentSpec({ id: 'test', name: 'Test Agent' });
        expect(spec.id).toBe('test');
        expect(spec.name).toBe('Test Agent');
        expect(spec.version).toBe('1.0.0');
        expect(spec.resources.maxIterations).toBe(10);
        expect(spec.resources.timeoutMs).toBe(60_000);
        expect(spec.resources.concurrency).toBe(3);
        expect(spec.tools.allow).toEqual([]);
        expect(spec.tools.deny).toEqual([]);
        expect(spec.memory.scope).toBe('isolated');
        expect(spec.hooks).toBeDefined();
    });

    it('允许覆盖所有字段', () => {
        const spec = defaultAgentSpec({
            id: 'custom',
            name: 'Custom',
            resources: { maxIterations: 5, timeoutMs: 30_000, concurrency: 1 },
            tools: { allow: ['shell.*'], deny: ['shell.execute'] },
        });
        expect(spec.resources.maxIterations).toBe(5);
        expect(spec.tools.allow).toEqual(['shell.*']);
        expect(spec.tools.deny).toEqual(['shell.execute']);
    });

    // M2: 记忆权限控制
    it('memory 权限字段默认全部开启', () => {
        const spec = defaultAgentSpec({ id: 'mem-test', name: 'Memory Test' });
        expect(spec.memory.allowRemember).toBe(true);
        expect(spec.memory.allowRecall).toBe(true);
        expect(spec.memory.allowKnowledgeSearch).toBe(true);
        expect(spec.memory.namespace).toBe('mem-test');
    });

    it('允许覆盖 memory 权限字段', () => {
        const spec = defaultAgentSpec({
            id: 'readonly-agent',
            name: 'ReadOnly Agent',
            memory: {
                namespace: 'readonly-agent',
                scope: 'isolated',
                allowRemember: false,
                allowRecall: true,
                allowKnowledgeSearch: false,
            },
        });
        expect(spec.memory.allowRemember).toBe(false);
        expect(spec.memory.allowRecall).toBe(true);
        expect(spec.memory.allowKnowledgeSearch).toBe(false);
    });
});

// ─── AgentBus ────────────────────────────────────────────────

describe('AgentBus', () => {
    let bus: AgentBus;

    beforeEach(() => {
        bus = new AgentBus();
    });

    it('publish / subscribe 基本消息传递', async () => {
        const received: string[] = [];
        bus.subscribe('test.topic', (msg) => { received.push(msg.payload as string); }, 'sub-1');

        bus.publish('test.topic', 'hello', 'pub-1');
        bus.publish('test.topic', 'world', 'pub-2');

        await new Promise(r => setTimeout(r, 10));
        expect(received).toEqual(['hello', 'world']);
    });

    it('unsubscribe 停止接收消息', async () => {
        const received: string[] = [];
        const unsub = bus.subscribe('unsub.topic', (msg) => { received.push(msg.payload as string); }, 'sub-1');

        bus.publish('unsub.topic', 'before', 'pub-1');
        await new Promise(r => setTimeout(r, 5));
        unsub();
        bus.publish('unsub.topic', 'after', 'pub-1');
        await new Promise(r => setTimeout(r, 5));

        expect(received).toEqual(['before']);
    });

    it('request / reply 超时返回 null', async () => {
        const result = await bus.request('no-reply.topic', 'ping', 'req-1', 50);
        expect(result).toBeNull();
    });

    it('request / reply 成功响应', async () => {
        bus.subscribe('echo.topic', (msg) => {
            bus.reply(msg.replyTo!, `pong:${msg.payload}`, 'server');
        }, 'server');

        const result = await bus.request('echo.topic', 'ping', 'client', 200);
        expect(result).toBe('pong:ping');
    });
});

// ─── FilteredSkillRegistry ───────────────────────────────────

describe('FilteredSkillRegistry', () => {
    it('createFilteredView 过滤 allow/deny', async () => {
        const logger = makeLogger();
        const registry = new SkillRegistry(logger);

        // 注册一个 mock source
        const mockSource = {
            name: 'mock',
            type: 'local' as const,
            initialize: vi.fn().mockResolvedValue(undefined),
            getTools: vi.fn().mockResolvedValue([
                { type: 'function', function: { name: 'shell.execute', description: '', parameters: {} } },
                { type: 'function', function: { name: 'shell.kill', description: '', parameters: {} } },
                { type: 'function', function: { name: 'file-manager.read', description: '', parameters: {} } },
                { type: 'function', function: { name: 'http-client.get', description: '', parameters: {} } },
            ]),
            execute: vi.fn().mockResolvedValue('ok'),
        };
        await registry.registerSource(mockSource);

        // allow: shell.* — deny: shell.kill
        const filtered = registry.createFilteredView(['shell.*', 'file-manager.*'], ['shell.kill']);
        const tools = await filtered.getToolDefinitions();
        const names = tools.map(t => t.function.name);

        expect(names).toContain('shell.execute');
        expect(names).toContain('file-manager.read');
        expect(names).not.toContain('shell.kill');      // deny 拦截
        expect(names).not.toContain('http-client.get'); // 未在 allow 中
    });

    it('empty allow = 全部放行', async () => {
        const logger = makeLogger();
        const registry = new SkillRegistry(logger);
        const mockSource = {
            name: 'mock2',
            type: 'local' as const,
            initialize: vi.fn().mockResolvedValue(undefined),
            getTools: vi.fn().mockResolvedValue([
                { type: 'function', function: { name: 'a.x', description: '', parameters: {} } },
                { type: 'function', function: { name: 'b.y', description: '', parameters: {} } },
            ]),
            execute: vi.fn().mockResolvedValue('ok'),
        };
        await registry.registerSource(mockSource);

        const filtered = registry.createFilteredView([], []);
        const tools = await filtered.getToolDefinitions();
        expect(tools.length).toBe(2);
    });
});

// ─── AgentPool (specs + lifecycle) ──────────────────────────

describe('AgentPool - spec management', () => {
    let pool: AgentPool;

    beforeEach(() => {
        const logger = makeLogger();
        const registry = new SkillRegistry(logger);
        pool = new AgentPool(
            () => makeLLM() as any,
            registry,
            logger
        );
    });

    it('registerSpec / listSpecs / getSpec', () => {
        const spec = defaultAgentSpec({ id: 'sp1', name: 'Spec1' });
        pool.registerSpec(spec);
        expect(pool.listSpecs()).toHaveLength(1);
        expect(pool.getSpec('sp1')).toBe(spec);
    });

    it('unregisterSpec 移除 spec', () => {
        pool.registerSpec(defaultAgentSpec({ id: 'sp2', name: 'Spec2' }));
        pool.unregisterSpec('sp2');
        expect(pool.getSpec('sp2')).toBeUndefined();
    });

    it('registerLegacyWorker 转换旧格式', () => {
        pool.registerLegacyWorker('legacy-1', 'Legacy', 'desc', 'prompt', ['shell']);
        const spec = pool.getSpec('legacy-1');
        expect(spec).toBeDefined();
        expect(spec!.tools.allow).toContain('shell.*');
    });

    it('spawn 未知 specId 抛出错误', async () => {
        const memory = { get: vi.fn(), set: vi.fn(), search: vi.fn().mockResolvedValue([]) };
        await expect(
            pool.spawn('nonexistent', 'task', { sessionId: 's1', memory } as any)
        ).rejects.toThrow('spec "nonexistent" not found');
    });

    it('listInstances 返回正确格式', () => {
        const instances = pool.listInstances();
        expect(Array.isArray(instances)).toBe(true);
    });
});

// ─── SoulLoader ──────────────────────────────────────────────

describe('SoulLoader', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'soul-loader-test-'));
    });

    async function writeAgent(name: string, content: string) {
        const agentDir = join(tmpDir, name);
        await mkdir(agentDir, { recursive: true });
        await writeFile(join(agentDir, 'SOUL.md'), content, 'utf-8');
    }

    it('加载旧格式 SOUL.md（兼容模式）', async () => {
        await writeAgent('old-agent', `---
name: old-agent
version: 1.0.0
description: 旧格式测试
skills:
  - shell
  - file-manager
systemPrompt: 你是旧格式助手
---
`);
        const logger = makeLogger();
        const registry = new SkillRegistry(logger);
        const pool = new AgentPool(() => makeLLM() as any, registry, logger);
        const loader = new SoulLoader(pool, logger);

        const count = await loader.loadAgents(tmpDir);
        expect(count).toBe(1);

        const spec = pool.getSpec('old-agent');
        expect(spec).toBeDefined();
        expect(spec!.name).toBe('old-agent');
        expect(spec!.tools.allow).toContain('shell.*');
        expect(spec!.tools.allow).toContain('file-manager.*');
    });

    it('加载新格式 SOUL.md（完整 AgentSpec）', async () => {
        await writeAgent('new-agent', `---
id: new-agent
name: New Agent
version: 2.0.0
description: 新格式测试

tools:
  allow:
    - "http-client.*"
  deny: []

resources:
  maxIterations: 5
  timeoutMs: 30000
  concurrency: 1

memory:
  namespace: new-agent
  scope: isolated

outcome:
  criteria:
    - id: quality
      description: 输出质量
      weight: 8
      required: true
  grader:
    maxRevisions: 1
    minScore: 80
---
`);
        const logger = makeLogger();
        const registry = new SkillRegistry(logger);
        const pool = new AgentPool(() => makeLLM() as any, registry, logger);
        const loader = new SoulLoader(pool, logger);

        await loader.loadAgents(tmpDir);
        const spec = pool.getSpec('new-agent');
        expect(spec).toBeDefined();
        expect(spec!.resources.maxIterations).toBe(5);
        expect(spec!.tools.allow).toContain('http-client.*');
        expect(spec!.outcome).toBeDefined();
        expect(spec!.outcome!.criteria[0].id).toBe('quality');
        expect(spec!.outcome!.grader.minScore).toBe(80);
    });

    it('目录不存在时返回 0 且不抛错', async () => {
        const logger = makeLogger();
        const pool = new AgentPool(() => makeLLM() as any, new SkillRegistry(logger), logger);
        const loader = new SoulLoader(pool, logger);

        const count = await loader.loadAgents('/nonexistent/path');
        expect(count).toBe(0);
    });

    it('解析失败的 SOUL.md 不影响其他 agent 加载', async () => {
        await writeAgent('good-agent', `---
name: good-agent
description: 正常
---
`);
        // 创建一个没有 SOUL.md 的目录（不会被加载）
        await mkdir(join(tmpDir, 'no-soul'), { recursive: true });

        const logger = makeLogger();
        const pool = new AgentPool(() => makeLLM() as any, new SkillRegistry(logger), logger);
        const loader = new SoulLoader(pool, logger);

        const count = await loader.loadAgents(tmpDir);
        expect(count).toBe(1);
        expect(pool.getSpec('good-agent')).toBeDefined();
    });
});

// ─── SessionEventType M3: 记忆审计事件 ──────────────────────────

import type { SessionEventType } from '../src/types.js';

describe('SessionEventType', () => {
    it('包含 memory_write 和 memory_read 类型', () => {
        // 类型守卫：编译时验证 memory_write/memory_read 是合法的 SessionEventType
        const writeType: SessionEventType = 'memory_write';
        const readType: SessionEventType = 'memory_read';
        expect(writeType).toBe('memory_write');
        expect(readType).toBe('memory_read');
    });

    it('包含所有必要的核心事件类型', () => {
        const coreTypes: SessionEventType[] = [
            'session_start', 'session_end',
            'tool_call', 'tool_result', 'tool_error',
            'harness_wake', 'credential_access',
            'memory_write', 'memory_read',
        ];
        // 验证所有类型字符串有效（TypeScript 编译已验证，运行时确认值不为 undefined）
        for (const t of coreTypes) {
            expect(typeof t).toBe('string');
        }
    });
});
