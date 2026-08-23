/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import {
  Plus, Search, Trash2, X, Package, Edit2, ChevronDown,
  FileText, Brain, MessageCircle, LifeBuoy, Users, Home, ShoppingCart, Receipt,
  LayoutDashboard, Target, Briefcase, Calendar, GitBranch, Copy, Send,
  UserPlus, Mail, BarChart, Radio, Filter, Upload, Heart, Rocket,
  Zap, DollarSign, Clock, CheckCircle, AlertTriangle, Shield, Eye, Award,
  Star, AlertCircle, CreditCard, Book, Ticket, TrendingUp, ArrowRight,
} from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { PRODUCT_REGISTRY } from '@/lib/products/registry';
import Link from 'next/link';
import toast from 'react-hot-toast';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText, Brain, MessageCircle, LifeBuoy, Users, Home, ShoppingCart, Receipt,
  LayoutDashboard, Target, Briefcase, Calendar, GitBranch, Copy, Send,
  UserPlus, Plus, Mail, BarChart, Radio, Filter, Upload, Heart, Rocket,
  Zap, DollarSign, Clock, CheckCircle, AlertTriangle, Shield, Eye, Award,
  Star, AlertCircle, CreditCard, Book, Ticket, TrendingUp, Package, ArrowRight,
};

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  base_price: string;
  created_at: string;
  updated_at: string;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState({ name: '', description: '', sku: '', base_price: '' });

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/tenant/products?limit=200');
      const data = await res.json();
      setProducts(data.data || []);
    } catch {
      // Failed to load products
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setForm({ name: '', description: '', sku: '', base_price: '' });
    setEditingProduct(null);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      description: product.description || '',
      sku: product.sku || '',
      base_price: product.base_price || '0',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingProduct
        ? `/api/tenant/products/${editingProduct.id}`
        : '/api/tenant/products';
      const method = editingProduct ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          sku: form.sku || null,
          base_price: parseFloat(form.base_price) || 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save product');
      }
      toast.success(editingProduct ? 'Product updated' : 'Product created');
      setShowModal(false);
      resetForm();
      fetchProducts();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to save product');
    }
  };

  const deleteProduct = async (product: Product) => {
    await confirmThen(`Delete product "${product.name}"?`, async () => {
      try {
        const res = await fetch(`/api/tenant/products/${product.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete');
        toast.success('Product deleted');
        fetchProducts();
      } catch {
        toast.error('Failed to delete product');
      }
    });
  };

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.sku && p.sku.toLowerCase().includes(search.toLowerCase())) ||
    (p.description && p.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Products</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage your product catalog</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-xs sm:text-sm shrink-0"
        >
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add Product</span><span className="sm:hidden">Add</span>
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search products by name, SKU, or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium">
            {search ? 'No products match your search' : 'No products yet. Add your first product!'}
          </p>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <div className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0">
            <table className="w-full min-w-[600px]">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">SKU</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Price</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Created</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((product) => (
                  <tr key={product.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm">{product.name}</p>
                      {product.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{product.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs font-mono text-muted-foreground">{product.sku || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold">${parseFloat(product.base_price || '0').toFixed(2)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                      {product.created_at ? new Date(product.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(product)}
                          className="p-1.5 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteProduct(product)}
                          className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors text-muted-foreground hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-2 border-t border-border bg-muted/10">
              <p className="text-xs text-muted-foreground">
                {filtered.length} product{filtered.length !== 1 ? 's' : ''}
                {search && ` matching "${search}"`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Industry Templates */}
      {!search && (
        <details className="group">
          <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors select-none">
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
            Industry Templates &amp; Product Entry Points
            <span className="text-xs font-normal">({Object.keys(PRODUCT_REGISTRY).length})</span>
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
            {Object.values(PRODUCT_REGISTRY).map(p => {
              const Icon = ICON_MAP[p.icon] ?? Package;
              return (
                <Link
                  key={p.id}
                  href={`/tenant/products/${p.templateId}`}
                  className="rounded-xl border border-border bg-card p-4 hover:shadow-md hover:border-violet-300 dark:hover:border-violet-700 transition-all group/link"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm group-hover/link:text-violet-600 dark:group-hover/link:text-violet-400 transition-colors">
                        {p.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.description}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover/link:text-violet-600 shrink-0 mt-1 transition-colors" />
                  </div>
                  <div className="mt-2 pt-2 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="px-1.5 py-0.5 rounded bg-muted">{p.mainPipeline}</span>
                    <span>{p.sidebarItems.length} modules</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </details>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base sm:text-lg font-semibold">{editingProduct ? 'Edit Product' : 'Add Product'}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-1 hover:bg-accent rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Product Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm"
                  placeholder="e.g. Widget Pro"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm"
                  placeholder="Brief description of the product"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">SKU</label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm"
                    placeholder="e.g. WDG-PRO-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Base Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.base_price}
                    onChange={(e) => setForm({ ...form, base_price: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="flex-1 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700"
                >
                  {editingProduct ? 'Update' : 'Create'} Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
