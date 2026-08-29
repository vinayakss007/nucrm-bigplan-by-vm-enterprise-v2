/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { PRODUCT_REGISTRY } from '@/lib/products/registry';
import { notFound } from 'next/navigation';
import ProductEntryClient from '@/components/tenant/product-entry-client';
import { withTenantScope } from '@/lib/api/with-api-route';

export default async function ProductEntryPage({ params }: { params: Promise<{ templateId: string }> }) {
  return withTenantScope(async () => {
  const ctx = await requireTenantCtx();
  const { templateId } = await params;

  const product = PRODUCT_REGISTRY[templateId];
  if (!product) {
    notFound();
  }

  return (
    <ProductEntryClient
      product={product}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );

  });
}
