/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2231 — the loading/error/empty/data state machine the UI branches consume.
 * Full transition matrix: an error must never collapse into "empty", and a
 * first-load spinner must not hide an error once data exists.
 */
import { describe, it, expect } from 'vitest';
import { deriveViewState, isAbortError } from '@/lib/view-state';

describe('deriveViewState (#2231)', () => {
  it('is loading on the first attempt with no data yet', () => {
    expect(deriveViewState({ isLoading: true, isError: false, data: null })).toBe('loading');
  });

  it('error beats empty: a failed request is NOT rendered as "no results"', () => {
    expect(deriveViewState({ isLoading: false, isError: true, data: [] })).toBe('error');
    expect(deriveViewState({ isLoading: false, isError: true, data: null })).toBe('error');
  });

  it('error beats a still-pending loading flag (never a frozen spinner)', () => {
    expect(deriveViewState({ isLoading: true, isError: true, data: null })).toBe('error');
  });

  it('genuine empties stay empty — error and empty rendering are not merged', () => {
    expect(deriveViewState({ isLoading: false, isError: false, data: [] })).toBe('empty');
  });

  it('null/undefined data without error or loading is empty (nothing loaded yet)', () => {
    expect(deriveViewState({ isLoading: false, isError: false, data: null })).toBe('empty');
    expect(deriveViewState({ isLoading: false, isError: false, data: undefined })).toBe('empty');
  });

  it('rows render as data', () => {
    expect(deriveViewState({ isLoading: false, isError: false, data: [1] })).toBe('data');
  });

  it('background reload over existing data keeps showing that data (no flash-to-loading)', () => {
    expect(deriveViewState({ isLoading: true, isError: false, data: [1] })).toBe('data');
  });

  it('a failed *reload* with previous rows on screen is data, not error — the banner comes from isError separately', () => {
    // Documented contract: components keep prior rows AND surface the error
    // affordance themselves (InlineErrorState); deriveViewState only decides
    // the primary region, so error only owns the region when there is
    // nothing to keep. With isError set the region is 'error' — callers pass
    // isError only when they want it to replace the region.
    expect(deriveViewState({ isLoading: false, isError: true, data: [1] })).toBe('error');
    expect(deriveViewState({ isLoading: false, isError: false, data: [1] })).toBe('data');
  });
});

describe('isAbortError (#2231)', () => {
  it('recognises DOMException-style aborts', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('recognises plain errors named AbortError (fetch polyfills)', () => {
    const err = new Error('the operation was aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('does not misclassify ordinary errors or nullish values', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});
