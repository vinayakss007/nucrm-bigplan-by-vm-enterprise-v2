// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed industry-templates query used to hide the Active Modules
 * section entirely, indistinguishable from a product with no template.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const query = vi.hoisted(() => ({ data: [] as unknown, isError: false, refetch: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: query.data, isError: query.isError, refetch: query.refetch }),
}));

import ProductEntryClient from '@/components/tenant/product-entry-client';

const product = {
  id: 'sales', name: 'Sales Starter', description: 'Sell more', icon: 'TrendingUp',
  templateId: 'sales', route: '/tenant/sales', mainPipeline: 'Sales Pipeline',
  dashboardCards: [{ title: 'Deals', stat_key: 'deals', icon: 'Target' }],
  sidebarItems: [], quickActions: [],
};
const aTemplate = {
  id: 'T1', slug: 'sales', name: 'Sales', modules: ['CRM'],
  pipelines: [{ name: 'Sales Pipeline', stages: ['New'] }],
};
const mount = () => render(<ProductEntryClient product={product} tenantId="T1" userId="U1" />);

beforeEach(() => {
  query.data = [];
  query.isError = false;
  query.refetch.mockClear();
});

describe('#3408: product entry distinguishes a failed templates read from no template', () => {
  it('a failed query shows an explicit error with retry', () => {
    query.isError = true;
    mount();
    expect(screen.getByText(/Module information could not be loaded/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('a genuine empty result does not show the error', () => {
    mount();
    expect(screen.queryByText(/Module information could not be loaded/)).toBeNull();
  });

  it('a successful query still renders the Active Modules section', () => {
    query.data = [aTemplate];
    mount();
    expect(screen.getByText('Active Modules')).toBeTruthy();
    expect(screen.queryByText(/Module information could not be loaded/)).toBeNull();
  });
});
