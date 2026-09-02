import { spawn } from 'node:child_process';
import type {
  SafeToolSummary,
  ToolProvider,
  ToolProviderRequest,
  ToolProviderResult,
} from './types.js';

const MAX_PROTOCOL_BYTES = 64 * 1024;
const fixtureHostProgram = String.raw`
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  if (request.input && request.input.fixtureBehavior === 'crash') process.exit(23);
  process.stdout.write(JSON.stringify({
    protocolVersion: 1,
    kind: 'success',
    value: { echoed: request.input && request.input.value },
    safeSummary: { title: 'Fixture Provider completed', details: {} }
  }));
});
`;

/**
 * Non-production, non-configurable child-process protocol fixture. It demonstrates that
 * extension Provider crashes are isolated from API/Worker without enabling arbitrary Providers.
 * Credential Lease values are intentionally excluded from the fixture protocol.
 */
export class DevelopmentProviderHostFixture implements ToolProvider {
  readonly key = 'fixture:child-process-v1';

  constructor(runtimeEnvironment: 'development' | 'test' | 'production') {
    if (runtimeEnvironment === 'production') {
      throw new Error('Development Provider Host fixture cannot run in production');
    }
  }

  summarize(): SafeToolSummary {
    return { title: 'Run isolated Provider fixture', details: { protocolVersion: '1' } };
  }

  execute(request: ToolProviderRequest): Promise<ToolProviderResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', fixtureHostProgram], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {},
      });
      let output = '';
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error('Provider Host fixture timed out')));
      }, 5_000);
      const finish = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abort);
        operation();
      };
      const abort = (): void => {
        child.kill('SIGKILL');
        finish(() => reject(new Error('Provider Host fixture was aborted')));
      };
      request.signal.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (Buffer.byteLength(output, 'utf8') > MAX_PROTOCOL_BYTES) {
          child.kill('SIGKILL');
          finish(() => reject(new Error('Provider Host protocol output is too large')));
        }
      });
      child.on('error', () => finish(() => reject(new Error('Provider Host fixture failed'))));
      child.on('exit', (code) => {
        if (settled) return;
        if (code !== 0) {
          finish(() => reject(new Error('Provider Host fixture exited unexpectedly')));
          return;
        }
        try {
          const response = JSON.parse(output) as {
            protocolVersion?: unknown;
            kind?: unknown;
            value?: unknown;
            safeSummary?: SafeToolSummary;
          };
          if (response.protocolVersion !== 1 || response.kind !== 'success'
            || !response.safeSummary) throw new Error('invalid protocol');
          finish(() => resolve({
            kind: 'success',
            value: response.value,
            safeSummary: response.safeSummary!,
          }));
        } catch {
          finish(() => reject(new Error('Provider Host fixture returned an invalid response')));
        }
      });
      child.stdin.end(JSON.stringify({
        protocolVersion: 1,
        toolCallId: request.toolCallId,
        capabilityId: request.revision.capabilityId,
        runId: request.runId,
        invocationId: request.invocationId,
        idempotencyKey: request.idempotencyKey,
        input: request.input,
        allowedOperations: request.credentialLease.allowedOperations,
      }));
    });
  }
}
