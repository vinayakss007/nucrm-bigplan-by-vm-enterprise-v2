// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DocsClient from '@/components/tenant/docs-client';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/docs',
}));

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockImplementation(() => Promise.resolve()),
  },
});

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DocsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders documentation index and categories', () => {
    render(<DocsClient />);

    expect(screen.getByText('NuCRM Documentation')).toBeDefined();
    expect(screen.getByPlaceholderText(/search documentation/i)).toBeDefined();
    expect(screen.getAllByText('Getting Started').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deployment').length).toBeGreaterThan(0);
  });

  it('displays deployment guide with real deployment content and alerts', () => {
    render(<DocsClient initialDoc="deployment/guide" />);

    // Must show deployment heading, not "Getting Started with NuCRM"
    expect(screen.getByRole('heading', { level: 1, name: /production deployment guide/i })).toBeDefined();

    // Must have rendered alerts
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.getByText(/architecture overview/i)).toBeDefined();
  });

  it('displays docker deployment documentation with volume persistence warning', () => {
    render(<DocsClient initialDoc="deployment/docker" />);

    const headings = screen.getAllByRole('heading', { level: 1, name: /docker deployment/i });
    expect(headings.length).toBeGreaterThan(0);
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('displays environment variables reference with table', () => {
    render(<DocsClient initialDoc="deployment/env" />);

    expect(screen.getByRole('heading', { level: 1, name: /environment variables reference/i })).toBeDefined();
    expect(screen.getByText('DATABASE_URL')).toBeDefined();
    expect(screen.getByText('REDIS_URL')).toBeDefined();
  });

  it('displays backup and disaster recovery guide', () => {
    render(<DocsClient initialDoc="deployment/backup" />);

    expect(screen.getByRole('heading', { level: 1, name: /backup & disaster recovery/i })).toBeDefined();
    expect(screen.getByText(/automated backups/i)).toBeDefined();
  });

  it('displays first-time setup guide with onboarding steps', () => {
    render(<DocsClient initialDoc="users/first-setup" />);

    expect(screen.getByRole('heading', { level: 1, name: /first-time workspace setup guide/i })).toBeDefined();
    expect(screen.getByText(/1\. Company Profile & Regional Settings/i)).toBeDefined();
    expect(screen.getByText(/4\. Invite Your Team Members/i)).toBeDefined();
  });

  it('supports search query filtering', () => {
    render(<DocsClient />);

    const searchInput = screen.getByPlaceholderText(/search documentation/i);
    fireEvent.change(searchInput, { target: { value: 'Docker' } });

    expect(screen.getByText(/search results for "docker"/i)).toBeDefined();
  });

  it('displays distinct billing documentation sections', () => {
    const { unmount: u1 } = render(<DocsClient initialDoc="billing/services" />);
    expect(screen.getAllByRole('heading', { level: 1, name: /services & product catalog/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 2, name: /price books & multi-currency/i }).length).toBeGreaterThan(0);
    u1();

    const { unmount: u2 } = render(<DocsClient initialDoc="billing/invoices" />);
    expect(screen.getAllByRole('heading', { level: 1, name: /invoices & billing/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 2, name: /invoice lifecycle/i }).length).toBeGreaterThan(0);
    u2();

    const { unmount: u3 } = render(<DocsClient initialDoc="billing/orders" />);
    expect(screen.getAllByRole('heading', { level: 1, name: /sales orders & fulfillment/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 2, name: /order management workflow/i }).length).toBeGreaterThan(0);
    u3();

    const { unmount: u4 } = render(<DocsClient initialDoc="billing/contracts" />);
    expect(screen.getAllByRole('heading', { level: 1, name: /contracts & sla agreements/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 2, name: /automated renewal alerts/i }).length).toBeGreaterThan(0);
    u4();

    const { unmount: u5 } = render(<DocsClient initialDoc="billing/subscriptions" />);
    expect(screen.getAllByRole('heading', { level: 1, name: /subscriptions & recurring revenue/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 2, name: /subscription models/i }).length).toBeGreaterThan(0);
    u5();

    const { unmount: u6 } = render(<DocsClient initialDoc="billing/payments" />);
    expect(screen.getAllByRole('heading', { level: 1, name: /payments & ledger/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 2, name: /append-only payment ledger/i }).length).toBeGreaterThan(0);
    u6();
  });
});
