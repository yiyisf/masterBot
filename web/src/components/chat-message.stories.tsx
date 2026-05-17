import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessage } from './chat-message';

const meta: Meta<typeof ChatMessage> = {
  component: ChatMessage,
  title: 'Business/ChatMessage',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof ChatMessage>;

export const UserMessage: Story = {
  args: {
    role: 'user',
    content: '请帮我分析一下这段代码的性能问题。',
    timestamp: new Date(),
  },
};

export const AssistantMessage: Story = {
  args: {
    role: 'assistant',
    content: '我来帮您分析代码性能问题。根据您提供的代码，我发现了以下几个潜在的性能瓶颈：\n\n1. 循环中存在不必要的对象创建\n2. 未使用缓存导致重复计算\n3. 异步操作未并行处理',
    timestamp: new Date(),
    onCopy: () => alert('复制成功'),
    onRegenerate: () => alert('重新生成'),
    onDislike: () => alert('已标记'),
  },
};

export const StreamingMessage: Story = {
  args: {
    role: 'assistant',
    content: '正在为您生成回答',
    streaming: true,
  },
};

export const LongMessage: Story = {
  args: {
    role: 'assistant',
    content: '这是一段较长的回答内容。\n\n**分析结果**\n\n性能分析显示，主要瓶颈在于 O(n²) 的嵌套循环，建议改用 HashMap 将时间复杂度降至 O(n)。\n\n**优化建议**\n1. 使用 Map/Set 替代数组查找\n2. 避免在循环内创建临时对象\n3. 使用 Promise.all 并行处理异步操作',
    timestamp: new Date(Date.now() - 120000),
  },
};
