// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductTour, type TourTab } from '@/components/marketing/product-tour';
import React from 'react';

// Mock dependencies
vi.mock('next/link', () => ({
  default: ({ children, href, className }: any) => (
    <a href={href} className={className} data-testid="next-link">
      {children}
    </a>
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
    visual: <div data-testid="visual-1">Visual 1</div>,
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
    visual: <div data-testid="visual-2">Visual 2</div>,
  },
];

describe('ProductTour', () => {
  it('renders the first tab as active by default', () => {
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
    expect(screen.getByTestId('visual-1')).toBeInTheDocument();

    // Check link
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/tab-one');
    expect(link).toHaveTextContent(/Go deeper on/i);

    // Check that tab two content is not visible
    expect(screen.queryByText('Tab Two Title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visual-2')).not.toBeInTheDocument();
  });

  it('switches to the second tab when clicked', () => {
    render(<ProductTour tabs={mockTabs} />);

    const tab2 = screen.getByRole('tab', { name: /Tab Two Label/i });
    fireEvent.click(tab2);

    expect(screen.getByRole('tab', { name: /Tab One Label/i })).toHaveAttribute('aria-selected', 'false');
    expect(tab2).toHaveAttribute('aria-selected', 'true');

    expect(screen.getByText('Tab Two Title')).toBeInTheDocument();
    expect(screen.getByText('Tab Two Body text.')).toBeInTheDocument();
    expect(screen.getByText('Point 2A')).toBeInTheDocument();
    expect(screen.getByTestId('visual-2')).toBeInTheDocument();
    expect(screen.queryByTestId('visual-1')).not.toBeInTheDocument();
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
