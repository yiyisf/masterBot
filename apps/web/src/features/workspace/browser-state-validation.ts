const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const runStatuses = new Set([
  'accepted', 'queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled',
]);

export function isBrowserUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function isBrowserRunStatus(value: unknown): boolean {
  return typeof value === 'string' && runStatuses.has(value);
}
