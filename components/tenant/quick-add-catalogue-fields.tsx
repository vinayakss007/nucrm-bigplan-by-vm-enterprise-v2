/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useEffect, useState } from 'react';
import { clientLogWarn } from '@/lib/client-logger';
import { fetchJsonSafe } from '@/lib/fetch-json';
import InlineErrorState from '@/components/shared/inline-error-state';

interface ProductOpt { id: string; name: string; price?: number | string | null }
interface ServiceOpt { id: string; name: string }

interface Props {
  productId: string;
  serviceId: string;
  onProductChange: (id: string) => void;
  onServiceChange: (id: string) => void;
  inputClassName: string;
  labelClassName: string;
  formatPrice: (price: number | string) => string;
}

export default function QuickAddCatalogueFields({
  productId, serviceId, onProductChange, onServiceChange,
  inputClassName, labelClassName, formatPrice,
}: Props) {
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [services, setServices] = useState<ServiceOpt[]>([]);
  const [catalogError, setCatalogError] = useState<{ products?: string; services?: string }>({});
  const [catalogReload, setCatalogReload] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetchJsonSafe<{ data?: ProductOpt[] }>('/api/tenant/products?limit=200', { signal: abort.signal })
      .then(r => {
        if (abort.signal.aborted) return;
        if (r.status === 'ok') {
          setProducts(r.data.data ?? []);
          setCatalogError(prev => {
            if (!prev.products) return prev;
            const next = { ...prev };
            delete next.products;
            return next;
          });
        } else if (r.status === 'error') {
          setCatalogError(prev => ({ ...prev, products: r.message }));
          clientLogWarn('leads', 'Failed to load products', r.message);
        }
      });
    fetchJsonSafe<{ data?: ServiceOpt[]; services?: ServiceOpt[] }>('/api/tenant/services?limit=200', { signal: abort.signal })
      .then(r => {
        if (abort.signal.aborted) return;
        if (r.status === 'ok') {
          setServices(r.data.data ?? r.data.services ?? []);
          setCatalogError(prev => {
            if (!prev.services) return prev;
            const next = { ...prev };
            delete next.services;
            return next;
          });
        } else if (r.status === 'error') {
          setCatalogError(prev => ({ ...prev, services: r.message }));
          clientLogWarn('leads', 'Failed to load services', r.message);
        }
      });
    return () => abort.abort();
  }, [catalogReload]);

  const retry = () => setCatalogReload(n => n + 1);

  return (
    <>
      {catalogError.products && (
        <div className="col-span-2">
          <InlineErrorState
            message={`Products could not be loaded — ${catalogError.products}. "No product" below does not mean none exist.`}
            onRetry={retry}
          />
        </div>
      )}
      {catalogError.services && (
        <div className="col-span-2">
          <InlineErrorState
            message={`Services could not be loaded — ${catalogError.services}. "No service" below does not mean none exist.`}
            onRetry={retry}
          />
        </div>
      )}
      <div>
        <label className={labelClassName}>Product</label>
        <select className={inputClassName} value={productId} onChange={e => onProductChange(e.target.value)}>
          <option value="">{catalogError.products ? 'Products unavailable — see error above' : 'No product'}</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.name}{p.price ? ` — ${formatPrice(p.price)}` : ''}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClassName}>Service</label>
        <select className={inputClassName} value={serviceId} onChange={e => onServiceChange(e.target.value)}>
          <option value="">{catalogError.services ? 'Services unavailable — see error above' : 'No service'}</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    </>
  );
}
