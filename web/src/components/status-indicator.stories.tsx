import type { Meta, StoryObj } from '@storybook/react';
import { StatusIndicator } from './status-indicator';

const meta: Meta<typeof StatusIndicator> = {
  component: StatusIndicator,
  title: 'Business/StatusIndicator',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof StatusIndicator>;

export const Idle: Story = {
  args: { status: 'idle', label: '空闲' },
};

export const Thinking: Story = {
  args: { status: 'thinking', label: '思考中' },
};

export const Executing: Story = {
  args: { status: 'executing', label: '执行中' },
};

export const Waiting: Story = {
  args: { status: 'waiting', label: '等待中' },
};

export const Error: Story = {
  args: { status: 'error', label: '出错' },
};

export const NoLabel: Story = {
  args: { status: 'thinking' },
};
