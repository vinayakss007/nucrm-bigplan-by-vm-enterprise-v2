// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Alert, AlertTitle, AlertDescription, alertVariants } from '@/components/ui/alert';

describe('Alert Component', () => {
  it('renders default alert with role="alert"', () => {
    render(
      <Alert>
        <AlertTitle>Notice</AlertTitle>
        <AlertDescription>This is a notice description</AlertDescription>
      </Alert>
    );

    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeDefined();
    expect(screen.getByText('Notice')).toBeDefined();
    expect(screen.getByText('This is a notice description')).toBeDefined();
  });

  it('renders variants with expected style classes', () => {
    const variants = ['info', 'warning', 'destructive', 'success', 'tip'] as const;

    variants.forEach((v) => {
      const { unmount } = render(
        <Alert variant={v} data-testid={`alert-${v}`}>
          <AlertTitle>{v} Title</AlertTitle>
          <AlertDescription>{v} content</AlertDescription>
        </Alert>
      );

      const el = screen.getByTestId(`alert-${v}`);
      expect(el).toBeDefined();
      expect(el.getAttribute('role')).toBe('alert');
      unmount();
    });
  });

  it('computes classes via alertVariants helper', () => {
    const infoClass = alertVariants({ variant: 'info' });
    expect(infoClass).toContain('border-blue-500');

    const warningClass = alertVariants({ variant: 'warning' });
    expect(warningClass).toContain('border-amber-500');

    const errorClass = alertVariants({ variant: 'destructive' });
    expect(errorClass).toContain('border-destructive');

    const tipClass = alertVariants({ variant: 'tip' });
    expect(tipClass).toContain('border-violet-500');

    const successClass = alertVariants({ variant: 'success' });
    expect(successClass).toContain('border-emerald-500');
  });
});
