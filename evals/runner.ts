#!/usr/bin/env tsx
/**
 * 离线评测运行器（U3）
 *
 * 用法：
 *   npm run eval                           # 运行所有 evals/tasks/*.yaml
 *   npm run eval -- --file basic-reasoning # 运行指定任务集
 *   npm run eval -- --task capital-city    # 运行单个任务
 *
 * 退出码：0 = 全部通过，1 = 有失败项
 *
 * 依赖环境变量（与主应用相同）：
 *   OPENAI_API_KEY / ANTHROPIC_API_KEY + OPENAI_BASE_URL 等
 */

import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { parse as parseYaml } from 'yaml';
import { nanoid } from 'nanoid';

import { loadConfig } from '../src/config.js';
import { llmFactory } from '../src/llm/index.js';
import { SkillRegistry } from '../src/skills/registry.js';
import { Agent } from '../src/core/agent.js';
import { LongTermMemory } from '../src/memory/long-term.js';
import type { ExecutionStep } from '../src/types.js';
import { runAssertions, type AssertionSpec, type EvalTrajectory } from './assertions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(__dirname, 'tasks');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fileFilter = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const taskFilter = args.includes('--task') ? args[args.indexOf('--task') + 1] : null;
const verbose = args.includes('--verbose') || args.includes('-v');

// ── Types ─────────────────────────────────────────────────────────────────────
interface TaskSpec {
    id: string;
    description: string;
    input: string;
    assertions: AssertionSpec[];
    maxIterations?: number;
    timeoutMs?: number;
}

interface TaskFile {
    name: string;
    description: string;
    version: string;
    tasks: TaskSpec[];
}

interface TaskResult {
    taskId: string;
    description: string;
    passed: boolean;
    assertions: Array<{ type: string; passed: boolean; message: string }>;
    output: string;
    toolsCalled: string[];
    iterations: number;
    durationMs: number;
    error?: string;
}

// ── Loader ────────────────────────────────────────────────────────────────────
function loadTaskFiles(): Array<{ file: string; spec: TaskFile }> {
    const files = readdirSync(TASKS_DIR)
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        .filter(f => !fileFilter || f.replace(/\.(yaml|yml)$/, '') === fileFilter);

    return files.map(f => ({
        file: f,
        spec: parseYaml(readFileSync(join(TASKS_DIR, f), 'utf-8')) as TaskFile,
    }));
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function runTask(
    task: TaskSpec,
    agent: Agent,
    timeoutMs = 60_000
): Promise<Omit<TaskResult, 'taskId' | 'description'>> {
    const start = Date.now();
    const toolsCalled: string[] = [];
    let output = '';
    let iterations = 0;
    let error: string | undefined;

    const sessionId = `eval-${nanoid(8)}`;
    const memory = new LongTermMemory({
        db: new DatabaseSync(':memory:'),
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    memory.initialize();

    try {
        const timeoutController = new AbortController();
        const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

        const gen = agent.run(task.input, {
            sessionId,
            memory,
            history: [],
            abortSignal: timeoutController.signal,
        });

        for await (const step of gen as AsyncGenerator<ExecutionStep>) {
            if (step.type === 'content') {
                output += step.content ?? '';
            } else if (step.type === 'answer') {
                output = step.content ?? output;
            } else if (step.type === 'action') {
                const toolName = (step as any).toolName ?? (step as any).action ?? '';
                if (toolName) toolsCalled.push(toolName);
                iterations++;
            }
        }

        clearTimeout(timer);
    } catch (err: any) {
        error = err?.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err.message;
    }

    const assertionResults = runAssertions(
        { output, toolsCalled, iterations } as EvalTrajectory,
        task.assertions
    );

    return {
        passed: !error && assertionResults.every(a => a.passed),
        assertions: assertionResults,
        output: output.slice(0, 500),
        toolsCalled,
        iterations,
        durationMs: Date.now() - start,
        ...(error ? { error } : {}),
    };
}

// ── Report ────────────────────────────────────────────────────────────────────
function printReport(allResults: Array<{ file: string; results: TaskResult[] }>) {
    const totalTasks = allResults.reduce((s, f) => s + f.results.length, 0);
    const totalPassed = allResults.reduce((s, f) => s + f.results.filter(r => r.passed).length, 0);

    console.log('\n' + '═'.repeat(70));
    console.log('  EVAL RESULTS');
    console.log('═'.repeat(70));

    for (const { file, results } of allResults) {
        const passed = results.filter(r => r.passed).length;
        const status = passed === results.length ? '✓' : '✗';
        console.log(`\n${status} ${file}  (${passed}/${results.length})`);

        for (const r of results) {
            const icon = r.passed ? '  ✓' : '  ✗';
            const dur = `${r.durationMs}ms`;
            console.log(`${icon} [${r.taskId}] ${r.description}  (${dur})`);

            if (!r.passed || verbose) {
                for (const a of r.assertions) {
                    const aIcon = a.passed ? '    ✓' : '    ✗';
                    console.log(`${aIcon} ${a.type}: ${a.message}`);
                }
                if (r.error) {
                    console.log(`    ⚠ Error: ${r.error}`);
                }
                if (verbose && r.output) {
                    console.log(`    Output: ${r.output.slice(0, 200)}...`);
                }
                if (verbose && r.toolsCalled.length > 0) {
                    console.log(`    Tools called: [${r.toolsCalled.join(', ')}]`);
                }
            }
        }
    }

    console.log('\n' + '─'.repeat(70));
    const pct = totalTasks > 0 ? Math.round((totalPassed / totalTasks) * 100) : 0;
    const summary = `${totalPassed}/${totalTasks} tasks passed (${pct}%)`;
    if (totalPassed === totalTasks) {
        console.log(`  ✓ ALL PASSED: ${summary}`);
    } else {
        console.log(`  ✗ FAILURES: ${summary}`);
    }
    console.log('═'.repeat(70) + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('[eval] Loading config...');
    const config = await loadConfig();

    // 创建哑 logger（避免污染评测输出）
    const logger = verbose
        ? console as any
        : { debug: () => {}, info: () => {}, warn: (m: string) => console.warn(m), error: (m: string) => console.error(m) };

    // 最小化 SkillRegistry（不加载真实技能，防止外部副作用）
    const skillRegistry = new SkillRegistry(logger);

    const getLlm = () => {
        const provider = config.models.default;
        return llmFactory.getAdapter(provider, config.models.providers[provider]);
    };

    const agent = new Agent({
        llm: getLlm,
        skillRegistry,
        logger,
        maxIterations: 10,
    });

    const taskFiles = loadTaskFiles();
    if (taskFiles.length === 0) {
        console.error('[eval] No task files found.');
        process.exit(1);
    }

    const allResults: Array<{ file: string; results: TaskResult[] }> = [];

    for (const { file, spec } of taskFiles) {
        console.log(`\n[eval] Running: ${spec.name} (${file})`);
        const results: TaskResult[] = [];

        const tasks = taskFilter
            ? spec.tasks.filter(t => t.id === taskFilter)
            : spec.tasks;

        for (const task of tasks) {
            process.stdout.write(`  → ${task.id}... `);
            const result = await runTask(task, agent, task.timeoutMs ?? 60_000);
            const taskResult: TaskResult = {
                taskId: task.id,
                description: task.description,
                ...result,
            };
            results.push(taskResult);
            console.log(taskResult.passed ? 'PASS' : `FAIL (${result.error ?? 'assertions'})`);
        }

        allResults.push({ file, results });
    }

    printReport(allResults);

    const hasFailures = allResults.some(f => f.results.some(r => !r.passed));
    process.exit(hasFailures ? 1 : 0);
}

main().catch(err => {
    console.error('[eval] Fatal error:', err);
    process.exit(1);
});
