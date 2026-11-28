// @vitest-environment jsdom
/**
 * #4089 — the locale switcher is mounted and changing it must change rendered
 * copy, not just a context value nobody consumes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider, useTranslation } from '@/lib/i18n/provider';
import LocaleSwitcher from '@/components/shared/locale-switcher';

function Probe() {
  const { t, locale } = useTranslation();
  return <div><span data-testid="copy">{t('notifications.viewAll')}</span><span data-testid="locale">{locale}</span></div>;
}

describe('#4089 language switching', () => {
  beforeEach(() => localStorage.clear());

  it('renders the default English copy', () => {
    render(<I18nProvider><Probe /><LocaleSwitcher /></I18nProvider>);
    expect(screen.getByTestId('copy').textContent).toBe('View all notifications');
  });

  it('switching to Spanish changes copy, context and persisted locale', async () => {
    render(<I18nProvider><Probe /><LocaleSwitcher /></I18nProvider>);
    fireEvent.change(screen.getByLabelText('Select language'), { target: { value: 'es' } });
    await waitFor(() => expect(screen.getByTestId('copy').textContent).toBe('Ver todas las notificaciones'));
    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(localStorage.getItem('nucrm_locale')).toBe('es');
  });

  it('only offers locales that ship translations', () => {
    render(<I18nProvider><Probe /><LocaleSwitcher /></I18nProvider>);
    const options = Array.from(screen.getByLabelText('Select language').querySelectorAll('option')).map(o => o.getAttribute('value'));
    expect(options).toEqual(['en', 'es', 'hi', 'mr']);
  });
});
