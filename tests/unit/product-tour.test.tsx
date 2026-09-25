// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProductTour, type TourTab } from '@/components/marketing/product-tour';
import React from 'react';

// Mock dependencies
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} data-testid="next-link">
      {children}
    </a>
  ),
}));

// #1972: visuals moved behind a next/dynamic ssr:false island keyed by a
// string. Stub the loader so the resolved component renders synchronously
// enough for act(), and stub TourVisual itself (the real one imports mocks).
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
    function DynamicMock(props: Record<string, unknown>) {
      const [Comp, setComp] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null);
      React.useEffect(() => {
        let alive = true;
        void loader().then((m) => { if (alive) setComp(() => m.default); });
        return () => { alive = false; };
      }, []);
      if (!Comp) return null;
      return React.createElement(Comp, props);
    }
    return DynamicMock;
  },
}));

vi.mock('@/components/marketing/tour-visual', () => ({
  default: ({ name }: { name: string }) => (
    <div data-testid={`visual-${name}`}>{name}</div>
  ),
}));

const mockTabs: TourTab[] = [
  {
    id: 'tab-1',
    label: 'Tab One Label',
    icon: 'Target',
    accent: 'from-blue-500 to-blue-600',
    title: 'Tab One Title',
    body: 'Tab One Body text.',
    points: ['Point 1A', 'Point 1B'],
    href: '/tab-one',
    visual: 'ai',
  },
  {
    id: 'tab-2',
    label: 'Tab Two Label',
    icon: 'Users',
    accent: 'from-green-500 to-green-600',
    title: 'Tab Two Title',
    body: 'Tab Two Body text.',
    points: ['Point 2A'],
    href: '/tab-two',
    visual: 'automation',
  },
];

describe('ProductTour', () => {
  it('renders the first tab as active by default', async () => {
    render(<ProductTour tabs={mockTabs} />);

    // Check tabs
    const tab1 = screen.getByRole('tab', { name: /Tab One Label/i });
    const tab2 = screen.getByRole('tab', { name: /Tab Two Label/i });

    expect(tab1).toHaveAttribute('aria-selected', 'true');
    expect(tab2).toHaveAttribute('aria-selected', 'false');

    // Check content
    expect(screen.getByText('Tab One Title')).toBeInTheDocument();
    expect(screen.getByText('Tab One Body text.')).toBeInTheDocument();
    expect(screen.getByText('Point 1A')).toBeInTheDocument();
    expect(screen.getByText('Point 1B')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('visual-ai')).toBeInTheDocument());

    // Check link
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/tab-one');
    expect(link).toHaveTextContent(/Go deeper on/i);

    // Check that tab two content is not visible
    expect(screen.queryByText('Tab Two Title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visual-automation')).not.toBeInTheDocument();
  });

  it('switches to the second tab when clicked', async () => {
    render(<ProductTour tabs={mockTabs} />);
    await waitFor(() => expect(screen.getByTestId('visual-ai')).toBeInTheDocument());

    const tab2 = screen.getByRole('tab', { name: /Tab Two Label/i });
    fireEvent.click(tab2);

    expect(screen.getByRole('tab', { name: /Tab One Label/i })).toHaveAttribute('aria-selected', 'false');
    expect(tab2).toHaveAttribute('aria-selected', 'true');

    expect(screen.getByText('Tab Two Title')).toBeInTheDocument();
    expect(screen.getByText('Tab Two Body text.')).toBeInTheDocument();
    expect(screen.getByText('Point 2A')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('visual-automation')).toBeInTheDocument());
    expect(screen.queryByTestId('visual-ai')).not.toBeInTheDocument();
  });

  it('applies correct ARIA attributes', () => {
    render(<ProductTour tabs={mockTabs} />);

    const tablist = screen.getByRole('tablist');
    expect(tablist).toHaveAttribute('aria-label', 'Product walkthrough');

    const tab1 = screen.getByRole('tab', { name: /Tab One Label/i });
    expect(tab1).toHaveAttribute('aria-controls', 'tour-panel-tab-1');

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'tour-panel-tab-1');
  });

  it('renders gracefully when tabs array is empty', () => {
    render(<ProductTour tabs={[]} />);

    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });
});
