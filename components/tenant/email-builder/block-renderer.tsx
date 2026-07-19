'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EmailBlock, HeadingContent, TextContent, ImageContent, ButtonContent, DividerContent, SpacerContent, HtmlContent } from './blocks';

interface BlockRendererProps {
  block: EmailBlock;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export default function BlockRenderer({ block, isSelected, onSelect, onDelete, onDuplicate }: BlockRendererProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative rounded-lg border transition-colors',
        isSelected ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/10' : 'border-transparent hover:border-border',
        isDragging && 'opacity-50 z-50'
      )}
      onClick={(e) => { e.stopPropagation(); onSelect(block.id); }}
    >
      {/* Drag handle + actions */}
      <div className={cn(
        'absolute -left-8 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 transition-opacity',
        isSelected || isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      )}>
        <button
          {...attributes}
          {...listeners}
          className="p-0.5 rounded hover:bg-muted cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Actions toolbar */}
      <div className={cn(
        'absolute -right-1 top-1 flex items-center gap-0.5 transition-opacity z-10',
        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      )}>
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(block.id); }} className="p-1 rounded hover:bg-muted">
          <Copy className="w-3 h-3 text-muted-foreground" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(block.id); }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20">
          <Trash2 className="w-3 h-3 text-red-500" />
        </button>
      </div>

      {/* Block content */}
      <div className="px-3 py-2">
        <BlockContentPreview block={block} />
      </div>
    </div>
  );
}

function BlockContentPreview({ block }: { block: EmailBlock }) {
  const c = block.content;
  switch (block.type) {
    case 'heading': {
      const hc = c as HeadingContent;
      const Tag = (`h${hc.level}`) as 'h1' | 'h2' | 'h3';
      const sizes = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base' };
      return <Tag className={cn('font-bold', sizes[hc.level])} style={{ color: hc.color, textAlign: hc.align }}>{hc.text}</Tag>;
    }
    case 'text': {
      const tc = c as TextContent;
      return <div style={{ textAlign: tc.align, color: tc.color, fontSize: tc.fontSize }} className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: tc.html }} />;
    }
    case 'image': {
      const ic = c as ImageContent;
      if (!ic.src) return <div className="h-24 bg-muted rounded-lg flex items-center justify-center text-xs text-muted-foreground">Click to add image URL</div>;
      {/* eslint-disable-next-line @next/next/no-img-element */}
      return <img src={ic.src} alt={ic.alt} style={{ maxWidth: ic.width }} className="rounded" />;
    }
    case 'button': {
      const bc = c as ButtonContent;
      return (
        <div style={{ textAlign: bc.align }}>
          <span className="inline-block px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: bc.bgColor, color: bc.textColor, borderRadius: bc.borderRadius }}>
            {bc.text}
          </span>
        </div>
      );
    }
    case 'divider': {
      const dc = c as DividerContent;
      return <hr style={{ border: 'none', borderTop: `${dc.thickness}px ${dc.style} ${dc.color}`, width: dc.width, margin: '0 auto' }} />;
    }
    case 'spacer': {
      const sc = c as SpacerContent;
      return <div style={{ height: sc.height }} className="bg-muted/30 rounded flex items-center justify-center text-[10px] text-muted-foreground">{sc.height}px</div>;
    }
    case 'html': {
      const htc = c as HtmlContent;
      return <div className="bg-muted/30 rounded p-2 text-xs font-mono text-muted-foreground truncate">{htc.html || '<!-- HTML -->'}</div>;
    }
    default:
      return null;
  }
}
