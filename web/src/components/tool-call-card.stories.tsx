import type { Meta, StoryObj } from '@storybook/react';
import { ToolCallCard } from './tool-call-card';

const meta: Meta<typeof ToolCallCard> = {
  component: ToolCallCard,
  title: 'Business/ToolCallCard',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof ToolCallCard>;

export const Loading: Story = {
  args: {
    toolName: 'shell.execute',
    status: 'loading',
    input: { command: 'ls -la /tmp', timeout: 30 },
  },
};

export const Success: Story = {
  args: {
    toolName: 'http_client.get',
    status: 'success',
    input: { url: 'https://api.example.com/data', headers: { 'Accept': 'application/json' } },
    output: { status: 200, body: { items: [{ id: 1, name: 'Test' }] } },
  },
};

export const Error: Story = {
  args: {
    toolName: 'file_manager.read',
    status: 'error',
    input: { path: '/etc/shadow' },
    output: 'Permission denied: /etc/shadow',
  },
};

export const WithCopy: Story = {
  args: {
    toolName: 'memory.search',
    status: 'success',
    input: { query: '上次项目讨论', limit: 5 },
    output: [
      { id: 'mem_1', content: '2026-05-10 团队讨论了重构计划', score: 0.92 },
    ],
    onCopy: () => alert('已复制到剪贴板'),
  },
};
