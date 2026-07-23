import { describe, it, expect } from 'vitest';
import { defineModule } from '@/lib/modules/sdk/types';

describe('defineModule', () => {
  it('returns the manifest as-is', () => {
    const manifest = {
      id: 'test-module',
      name: 'Test Module',
      version: '1.0.0',
      description: 'A test module',
      category: 'utility' as const,
      icon: '🧪',
      pricing: { free: { enabled: true } },
      features: ['Feature A', 'Feature B'],
    };
    const result = defineModule(manifest);
    expect(result).toBe(manifest);
    expect(result.id).toBe('test-module');
    expect(result.name).toBe('Test Module');
  });

  it('preserves all manifest fields', () => {
    const manifest = {
      id: 'full-module',
      name: 'Full Module',
      version: '2.0.0',
      description: 'Module with all fields',
      author: 'Test Author',
      category: 'messaging' as const,
      icon: '💬',
      minCrmVersion: '1.5.0',
      pricing: { free: { enabled: false }, pro: { enabled: true, price: 29 } },
      features: ['Messaging', 'Templates'],
      permissions: ['msg.send', 'msg.read'],
      pages: [{ path: '/tenant/msg', label: 'Messages', icon: 'MessageSquare' }],
      settings_schema: [{ key: 'api_key', label: 'API Key', type: 'password' as const, required: true }],
      webhooks: ['msg.received'],
      migrations: './migrations/msg',
      dependsOn: ['core-crm'],
    };
    const result = defineModule(manifest);
    expect(result.author).toBe('Test Author');
    expect(result.minCrmVersion).toBe('1.5.0');
    expect(result.permissions).toEqual(['msg.send', 'msg.read']);
    expect(result.pages).toHaveLength(1);
    expect(result.settings_schema).toHaveLength(1);
    expect(result.webhooks).toEqual(['msg.received']);
    expect(result.dependsOn).toEqual(['core-crm']);
  });

  it('works with minimal manifest', () => {
    const manifest = {
      id: 'minimal',
      name: 'Minimal',
      version: '0.1.0',
      description: 'Minimal',
      category: 'ai' as const,
      icon: '🤖',
      pricing: {},
      features: [],
    };
    const result = defineModule(manifest);
    expect(result.id).toBe('minimal');
    expect(result.author).toBeUndefined();
    expect(result.pages).toBeUndefined();
  });

  it('handles all valid categories', () => {
    const categories = ['utility', 'automation', 'messaging', 'integration', 'ai', 'analytics'] as const;
    for (const cat of categories) {
      const manifest = {
        id: `mod-${cat}`,
        name: cat,
        version: '1.0.0',
        description: cat,
        category: cat,
        icon: '📦',
        pricing: {},
        features: [],
      };
      const result = defineModule(manifest);
      expect(result.category).toBe(cat);
    }
  });
});
