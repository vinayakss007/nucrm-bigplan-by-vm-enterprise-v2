// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the calendar never read `isError` from its three useQueries reads,
 * so a failed fetch rendered "0 events" and "No events" like a quiet day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ isError: false }));
vi.mock('@tanstack/react-query', () => ({
  useQueries: () => [0, 1, 2].map(() => ({ isLoading: false, isError: state.isError, data: { data: [] } })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-open-create-param', () => ({ useOpenCreateParam: () => {} }));

import CalendarPage from '@/app/tenant/calendar/page';

beforeEach(() => { state.isError = false; });

describe('#3408: calendar distinguishes failed reads from an empty day', () => {
  it('a failed read shows an explicit error banner', () => {
    state.isError = true;
    render(<CalendarPage />);
    expect(screen.getByText(/Calendar data could not be loaded/)).toBeTruthy();
    expect(screen.queryByText('No events')).toBeNull();
  });

  it('a genuine empty day still shows the normal empty state', () => {
    render(<CalendarPage />);
    expect(screen.queryByText(/Calendar data could not be loaded/)).toBeNull();
    expect(screen.getAllByText('No events').length).toBeGreaterThan(0);
  });
});
