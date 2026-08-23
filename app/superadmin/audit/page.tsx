/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import AuditLogClient from '@/components/superadmin/audit-log-client';

export const metadata = { title: 'Super Admin Audit Log' };

export default function SuperAdminAuditPage() {
  return <AuditLogClient />;
}
