// Re-export all domain schemas from a single entry point.
// This preserves backward compatibility with `import { ... } from '@/lib/api/schemas'`.

export * from './common';
export * from './crm';
export * from './billing';
export * from './support';
export * from './automation';
export * from './admin';
export * from './superadmin';
export * from './auth';
export * from './user';
export * from './import-export';
export * from './projects';
export * from './public';
export * from './ai';
