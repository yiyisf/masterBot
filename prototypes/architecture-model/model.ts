/**
 * PROTOTYPE — throwaway architecture model.
 *
 * Question: does the proposed Conversation/Run/Invocation model make ownership and
 * module seams understandable, especially when model and tool implementations vary?
 * No persistence or production code is used.
 */

export type PrototypeAction =
  | { type: 'employee_message' }
  | { type: 'delegate' }
  | { type: 'model_call' }
  | { type: 'tool_call' }
  | { type: 'complete' }
  | { type: 'background_task' }
  | { type: 'reset' };

type Message = { id: string; author: 'employee' | 'assistant'; text: string };
type Run = { id: string; triggerMessageId: string; status: 'running' | 'completed'; contextMessageIds: string[] };
type Invocation = { id: string; runId: string; agentId: string; parentId?: string; status: 'running' | 'completed' };
type ModelCall = { id: string; invocationId: string; profileId: string; adapter: string; contextMessageIds: string[] };
type ToolCall = { id: string; invocationId: string; toolId: string; outcome: 'ok' };
type Task = { id: string; runIds: string[]; status: 'queued' };

export interface ArchitectureState {
  conversation: { id: string; messages: Message[] };
  runs: Run[];
  invocations: Invocation[];
  modelCalls: ModelCall[];
  toolCalls: ToolCall[];
  tasks: Task[];
  activeRunId?: string;
  activeInvocationId?: string;
  toolCursor: number;
  sequence: number;
  lastRoute: string[];
  lastNote: string;
}

export const catalog = {
  skills: [
    { id: 'reporting@1', contributes: ['report.generate'] },
    { id: 'writing-guide@2', contributes: [] },
  ],
  connectors: [
    { id: 'company-crm', contributes: ['crm.customer.lookup'] },
  ],
  providers: [
    { id: 'github-mcp', protocol: 'MCP', contributes: ['github.issue.list'] },
  ],
  tools: ['report.generate', 'crm.customer.lookup', 'github.issue.list'],
};

export function initialState(): ArchitectureState {
  return {
    conversation: { id: 'conversation-1', messages: [] },
    runs: [],
    invocations: [],
    modelCalls: [],
    toolCalls: [],
    tasks: [],
    toolCursor: 0,
    sequence: 0,
    lastRoute: ['Web UI', 'Gateway Adapter', 'RunCoordinator'],
    lastNote: 'Ready. Create an employee Message to start a Run.',
  };
}

function nextId(state: ArchitectureState, prefix: string): [ArchitectureState, string] {
  const sequence = state.sequence + 1;
  return [{ ...state, sequence }, `${prefix}-${sequence}`];
}

export function reduce(state: ArchitectureState, action: PrototypeAction): ArchitectureState {
  if (action.type === 'reset') return initialState();

  if (action.type === 'employee_message') {
    let next = state;
    let messageId: string;
    [next, messageId] = nextId(next, 'message');
    let runId: string;
    [next, runId] = nextId(next, 'run');
    let invocationId: string;
    [next, invocationId] = nextId(next, 'invocation');
    const message: Message = { id: messageId, author: 'employee', text: `Employee request ${next.runs.length + 1}` };
    const messages = [...next.conversation.messages, message];
    return {
      ...next,
      conversation: { ...next.conversation, messages },
      runs: [...next.runs, { id: runId, triggerMessageId: messageId, status: 'running', contextMessageIds: messages.map(item => item.id) }],
      invocations: [...next.invocations, { id: invocationId, runId, agentId: 'enterprise-assistant', status: 'running' }],
      activeRunId: runId,
      activeInvocationId: invocationId,
      lastRoute: ['Web UI', 'Gateway Adapter', 'RunCoordinator', 'Harness', 'root Invocation'],
      lastNote: 'Run references Message IDs. Earlier content was not copied into the Run.',
    };
  }

  const activeRun = state.runs.find(run => run.id === state.activeRunId && run.status === 'running');
  const activeInvocation = state.invocations.find(item => item.id === state.activeInvocationId && item.status === 'running');
  if (!activeRun || !activeInvocation) {
    return { ...state, lastNote: 'No active Run. Press [u] to submit a Message.', lastRoute: ['No operation'] };
  }

  if (action.type === 'delegate') {
    let next = state;
    let invocationId: string;
    [next, invocationId] = nextId(next, 'invocation');
    return {
      ...next,
      invocations: [...next.invocations, {
        id: invocationId,
        runId: activeRun.id,
        agentId: 'research-agent',
        parentId: activeInvocation.id,
        status: 'running',
      }],
      activeInvocationId: invocationId,
      lastRoute: ['RunCoordinator', 'Harness', 'child Invocation', 'Agent Engine Adapter'],
      lastNote: 'Delegation creates a child Invocation inside the same Run, not another Conversation.',
    };
  }

  if (action.type === 'model_call') {
    let next = state;
    let modelCallId: string;
    [next, modelCallId] = nextId(next, 'model-call');
    return {
      ...next,
      modelCalls: [...next.modelCalls, {
        id: modelCallId,
        invocationId: activeInvocation.id,
        profileId: 'balanced-reasoning',
        adapter: 'Vercel AI SDK adapter (planned)',
        contextMessageIds: activeRun.contextMessageIds,
      }],
      lastRoute: ['Harness', 'Agent Engine', 'Model Module', 'ModelRouter', 'Vercel AI SDK adapter', 'Provider'],
      lastNote: 'The Agent Engine requests model capabilities; provider details remain in the Model adapter.',
    };
  }

  if (action.type === 'tool_call') {
    let next = state;
    let toolCallId: string;
    [next, toolCallId] = nextId(next, 'tool-call');
    const toolId = catalog.tools[next.toolCursor % catalog.tools.length];
    return {
      ...next,
      toolCalls: [...next.toolCalls, { id: toolCallId, invocationId: activeInvocation.id, toolId, outcome: 'ok' }],
      toolCursor: next.toolCursor + 1,
      lastRoute: ['Harness', 'Agent Engine', 'ToolRuntime', 'policy + validation', `Provider for ${toolId}`],
      lastNote: `The Agent invoked stable Tool ID "${toolId}" without knowing whether it came from a Skill, Connector, or MCP.`,
    };
  }

  if (action.type === 'background_task') {
    let next = state;
    let taskId: string;
    [next, taskId] = nextId(next, 'task');
    return {
      ...next,
      tasks: [...next.tasks, { id: taskId, runIds: [activeRun.id], status: 'queued' }],
      lastRoute: ['RunCoordinator', 'Task module', 'queue adapter'],
      lastNote: 'A Task exists only because work now has a durable lifecycle beyond the interactive Run.',
    };
  }

  const parent = activeInvocation.parentId
    ? state.invocations.find(item => item.id === activeInvocation.parentId)
    : undefined;
  const invocations = state.invocations.map(item => item.id === activeInvocation.id ? { ...item, status: 'completed' as const } : item);
  if (parent) {
    return {
      ...state,
      invocations,
      activeInvocationId: parent.id,
      lastRoute: ['child Invocation', 'Harness', 'parent Invocation'],
      lastNote: 'Child completion returns a result to its parent Invocation; the Run remains active.',
    };
  }

  let next = { ...state, invocations };
  let messageId: string;
  [next, messageId] = nextId(next, 'message');
  const assistantMessage: Message = { id: messageId, author: 'assistant', text: `Assistant answer for ${activeRun.id}` };
  return {
    ...next,
    conversation: { ...next.conversation, messages: [...next.conversation.messages, assistantMessage] },
    runs: next.runs.map(run => run.id === activeRun.id ? { ...run, status: 'completed' as const } : run),
    activeRunId: undefined,
    activeInvocationId: undefined,
    lastRoute: ['Harness', 'RunCoordinator', 'RunEvent', 'Gateway Adapter', 'Web UI'],
    lastNote: 'The root Invocation completed the Run and appended one canonical assistant Message.',
  };
}
