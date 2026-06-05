/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import { Plus, Trash2, Save } from 'lucide-react';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: {
    children: 'Button',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary',
  },
};

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Delete',
  },
};

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost',
  },
};

export const Small: Story = {
  args: {
    size: 'sm',
    children: 'Small',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
    children: 'Large',
  },
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex gap-3">
      <Button><Plus className="w-4 h-4 mr-2" />Create</Button>
      <Button variant="destructive"><Trash2 className="w-4 h-4 mr-2" />Delete</Button>
      <Button variant="outline"><Save className="w-4 h-4 mr-2" />Save</Button>
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <Button disabled>
      <span className="w-4 h-4 mr-2 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      Processing...
    </Button>
  ),
};
