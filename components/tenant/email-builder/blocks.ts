/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import sanitizeHtml from 'sanitize-html';
import { escapeHtml } from '@/lib/email/escape-html';

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

function safeAlign(value: unknown, fallback = 'left'): string {
  return value === 'left' || value === 'center' || value === 'right' ? value : fallback;
}

function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(value) ? value : fallback;
}

function safeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function safeSize(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{1,4}(px|%)?$/.test(value) ? value : fallback;
}

function safeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function safeText(value: unknown): string {
  return escapeHtml(typeof value === 'string' ? value : value == null ? '' : String(value));
}

const RICH_HTML_OPTIONS = {
  allowedTags: ['b', 'i', 'em', 'strong', 'u', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    '*': ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^[a-z]{3,20}$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]{3,20}$/i],
      'font-size': [/^\d{1,3}px$/],
      'text-align': [/^(left|center|right|justify)$/],
      width: [/^\d{1,4}(px|%)$/],
      height: [/^\d{1,4}(px|%)$/],
    },
  },
  disallowedTagsMode: 'discard' as const,
};

function safeHtml(value: unknown): string {
  return typeof value === 'string' ? sanitizeHtml(value, RICH_HTML_OPTIONS) : '';
}

export function blocksToHtml(blocks: EmailBlock[]): string {
  return (Array.isArray(blocks) ? blocks : []).map(b => blockToHtml(b)).join('\n');
}

function blockToHtml(block: EmailBlock): string {
  if (!block || typeof block !== 'object') return '';
  const c = block.content;
  switch (block.type) {
    case 'heading': {
      const hc = c as HeadingContent;
      const tag = `h${Math.round(safeNumber(hc.level, 2, 1, 3))}`;
      return `<${tag} style="margin:0;padding:0;color:${safeColor(hc.color, '#1a1a1a')};text-align:${safeAlign(hc.align)};font-weight:600;">${safeText(hc.text)}</${tag}>`;
    }
    case 'text': {
      const tc = c as TextContent;
      return `<div style="text-align:${safeAlign(tc.align)};color:${safeColor(tc.color, '#4a4a4a')};font-size:${safeNumber(tc.fontSize, 15, 8, 72)}px;line-height:1.6;">${safeHtml(tc.html)}</div>`;
    }
    case 'image': {
      const ic = c as ImageContent;
      const src = safeUrl(ic.src);
      if (!src) return '<p style="color:#999;text-align:center;">[Image placeholder]</p>';
      const img = `<img src="${escapeHtml(src)}" alt="${safeText(ic.alt)}" style="max-width:${safeSize(ic.width, '100%')};height:auto;display:block;" />`;
      const href = safeUrl(ic.href);
      return href
        ? `<a href="${escapeHtml(href)}" style="display:block;text-align:${safeAlign(ic.align)};">${img}</a>`
        : `<div style="text-align:${safeAlign(ic.align)};">${img}</div>`;
    }
    case 'button': {
      const bc = c as ButtonContent;
      return `<div style="text-align:${safeAlign(bc.align)};"><a href="${escapeHtml(safeUrl(bc.href) || '#')}" style="display:inline-block;padding:12px 28px;background:${safeColor(bc.bgColor, '#7c3aed')};color:${safeColor(bc.textColor, '#ffffff')};text-decoration:none;border-radius:${safeNumber(bc.borderRadius, 8, 0, 100)}px;font-weight:600;font-size:15px;">${safeText(bc.text)}</a></div>`;
    }
    case 'divider': {
      const dc = c as DividerContent;
      const style = dc.style === 'dashed' || dc.style === 'dotted' ? dc.style : 'solid';
      return `<hr style="border:none;border-top:${safeNumber(dc.thickness, 1, 0, 50)}px ${style} ${safeColor(dc.color, '#e5e7eb')};width:${safeSize(dc.width, '100%')};margin:0 auto;" />`;
    }
    case 'spacer': {
      const sc = c as SpacerContent;
      const height = safeNumber(sc.height, 32, 0, 500);
      return `<div style="height:${height}px;line-height:${height}px;">&nbsp;</div>`;
    }
    case 'html': {
      return safeHtml((c as HtmlContent).html);
    }
    case 'columns': {
      const cc = c as ColumnsContent;
      const cols = (Array.isArray(cc.columns) ? cc.columns : []).map(col =>
        `<td style="width:${safeSize(col.width, '50%')};vertical-align:top;padding:0 8px;">${blocksToHtml(col.blocks)}</td>`
      ).join('');
      return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${cols}</tr></table>`;
    }
    default:
      return '';
  }
}
