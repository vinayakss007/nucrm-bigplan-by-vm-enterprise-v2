import { requireTenantCtx } from '@/lib/tenant/context';
import { PRODUCT_REGISTRY } from '@/lib/products/registry';
import { notFound } from 'next/navigation';
import ProductEntryClient from '@/components/tenant/product-entry-client';

export default async function ProductEntryPage({ params }: { params: Promise<{ templateId: string }> }) {
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
}
