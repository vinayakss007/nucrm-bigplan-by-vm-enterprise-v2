/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
