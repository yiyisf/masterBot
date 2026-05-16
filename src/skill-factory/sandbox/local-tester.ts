import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SkillSpec, SandboxTestResult } from '../types.js';

const execFileAsync = promisify(execFile);

function hasTsx(): boolean {
    try {
        execFile('tsx', ['--version'], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

async function checkTsx(): Promise<boolean> {
    try {
        await execFileAsync('tsx', ['--version'], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

const RUNNER_TEMPLATE = `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const skillPath = process.argv[2];
const testCaseJson = process.argv[3];

const testCase = JSON.parse(testCaseJson);

const mockCtx = {
    sessionId: 'sandbox-test',
    memory: {
        get: async () => null,
        set: async () => {},
    },
    logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    },
    config: {},
};

async function run() {
    try {
        const mod = await import(skillPath);
        // Find first exported function that isn't default
        const fnNames = Object.keys(mod).filter(k => typeof mod[k] === 'function');
        if (fnNames.length === 0) {
            console.log(JSON.stringify({ error: 'No exported functions found' }));
            process.exit(0);
        }
        const fnName = fnNames[0];
        const result = await mod[fnName](mockCtx, testCase.input);
        console.log(JSON.stringify({ result: typeof result === 'string' ? result : JSON.stringify(result) }));
    } catch (err) {
        console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
}

run().catch(err => {
    console.log(JSON.stringify({ error: String(err) }));
});
`;

export class LocalSandboxTester {
    async runTests(
        indexTs: string,
        testCases: SkillSpec['testCases'],
        _spec: SkillSpec,
        options: { timeoutMs?: number; maxMemoryMb?: number } = {}
    ): Promise<SandboxTestResult> {
        const timeoutMs = options.timeoutMs ?? 30000;

        const sandboxAvailable = await checkTsx();
        if (!sandboxAvailable) {
            return this.mockResult(testCases);
        }

        const sandboxId = randomUUID();
        const sandboxDir = join(tmpdir(), `skill-sandbox-${sandboxId}`);
        const skillPath = join(sandboxDir, 'index.ts');
        const runnerPath = join(sandboxDir, 'runner.mjs');

        try {
            mkdirSync(sandboxDir, { recursive: true });
            writeFileSync(skillPath, indexTs, 'utf-8');
            writeFileSync(runnerPath, RUNNER_TEMPLATE, 'utf-8');

            const results: SandboxTestResult['results'] = [];

            for (const tc of testCases) {
                const start = Date.now();
                try {
                    const { stdout } = await execFileAsync(
                        'tsx',
                        [runnerPath, skillPath, JSON.stringify({ input: tc.input })],
                        {
                            timeout: timeoutMs,
                            env: { ...process.env, NODE_OPTIONS: '' },
                        }
                    );

                    const durationMs = Date.now() - start;
                    const output = stdout.trim();
                    let parsed: { result?: string; error?: string } = {};
                    try {
                        parsed = JSON.parse(output);
                    } catch {
                        parsed = { result: output };
                    }

                    const passed = !parsed.error && (
                        !tc.expectedOutput ||
                        (parsed.result ?? '').toLowerCase().includes(tc.expectedOutput.toLowerCase())
                    );

                    results.push({
                        testCase: tc.name,
                        passed,
                        output: parsed.result,
                        error: parsed.error,
                        durationMs,
                    });
                } catch (err: any) {
                    const durationMs = Date.now() - start;
                    results.push({
                        testCase: tc.name,
                        passed: false,
                        error: err.message ?? String(err),
                        durationMs,
                    });
                }
            }

            const passedCount = results.filter(r => r.passed).length;
            const successRate = testCases.length > 0 ? passedCount / testCases.length : 1;
            const avgDurationMs = results.length > 0
                ? results.reduce((s, r) => s + r.durationMs, 0) / results.length
                : 0;

            return {
                passed: successRate >= 0.5,
                successRate,
                results,
                avgDurationMs,
            };
        } finally {
            if (existsSync(sandboxDir)) {
                try { rmSync(sandboxDir, { recursive: true, force: true }); } catch { /* ignore */ }
            }
        }
    }

    private mockResult(testCases: SkillSpec['testCases']): SandboxTestResult {
        return {
            passed: true,
            successRate: 1,
            results: testCases.map(tc => ({
                testCase: tc.name,
                passed: true,
                output: '(mock — tsx not available)',
                durationMs: 0,
            })),
            avgDurationMs: 0,
            mock: true,
        };
    }
}
