import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

let callCount = 0;

function chunk(id, delta, finishReason = null, usage) {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: 1, model: 'release-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  })}\n\n`;
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }

  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    callCount += 1;
    const id = `release-call-${callCount}`;
    const payload = JSON.parse(body);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const transcript = JSON.stringify(messages);
    const requestsArtifact = transcript.includes('Create the exact staged rollout Artifact.');
    const hasToolResult = messages.some((message) => message?.role === 'tool');
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    if (!requestsArtifact) {
      response.write(chunk(id, { role: 'assistant', content: 'Prior launch fact: rollout is staged.' }));
      void delay(5_000).then(() => {
        response.write(chunk(id, { content: ' First run complete.' }));
        response.write(chunk(id, {}, 'stop', {
          prompt_tokens: 4, completion_tokens: 9, total_tokens: 13,
        }));
        response.end('data: [DONE]\n\n');
      });
      return;
    }
    if (!hasToolResult) {
      response.write(chunk(id, {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: 'release-artifact-call',
          type: 'function',
          function: {
            name: 'create_text_artifact',
            arguments: JSON.stringify({
              title: 'Staged rollout plan',
              format: 'markdown',
              content: '# Rollout\nUse the staged release fact.',
            }),
          },
        }],
      }));
      response.write(chunk(id, {}, 'tool_calls', {
        prompt_tokens: 8, completion_tokens: 8, total_tokens: 16,
      }));
      response.end('data: [DONE]\n\n');
      return;
    }
    response.write(chunk(id, {
      role: 'assistant', content: 'The exact staged rollout Artifact is ready.',
    }));
    response.write(chunk(id, {}, 'stop', {
      prompt_tokens: 12, completion_tokens: 8, total_tokens: 20,
    }));
    response.end('data: [DONE]\n\n');
  });
});

server.listen(3112, '127.0.0.1');

function shutdown() {
  server.close(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
