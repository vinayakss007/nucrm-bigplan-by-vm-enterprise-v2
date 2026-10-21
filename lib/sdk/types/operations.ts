/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * NuCRM SDK — non-entity surface: bulk results, search, file upload,
 * realtime events, billing/usage, and the template/module catalog.
 */

// ─── Bulk Operations ────────────────────────────────────────────────────────

export interface BulkCreateResult {
  created: number;
  errors: Array<{ index: number; error: string }>;
}

export interface BulkUpdateResult {
  updated: number;
}

export interface BulkDeleteResult {
  deleted: number;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export type SearchOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'between' | 'in';

export interface SearchFilter {
  field: string;
  operator: SearchOperator;
  value: unknown;
}

export interface SearchResult {
  id: string;
  entityType: string;
  title: string;
  subtitle?: string;
  score: number;
}

export interface SearchOptions {
  entities?: string[];
  limit?: number;
  offset?: number;
}

// ─── File Upload ────────────────────────────────────────────────────────────

export interface FileUploadInput {
  /** File name including extension */
  name: string;
  /**
   * File content as a string. For binary files, this must be base64-encoded.
   * Set `contentEncoding` to 'base64' (the default) so the server knows to decode it.
   */
  content: string;
  /** MIME type of the file (e.g. 'application/pdf', 'image/png') */
  mimeType: string;
  /**
   * Encoding of the content field. Defaults to 'base64'.
   * The server uses this to determine whether to decode the content.
   */
  contentEncoding?: 'base64' | 'utf8';
}

export interface FileUploadResult {
  id: string;
  url: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface FileDownloadResult {
  url: string;
  expiresAt: string;
}

// ─── Realtime Events ────────────────────────────────────────────────────────

export interface RealtimeEvent {
  type: string;
  channel: string;
  data: unknown;
  timestamp: string;
}

export type RealtimeEventHandler = (data: RealtimeEvent) => void;

// ─── Billing / Usage ────────────────────────────────────────────────────────

export interface PlanInfo {
  plan: string;
  limits: Record<string, number>;
  usage: Record<string, number>;
}

export interface LimitCheck {
  allowed: boolean;
  current: number;
  max: number;
}

export interface UsageReport {
  period: string;
  resources: Record<string, { used: number; limit: number }>;
}

// ─── Template / Module ──────────────────────────────────────────────────────

export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  modules: string[];
  features: string[];
}

export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
}
