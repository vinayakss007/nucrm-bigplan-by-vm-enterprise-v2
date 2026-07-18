'use client';
import { X } from 'lucide-react';
import type { EmailBlock, HeadingContent, TextContent, ImageContent, ButtonContent, DividerContent, SpacerContent, HtmlContent } from './blocks';
import { BLOCK_LABELS } from './blocks';

interface BlockEditorProps {
  block: EmailBlock;
  onChange: (id: string, content: EmailBlock['content']) => void;
  onClose: () => void;
}

export default function BlockEditor({ block, onChange, onClose }: BlockEditorProps) {
  const update = (partial: Partial<EmailBlock['content']>) => {
    onChange(block.id, { ...block.content, ...partial } as EmailBlock['content']);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">{BLOCK_LABELS[block.type]} Properties</p>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-3 h-3" /></button>
      </div>

      {block.type === 'heading' && <HeadingEditor content={block.content as HeadingContent} update={update} />}
      {block.type === 'text' && <TextEditor content={block.content as TextContent} update={update} />}
      {block.type === 'image' && <ImageEditor content={block.content as ImageContent} update={update} />}
      {block.type === 'button' && <ButtonEditor content={block.content as ButtonContent} update={update} />}
      {block.type === 'divider' && <DividerEditor content={block.content as DividerContent} update={update} />}
      {block.type === 'spacer' && <SpacerEditor content={block.content as SpacerContent} update={update} />}
      {block.type === 'html' && <HtmlEditor content={block.content as HtmlContent} update={update} />}
    </div>
  );
}

const inp = "w-full px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-violet-500";
const lbl = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wider";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={lbl + ' mb-1 block'}>{label}</label>{children}</div>;
}

function HeadingEditor({ content, update }: { content: HeadingContent; update: (p: Partial<HeadingContent>) => void }) {
  return (
    <>
      <Field label="Text">
        <input value={content.text} onChange={e => update({ text: e.target.value })} className={inp} />
      </Field>
      <Field label="Level">
        <select value={content.level} onChange={e => update({ level: Number(e.target.value) as 1 | 2 | 3 })} className={inp}>
          <option value={1}>H1</option><option value={2}>H2</option><option value={3}>H3</option>
        </select>
      </Field>
      <Field label="Align">
        <select value={content.align} onChange={e => update({ align: e.target.value as 'left' | 'center' | 'right' })} className={inp}>
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
      </Field>
      <Field label="Color">
        <input type="color" value={content.color} onChange={e => update({ color: e.target.value })} className="w-full h-8 rounded-lg border border-border cursor-pointer" />
      </Field>
    </>
  );
}

function TextEditor({ content, update }: { content: TextContent; update: (p: Partial<TextContent>) => void }) {
  return (
    <>
      <Field label="HTML Content">
        <textarea value={content.html} onChange={e => update({ html: e.target.value })} rows={6} className={inp + ' font-mono resize-none'} />
      </Field>
      <Field label="Align">
        <select value={content.align} onChange={e => update({ align: e.target.value as 'left' | 'center' | 'right' })} className={inp}>
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Font Size">
          <input type="number" value={content.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })} className={inp} min={10} max={32} />
        </Field>
        <Field label="Color">
          <input type="color" value={content.color} onChange={e => update({ color: e.target.value })} className="w-full h-8 rounded-lg border border-border cursor-pointer" />
        </Field>
      </div>
    </>
  );
}

function ImageEditor({ content, update }: { content: ImageContent; update: (p: Partial<ImageContent>) => void }) {
  return (
    <>
      <Field label="Image URL">
        <input value={content.src} onChange={e => update({ src: e.target.value })} className={inp} placeholder="https://..." />
      </Field>
      <Field label="Alt Text">
        <input value={content.alt} onChange={e => update({ alt: e.target.value })} className={inp} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Width">
          <input value={content.width} onChange={e => update({ width: e.target.value })} className={inp} placeholder="100%" />
        </Field>
        <Field label="Align">
          <select value={content.align} onChange={e => update({ align: e.target.value as 'left' | 'center' | 'right' })} className={inp}>
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </Field>
      </div>
      <Field label="Link URL (optional)">
        <input value={content.href} onChange={e => update({ href: e.target.value })} className={inp} placeholder="https://..." />
      </Field>
    </>
  );
}

function ButtonEditor({ content, update }: { content: ButtonContent; update: (p: Partial<ButtonContent>) => void }) {
  return (
    <>
      <Field label="Button Text">
        <input value={content.text} onChange={e => update({ text: e.target.value })} className={inp} />
      </Field>
      <Field label="Link URL">
        <input value={content.href} onChange={e => update({ href: e.target.value })} className={inp} placeholder="https://..." />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Background">
          <input type="color" value={content.bgColor} onChange={e => update({ bgColor: e.target.value })} className="w-full h-8 rounded-lg border border-border cursor-pointer" />
        </Field>
        <Field label="Text Color">
          <input type="color" value={content.textColor} onChange={e => update({ textColor: e.target.value })} className="w-full h-8 rounded-lg border border-border cursor-pointer" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Align">
          <select value={content.align} onChange={e => update({ align: e.target.value as 'left' | 'center' | 'right' })} className={inp}>
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </Field>
        <Field label="Border Radius">
          <input type="number" value={content.borderRadius} onChange={e => update({ borderRadius: Number(e.target.value) })} className={inp} min={0} max={50} />
        </Field>
      </div>
    </>
  );
}

function DividerEditor({ content, update }: { content: DividerContent; update: (p: Partial<DividerContent>) => void }) {
  return (
    <>
      <Field label="Color">
        <input type="color" value={content.color} onChange={e => update({ color: e.target.value })} className="w-full h-8 rounded-lg border border-border cursor-pointer" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Thickness">
          <input type="number" value={content.thickness} onChange={e => update({ thickness: Number(e.target.value) })} className={inp} min={1} max={10} />
        </Field>
        <Field label="Style">
          <select value={content.style} onChange={e => update({ style: e.target.value as 'solid' | 'dashed' | 'dotted' })} className={inp}>
            <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
          </select>
        </Field>
      </div>
      <Field label="Width">
        <input value={content.width} onChange={e => update({ width: e.target.value })} className={inp} placeholder="100%" />
      </Field>
    </>
  );
}

function SpacerEditor({ content, update }: { content: SpacerContent; update: (p: Partial<SpacerContent>) => void }) {
  return (
    <Field label="Height (px)">
      <input type="number" value={content.height} onChange={e => update({ height: Number(e.target.value) })} className={inp} min={8} max={200} />
    </Field>
  );
}

function HtmlEditor({ content, update }: { content: HtmlContent; update: (p: Partial<HtmlContent>) => void }) {
  return (
    <Field label="HTML Code">
      <textarea value={content.html} onChange={e => update({ html: e.target.value })} rows={10} className={inp + ' font-mono resize-none'} />
    </Field>
  );
}
