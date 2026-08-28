#!/usr/bin/env tsx
/** PROTOTYPE — throwaway TUI. Run: npm run prototype:architecture */

import readline from 'node:readline';
import { catalog, initialState, reduce, type ArchitectureState, type PrototypeAction } from './model.js';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';
let state = initialState();

function line(label: string, value: unknown): string {
  return `${bold}${label.padEnd(18)}${reset} ${typeof value === 'string' ? value : JSON.stringify(value)}`;
}

function render(current: ArchitectureState): void {
  console.clear();
  console.log(`${bold}${cyan}CMaster architecture model — THROWAWAY PROTOTYPE${reset}`);
  console.log(`${dim}Question: are ownership, data references, and replaceable seams understandable?${reset}\n`);

  console.log(`${bold}Stable product model${reset}`);
  console.log('Enterprise Assistant');
  console.log('└─ Conversation → Message*');
  console.log('   └─ employee Message → Run → Invocation tree');
  console.log('      ├─ Agent Engine → Model Module → provider adapter');
  console.log('      ├─ ToolRuntime → Tool Provider');
  console.log('      └─ RunEvent → Gateway adapter → Web UI');
  console.log('Task links to Runs only when work needs a durable/background lifecycle.\n');

  console.log(`${bold}Current facts${reset}`);
  console.log(line('Conversation', current.conversation.id));
  console.log(line('Messages', current.conversation.messages.map(message => `${message.id}:${message.author}`)));
  console.log(line('Runs', current.runs.map(run => `${run.id}:${run.status} context=[${run.contextMessageIds.join(',')}]`)));
  console.log(line('Invocations', current.invocations.map(item => `${item.id}:${item.agentId}:${item.status}${item.parentId ? `<-${item.parentId}` : ''}`)));
  console.log(line('Model calls', current.modelCalls.map(call => `${call.id}:${call.profileId}@${call.adapter}`)));
  console.log(line('Tool calls', current.toolCalls.map(call => `${call.id}:${call.toolId}:${call.outcome}`)));
  console.log(line('Tasks', current.tasks.map(task => `${task.id}:${task.status}->${task.runIds.join(',')}`)));
  console.log(line('Active Run', current.activeRunId ?? 'none'));
  console.log(line('Active Invocation', current.activeInvocationId ?? 'none'));

  console.log(`\n${bold}Last action crossed these module seams${reset}`);
  console.log(current.lastRoute.join('  →  '));
  console.log(`${dim}${current.lastNote}${reset}\n`);

  console.log(`${bold}Tool concepts (static catalog)${reset}`);
  console.log(line('Skills', catalog.skills.map(skill => `${skill.id} → [${skill.contributes.join(',') || 'instructions only'}]`)));
  console.log(line('Connectors', catalog.connectors.map(connector => `${connector.id} → [${connector.contributes.join(',')}]`)));
  console.log(line('MCP providers', catalog.providers.map(provider => `${provider.id} → [${provider.contributes.join(',')}]`)));
  console.log(line('Agent sees', catalog.tools));

  console.log(`\n${bold}[u]${reset}${dim} user Message/new Run  ${reset}`
    + `${bold}[d]${reset}${dim} delegate child  ${reset}`
    + `${bold}[m]${reset}${dim} model call  ${reset}`
    + `${bold}[t]${reset}${dim} tool call${reset}`);
  console.log(`${bold}[c]${reset}${dim} complete active Invocation  ${reset}`
    + `${bold}[b]${reset}${dim} background Task  ${reset}`
    + `${bold}[r]${reset}${dim} reset  ${reset}`
    + `${bold}[q]${reset}${dim} quit${reset}`);
}

const keyActions: Record<string, PrototypeAction> = {
  u: { type: 'employee_message' },
  d: { type: 'delegate' },
  m: { type: 'model_call' },
  t: { type: 'tool_call' },
  c: { type: 'complete' },
  b: { type: 'background_task' },
  r: { type: 'reset' },
};

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('keypress', (_input, key) => {
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    console.clear();
    process.exit(0);
  }
  const action = keyActions[key.name ?? ''];
  if (action) {
    state = reduce(state, action);
    render(state);
  }
});

render(state);
