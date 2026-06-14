import { requireTenantCtx } from '@/lib/tenant/context';
import { PRODUCT_REGISTRY } from '@/lib/products/registry';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  FileText, Brain, MessageCircle, LifeBuoy, Users, Home, ShoppingCart, Receipt,
  ArrowRight,
} from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, any> = {
  FileText, Brain, MessageCircle, LifeBuoy, Users, Home, ShoppingCart, Receipt,
};

export default async function ProductsPage() {
  let ctx;
  try {
    ctx = await requireTenantCtx();
  } catch {
    redirect('/auth/login');
  }
  if (!ctx) redirect('/auth/login');

  const products = Object.values(PRODUCT_REGISTRY);

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Product entry points and industry templates for your CRM.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map(p => {
          const Icon = ICON_MAP[p.icon] ?? FileText;
          return (
            <Link
              key={p.id}
              href={`/tenant/products/${p.templateId}`}
              className="rounded-xl border border-border bg-card p-5 hover:shadow-md hover:border-violet-300 dark:hover:border-violet-700 transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                    {p.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-violet-600 shrink-0 mt-1 transition-colors" />
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
                <span className="px-2 py-0.5 rounded-full bg-muted">{p.mainPipeline}</span>
                <span>{p.sidebarItems.length} modules</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
