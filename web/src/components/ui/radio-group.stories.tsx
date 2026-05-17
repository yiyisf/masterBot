import type { Meta, StoryObj } from '@storybook/react';
import { Label } from './label';
import { RadioGroup, RadioGroupItem } from './radio-group';

const meta: Meta<typeof RadioGroup> = {
  component: RadioGroup,
  title: 'UI/RadioGroup',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof RadioGroup>;

export const Default: Story = {
  render: (args) => (
    <RadioGroup defaultValue="option1" {...args}>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option1" id="o1" />
        <Label htmlFor="o1">选项一</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option2" id="o2" />
        <Label htmlFor="o2">选项二</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="option3" id="o3" />
        <Label htmlFor="o3">选项三</Label>
      </div>
    </RadioGroup>
  ),
};

export const WithDescription: Story = {
  render: (args) => (
    <RadioGroup defaultValue="light" {...args}>
      {[
        { value: 'light', label: '亮色模式', desc: '适合白天使用' },
        { value: 'dark', label: '暗色模式', desc: '适合夜间使用' },
        { value: 'high-contrast', label: '高对比度', desc: '无障碍增强模式' },
      ].map((item) => (
        <div key={item.value} className="flex items-start gap-2">
          <RadioGroupItem value={item.value} id={item.value} className="mt-0.5" />
          <div>
            <Label htmlFor={item.value}>{item.label}</Label>
            <p className="text-xs text-muted-foreground">{item.desc}</p>
          </div>
        </div>
      ))}
    </RadioGroup>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <RadioGroup defaultValue="b" {...args}>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="a" id="da" disabled />
        <Label htmlFor="da" className="text-muted-foreground">禁用选项</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="b" id="db" />
        <Label htmlFor="db">正常选项</Label>
      </div>
    </RadioGroup>
  ),
};
