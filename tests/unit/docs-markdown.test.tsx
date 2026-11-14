// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DocsMarkdown } from '@/components/tenant/docs-markdown';

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
});
