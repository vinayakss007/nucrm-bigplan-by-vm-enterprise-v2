/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
export type BlockType = 'heading' | 'text' | 'image' | 'button' | 'divider' | 'spacer' | 'columns' | 'html';

export interface EmailBlock {
  id: string;
  type: BlockType;
  content: BlockContent;
}

export type BlockContent =
  | HeadingContent
  | TextContent
  | ImageContent
  | ButtonContent
  | DividerContent
  | SpacerContent
  | ColumnsContent
  | HtmlContent;

export interface HeadingContent {
  text: string;
  level: 1 | 2 | 3;
  align: 'left' | 'center' | 'right';
  color: string;
}

export interface TextContent {
  html: string;
  align: 'left' | 'center' | 'right';
  color: string;
  fontSize: number;
}

export interface ImageContent {
  src: string;
  alt: string;
  width: string;
  align: 'left' | 'center' | 'right';
  href: string;
}

export interface ButtonContent {
  text: string;
  href: string;
  bgColor: string;
  textColor: string;
  align: 'left' | 'center' | 'right';
  borderRadius: number;
}

export interface DividerContent {
  color: string;
  thickness: number;
  style: 'solid' | 'dashed' | 'dotted';
  width: string;
}

export interface SpacerContent {
  height: number;
}

export interface ColumnsContent {
  columns: { width: string; blocks: EmailBlock[] }[];
}

export interface HtmlContent {
  html: string;
}

export const BLOCK_DEFAULTS: Record<BlockType, BlockContent> = {
  heading: { text: 'Heading', level: 2, align: 'left', color: '#1a1a1a' },
  text: { html: '<p>Enter your text here.</p>', align: 'left', color: '#4a4a4a', fontSize: 15 },
  image: { src: '', alt: '', width: '100%', align: 'center', href: '' },
  button: { text: 'Click Here', href: '#', bgColor: '#7c3aed', textColor: '#ffffff', align: 'center', borderRadius: 8 },
  divider: { color: '#e5e7eb', thickness: 1, style: 'solid', width: '100%' },
  spacer: { height: 32 },
  columns: { columns: [{ width: '50%', blocks: [] }, { width: '50%', blocks: [] }] },
  html: { html: '<!-- Custom HTML -->' },
};

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  button: 'Button',
  divider: 'Divider',
  spacer: 'Spacer',
  columns: 'Columns',
  html: 'HTML',
};

let blockCounter = 0;
export function createBlock(type: BlockType): EmailBlock {
  return {
    id: `block_${Date.now()}_${++blockCounter}`,
    type,
    content: { ...BLOCK_DEFAULTS[type] },
  };
}

export function blocksToHtml(blocks: EmailBlock[]): string {
  return blocks.map(b => blockToHtml(b)).join('\n');
}

function blockToHtml(block: EmailBlock): string {
  const c = block.content;
  switch (block.type) {
    case 'heading': {
      const hc = c as HeadingContent;
      const tag = `h${hc.level}`;
      return `<${tag} style="margin:0;padding:0;color:${hc.color};text-align:${hc.align};font-weight:600;">${hc.text}</${tag}>`;
    }
    case 'text': {
      const tc = c as TextContent;
      return `<div style="text-align:${tc.align};color:${tc.color};font-size:${tc.fontSize}px;line-height:1.6;">${tc.html}</div>`;
    }
    case 'image': {
      const ic = c as ImageContent;
      if (!ic.src) return '<p style="color:#999;text-align:center;">[Image placeholder]</p>';
      const img = `<img src="${ic.src}" alt="${ic.alt}" style="max-width:${ic.width};height:auto;display:block;" />`;
      return ic.href ? `<a href="${ic.href}" style="display:block;text-align:${ic.align};">${img}</a>` : `<div style="text-align:${ic.align};">${img}</div>`;
    }
    case 'button': {
      const bc = c as ButtonContent;
      return `<div style="text-align:${bc.align};"><a href="${bc.href}" style="display:inline-block;padding:12px 28px;background:${bc.bgColor};color:${bc.textColor};text-decoration:none;border-radius:${bc.borderRadius}px;font-weight:600;font-size:15px;">${bc.text}</a></div>`;
    }
    case 'divider': {
      const dc = c as DividerContent;
      return `<hr style="border:none;border-top:${dc.thickness}px ${dc.style} ${dc.color};width:${dc.width};margin:0 auto;" />`;
    }
    case 'spacer': {
      const sc = c as SpacerContent;
      return `<div style="height:${sc.height}px;line-height:${sc.height}px;">&nbsp;</div>`;
    }
    case 'html': {
      return (c as HtmlContent).html;
    }
    case 'columns': {
      const cc = c as ColumnsContent;
      const cols = cc.columns.map(col =>
        `<td style="width:${col.width};vertical-align:top;padding:0 8px;">${blocksToHtml(col.blocks)}</td>`
      ).join('');
      return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${cols}</tr></table>`;
    }
    default:
      return '';
  }
}
