/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useDraggable } from '@dnd-kit/core';
import { Type, Image, MousePointerClick, Minus, Space, Columns, Code, AlignLeft } from 'lucide-react';
import { BLOCK_LABELS, type BlockType } from './blocks';

const PALETTE_ITEMS: { type: BlockType; icon: typeof Type; description: string }[] = [
  { type: 'heading', icon: Type, description: 'Title text' },
  { type: 'text', icon: AlignLeft, description: 'Paragraph' },
  { type: 'image', icon: Image, description: 'Photo or logo' },
  { type: 'button', icon: MousePointerClick, description: 'Call to action' },
  { type: 'divider', icon: Minus, description: 'Horizontal line' },
  { type: 'spacer', icon: Space, description: 'Empty space' },
  { type: 'columns', icon: Columns, description: 'Side-by-side' },
  { type: 'html', icon: Code, description: 'Custom HTML' },
];

function DraggablePaletteItem({ type, icon: Icon, description }: { type: BlockType; icon: typeof Type; description: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { type, origin: 'palette' },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card hover:border-violet-300 dark:hover:border-violet-700 cursor-grab active:cursor-grabbing transition-colors select-none ${isDragging ? 'opacity-50' : ''}`}
    >
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-medium">{BLOCK_LABELS[type]}</p>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default function BlockPalette() {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Blocks</p>
      {PALETTE_ITEMS.map(item => (
        <DraggablePaletteItem key={item.type} {...item} />
      ))}
    </div>
  );
}
