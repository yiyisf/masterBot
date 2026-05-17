import type { Meta, StoryObj } from '@storybook/react';
import { Terminal } from 'lucide-react';
import { SkillCard } from './skill-card';

const meta: Meta<typeof SkillCard> = {
  component: SkillCard,
  title: 'Business/SkillCard',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof SkillCard>;

export const Default: Story = {
  args: {
    name: 'Shell 执行器',
    description: '在安全沙箱中执行 Shell 命令，支持黑名单/白名单模式过滤危险命令。',
    category: '内置',
    icon: <Terminal className="h-5 w-5" />,
    usageCount: 1248,
    rating: 4.8,
  },
};

export const WithActions: Story = {
  args: {
    name: '文件管理器',
    description: '文件读写、目录操作、文件搜索等能力。',
    category: '内置',
    usageCount: 986,
    rating: 4.5,
    onInstall: () => alert('安装'),
    onView: () => alert('查看'),
  },
};

export const ViewOnly: Story = {
  args: {
    name: 'HTTP 客户端',
    description: '发送 HTTP 请求，支持 GET/POST/PUT/DELETE，自动处理 JSON。',
    category: '内置',
    usageCount: 432,
    onView: () => alert('查看'),
  },
};

export const NoMetrics: Story = {
  args: {
    name: '自定义技能',
    description: '用户自定义技能，暂无使用数据。',
    category: '本地',
  },
};
