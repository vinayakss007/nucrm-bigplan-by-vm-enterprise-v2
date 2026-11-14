// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { DocsMarkdown, resolveDocLink } from '@/components/tenant/docs-markdown';

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

describe('DocsMarkdown Component', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders headings and paragraph text', () => {
    const md = `
# Main Title
## Subtitle Section
This is normal paragraph text.
`;
    render(<DocsMarkdown content={md} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Main Title');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Subtitle Section');
    expect(screen.getByText('This is normal paragraph text.')).toBeDefined();
  });

  it('renders GitHub-style alerts for [!NOTE] and [!WARNING]', () => {
    const md = `
> [!NOTE]
> This is a helpful note for administrators.

> [!WARNING]
> This is a critical warning about data loss.
`;
    render(<DocsMarkdown content={md} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBe(2);

    expect(screen.getByText('Note')).toBeDefined();
    expect(screen.getByText('This is a helpful note for administrators.')).toBeDefined();

    expect(screen.getByText('Warning')).toBeDefined();
    expect(screen.getByText('This is a critical warning about data loss.')).toBeDefined();
  });

  it('renders GitHub-style alerts for [!TIP], [!IMPORTANT], and [!CAUTION]', () => {
    const md = `
> [!TIP]
> Use keyboard shortcuts to speed up entry.

> [!IMPORTANT]
> Verify your email before generating API keys.

> [!CAUTION]
> Dropping schemas is permanent.
`;
    render(<DocsMarkdown content={md} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBe(3);

    expect(screen.getByText('Tip')).toBeDefined();
    expect(screen.getByText('Use keyboard shortcuts to speed up entry.')).toBeDefined();

    expect(screen.getByText('Important')).toBeDefined();
    expect(screen.getByText('Verify your email before generating API keys.')).toBeDefined();

    expect(screen.getByText('Caution')).toBeDefined();
    expect(screen.getByText('Dropping schemas is permanent.')).toBeDefined();
  });

  it('renders regular blockquotes as styled callouts', () => {
    const md = `
> **Audience:** workspace owners and developers.
`;
    const { container } = render(<DocsMarkdown content={md} />);

    expect(screen.getByText('Audience:')).toBeDefined();
    expect(screen.getByText(/workspace owners and developers/)).toBeDefined();
    const callout = container.querySelector('.border-l-4');
    expect(callout).not.toBeNull();
  });

  it('renders code blocks with language badge and copy button', () => {
    const md = `
\`\`\`bash
npm run dev
\`\`\`
`;
    render(<DocsMarkdown content={md} />);

    expect(screen.getByText('BASH')).toBeDefined();
    expect(screen.getByText('npm run dev')).toBeDefined();

    const copyBtn = screen.getByRole('button', { name: /copy code/i });
    expect(copyBtn).toBeDefined();

    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('npm run dev');
  });

  it('renders tables with gfm support', () => {
    const md = `
| Endpoint | Method |
| --- | --- |
| /api/contacts | GET |
`;
    render(<DocsMarkdown content={md} />);

    expect(screen.getByText('Endpoint')).toBeDefined();
    expect(screen.getByText('Method')).toBeDefined();
    expect(screen.getByText('/api/contacts')).toBeDefined();
    expect(screen.getByText('GET')).toBeDefined();
  });

  it('renders external links with target="_blank"', () => {
    const md = `[NuCRM Repo](https://github.com/vinayakss007/nucrm)`;
    render(<DocsMarkdown content={md} />);

    const link = screen.getByRole('link', { name: /NuCRM Repo/i });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('resolves relative .md links to internal NuCRM documentation slugs', () => {
    expect(resolveDocLink('./user-guide/contacts-and-companies.md')).toEqual({
      href: '/docs/users/contacts',
      isExternal: false,
      isAnchor: false,
      slug: 'users/contacts',
    });

    expect(resolveDocLink('./user-guide/deals-and-pipelines.md#forecasting')).toEqual({
      href: '/docs/users/deals#forecasting',
      isExternal: false,
      isAnchor: false,
      slug: 'users/deals',
    });

    expect(resolveDocLink('../admin-guide/security-settings.md')).toEqual({
      href: '/docs/security/overview',
      isExternal: false,
      isAnchor: false,
      slug: 'security/overview',
    });

    expect(resolveDocLink('../customer-portal.md')).toEqual({
      href: '/docs/support/faq',
      isExternal: false,
      isAnchor: false,
      slug: 'support/faq',
    });

    expect(resolveDocLink('../../../public/api/openapi.yaml')).toEqual({
      href: '/api-docs',
      isExternal: false,
      isAnchor: false,
    });
  });

  it('invokes onNavigate when clicking an internal documentation link', () => {
    const onNavigate = vi.fn();
    const md = `See [Contacts Guide](./user-guide/contacts-and-companies.md) for details.`;
    render(<DocsMarkdown content={md} onNavigate={onNavigate} />);

    const link = screen.getByRole('link', { name: /Contacts Guide/i });
    expect(link.getAttribute('href')).toBe('/docs/users/contacts');

    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('users/contacts');
  });

  it('renders extended alert types and handles leading whitespace', () => {
    const md = `
>  [!NOTE]
> Leading space note text.

> [!INFO]
> Informational notice.

> [!DANGER]
> Hazardous action.

> **Warning:** This is an inline warning.
`;
    render(<DocsMarkdown content={md} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBe(4);

    expect(screen.getByText('Leading space note text.')).toBeDefined();
    expect(screen.getByText('Informational notice.')).toBeDefined();
    expect(screen.getByText('Hazardous action.')).toBeDefined();
    expect(screen.getByText('This is an inline warning.')).toBeDefined();
  });
});
