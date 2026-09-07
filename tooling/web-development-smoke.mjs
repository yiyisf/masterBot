import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const port = await reservePort();
const output = [];
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', 'apps/web', '-p', String(port)],
  {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', (chunk) => output.push(chunk.toString()));
child.stderr.on('data', (chunk) => output.push(chunk.toString()));

try {
  await waitUntilReachable(`http://127.0.0.1:${port}/`);
  const response = await fetch(`http://127.0.0.1:${port}/workspace`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Development workspace returned HTTP ${response.status}\n${body.slice(0, 2_000)}`,
    );
  }
  console.log(`Development workspace compiled successfully on port ${port}`);
} catch (error) {
  console.error(output.join(''));
  throw error;
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to reserve a development server port');
  }
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
  return address.port;
}

async function waitUntilReachable(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server has not bound its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Development server did not become reachable within 30 seconds');
}
