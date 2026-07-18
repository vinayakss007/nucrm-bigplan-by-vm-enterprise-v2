'use client';
import { useState, useCallback } from 'react';
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { createBlock, blocksToHtml, type EmailBlock, type BlockType } from './blocks';
import BlockPalette from './block-palette';
import BlockRenderer from './block-renderer';
import BlockEditor from './block-editor';

interface EmailBuilderProps {
  initialBlocks?: EmailBlock[];
  onChange?: (html: string, blocks: EmailBlock[]) => void;
}

export default function EmailBuilder({ initialBlocks = [], onChange }: EmailBuilderProps) {
  const [blocks, setBlocks] = useState<EmailBlock[]>(initialBlocks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const selectedBlock = blocks.find(b => b.id === selectedId) ?? null;

  const emitChange = useCallback((newBlocks: EmailBlock[]) => {
    const html = blocksToHtml(newBlocks);
    onChange?.(html, newBlocks);
  }, [onChange]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;

    // Dragging from palette — add new block
    if (activeData?.origin === 'palette') {
      const newBlock = createBlock(activeData.type as BlockType);
      const overIndex = blocks.findIndex(b => b.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex + 1 : blocks.length;
      const newBlocks = [...blocks.slice(0, insertAt), newBlock, ...blocks.slice(insertAt)];
      setBlocks(newBlocks);
      emitChange(newBlocks);
      setSelectedId(newBlock.id);
      return;
    }

    // Reordering within canvas
    if (active.id !== over.id) {
      const oldIndex = blocks.findIndex(b => b.id === active.id);
      const newIndex = blocks.findIndex(b => b.id === over.id);
      if (oldIndex >= 0 && newIndex >= 0) {
        const newBlocks = arrayMove(blocks, oldIndex, newIndex);
        setBlocks(newBlocks);
        emitChange(newBlocks);
      }
    }
  };

  const handleSelect = (id: string) => setSelectedId(id);

  const handleDelete = (id: string) => {
    const newBlocks = blocks.filter(b => b.id !== id);
    setBlocks(newBlocks);
    emitChange(newBlocks);
    if (selectedId === id) setSelectedId(null);
  };

  const handleDuplicate = (id: string) => {
    const block = blocks.find(b => b.id === id);
    if (!block) return;
    const newBlock = createBlock(block.type);
    newBlock.content = { ...block.content };
    const index = blocks.findIndex(b => b.id === id);
    const newBlocks = [...blocks.slice(0, index + 1), newBlock, ...blocks.slice(index + 1)];
    setBlocks(newBlocks);
    emitChange(newBlocks);
    setSelectedId(newBlock.id);
  };

  const handleBlockChange = (id: string, content: EmailBlock['content']) => {
    const newBlocks = blocks.map(b => b.id === id ? { ...b, content } : b);
    setBlocks(newBlocks);
    emitChange(newBlocks);
  };

  const handleAddBlock = (type: BlockType) => {
    const newBlock = createBlock(type);
    const newBlocks = [...blocks, newBlock];
    setBlocks(newBlocks);
    emitChange(newBlocks);
    setSelectedId(newBlock.id);
  };

  const activeBlock = activeId ? blocks.find(b => b.id === activeId) : null;
  const isPaletteDrag = activeId?.startsWith('palette-');

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 min-h-[500px]">
        {/* Left: Block palette */}
        <div className="w-44 shrink-0 space-y-2">
          <BlockPalette />
          <div className="border-t border-border pt-2 mt-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Quick Add</p>
            {(['heading', 'text', 'image', 'button', 'divider', 'spacer'] as BlockType[]).map(type => (
              <button
                key={type}
                onClick={() => handleAddBlock(type)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
              >
                <Plus className="w-3 h-3" />{type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Center: Canvas */}
        <div className="flex-1 min-w-0">
          <div className="bg-white dark:bg-slate-950 rounded-xl border border-border shadow-sm min-h-[400px] p-6">
            {blocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground/50 py-20">
                <p className="text-sm font-medium">Drag blocks here or click + to add</p>
                <p className="text-xs mt-1">Build your email template visually</p>
              </div>
            ) : (
              <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {blocks.map(block => (
                    <BlockRenderer
                      key={block.id}
                      block={block}
                      isSelected={selectedId === block.id}
                      onSelect={handleSelect}
                      onDelete={handleDelete}
                      onDuplicate={handleDuplicate}
                    />
                  ))}
                </div>
              </SortableContext>
            )}
          </div>
        </div>

        {/* Right: Properties panel */}
        {selectedBlock && (
          <div className="w-56 shrink-0">
            <div className="bg-card rounded-xl border border-border p-3">
              <BlockEditor
                block={selectedBlock}
                onChange={handleBlockChange}
                onClose={() => setSelectedId(null)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeBlock && !isPaletteDrag && (
          <div className="bg-card rounded-lg border border-violet-300 shadow-lg p-2 opacity-80">
            <p className="text-xs font-medium">{activeBlock.type}</p>
          </div>
        )}
        {isPaletteDrag && (
          <div className="bg-card rounded-lg border border-violet-300 shadow-lg px-3 py-2">
            <p className="text-xs font-medium">{activeId?.replace('palette-', '')}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
