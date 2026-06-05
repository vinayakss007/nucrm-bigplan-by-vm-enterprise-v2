import { describe, it, expect } from 'vitest';
import { getWidget, getWidgetsForPlan, getAllWidgets, WIDGET_REGISTRY } from '@/components/tenant/dashboard/widget-registry';

describe('widget-registry', () => {
  it('registers all P0 widgets', () => {
    const ids = Object.keys(WIDGET_REGISTRY);
    expect(ids).toContain('stats-contacts');
    expect(ids).toContain('stats-pipeline');
    expect(ids).toContain('stats-revenue');
    expect(ids).toContain('stats-tasks');
    expect(ids).toContain('activity-feed');
    expect(ids).toContain('tasks-list');
    expect(ids).toContain('deals-closing');
    expect(ids).toContain('contacts-recent');
  });

  it('getWidget returns correct config', () => {
    const w = getWidget('stats-contacts');
    expect(w).toBeDefined();
    expect(w!.id).toBe('stats-contacts');
    expect(w!.category).toBe('core');
    expect(w!.minPlan).toBe('free');
    expect(w!.defaultSize).toBe('1x1');
    expect(w!.apiEndpoint).toBeTruthy();
  });

  it('getWidget returns undefined for unknown widget', () => {
    expect(getWidget('non-existent')).toBeUndefined();
  });

  it('getAllWidgets returns all registered widgets', () => {
    const all = getAllWidgets();
    expect(all.length).toBe(Object.keys(WIDGET_REGISTRY).length);
  });

  it('getWidgetsForPlan returns correct count for free plan', () => {
    const freeWidgets = getWidgetsForPlan('free');
    expect(freeWidgets.length).toBe(8);
    freeWidgets.forEach(w => expect(w.minPlan).toBe('free'));
  });

  it('getWidgetsForPlan includes more widgets for higher plans', () => {
    const free = getWidgetsForPlan('free');
    const starter = getWidgetsForPlan('starter');
    const pro = getWidgetsForPlan('pro');
    const enterprise = getWidgetsForPlan('enterprise');

    expect(starter.length).toBeGreaterThanOrEqual(free.length);
    expect(pro.length).toBeGreaterThanOrEqual(starter.length);
    expect(enterprise.length).toBeGreaterThanOrEqual(pro.length);
  });

  it('getWidgetsForPlan falls back to free for unknown plan', () => {
    const widgets = getWidgetsForPlan('unknown-plan');
    expect(widgets.length).toBe(8);
    widgets.forEach(w => expect(w.minPlan).toBe('free'));
  });

  it('each widget has required fields', () => {
    getAllWidgets().forEach(w => {
      expect(w.id).toBeTruthy();
      expect(w.name).toBeTruthy();
      expect(w.description).toBeTruthy();
      expect(w.category).toBeTruthy();
      expect(['1x1', '2x1', '1x2', '2x2']).toContain(w.defaultSize);
      expect(w.minPlan).toBeTruthy();
      expect(w.refreshInterval).toBeGreaterThan(0);
      expect(w.apiEndpoint).toMatch(/^\/api\/tenant\/dashboard\/widgets\//);
    });
  });
});
