import type { Meta, StoryObj } from '@storybook/react';
import { Inbox, Search, Puzzle } from 'lucide-react';
import { Button } from './ui/button';
import { EmptyState } from './layout/empty-state';

const meta: Meta<typeof EmptyState> = {
  component: EmptyState,
  title: 'Layout/EmptyState',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: {
    icon: <Inbox className="h-8 w-8" />,
    title: '暂无消息',
    description: '开始一段新对话，AI 助手随时待命。',
    action: <Button>开始对话</Button>,
  },
};

export const SearchEmpty: Story = {
  args: {
    icon: <Search className="h-8 w-8" />,
    title: '未找到结果',
    description: '没有找到匹配的内容，请尝试其他关键词。',
  },
};

export const NoSkills: Story = {
  args: {
    icon: <Puzzle className="h-8 w-8" />,
    title: '还没有安装技能',
    description: '前往技能市场浏览并安装适合您需求的技能。',
    action: <Button variant="outline">浏览技能市场</Button>,
  },
};

export const NoDescription: Story = {
  args: {
    title: '列表为空',
    action: <Button size="sm">立即创建</Button>,
  },
};
