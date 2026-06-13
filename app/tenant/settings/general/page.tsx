'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Save, Globe, Palette, Crown, Download, Loader2, ArrowUpRight,
  Link2, CheckCircle, AlertTriangle, Copy, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

const INDUSTRIES = ['','Technology','Healthcare','Finance','Education','Retail','Manufacturing','Real Estate','Consulting','Marketing','Legal','Other'];
const TIMEZONES  = ['UTC','America/New_York','America/Chicago','America/Los_Angeles','Europe/London','Europe/Paris','Europe/Berlin','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];
const CURRENCIES = ['USD','EUR','GBP','INR','AED','SGD','AUD','CAD','JPY'];

export default function TenantGeneralSettings() {
  const [tenant, setTenant] = useState<any>(null);
  const [form, setForm]     = useState({ name:'', primary_color:'#7c3aed', industry:'', subdomain:'', custom_domain:'', settings:{ timezone:'UTC', currency:'USD' } });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [checkingSubdomain, setCheckingSubdomain] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [subdomainAvailable, setSubdomainAvailable] = useState<boolean|null>(null);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  useEffect(() => {
  let ignore = false;
    fetch('/api/tenant/workspace').then(r=>r.json()).then(d=>{ if (ignore) return;
      if (d.data) {
        setTenant(d.data);
        setForm({
          name:d.data.name||'', primary_color:d.data.primary_color||'#7c3aed',
          industry:d.data.industry||'', subdomain:d.data.subdomain||'',
          custom_domain:d.data.custom_domain||'',
          settings:{ timezone:d.data.settings?.timezone||'UTC', currency:d.data.settings?.currency||'USD' }
        });
      }
    });
    return () => { ignore = true; };
}, []);

  const checkSubdomain = async (val: string) => {
    if (!val || val.length < 3) { setSubdomainAvailable(null); return; }
    setCheckingSubdomain(true);
    const res = await fetch(`/api/tenant/subdomain/check?subdomain=${encodeURIComponent(val)}`);
    const d = await res.json();
    setSubdomainAvailable(d.available && !d.current);
    setCheckingSubdomain(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/workspace', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(form) });
    const data = await res.json();
    if (res.ok) { toast.success('Settings saved'); setTenant(data.data); }
    else toast.error(data.error||'Failed to save');
    setSaving(false);
  };

  const exportData = async () => {
      setExporting(true);
    const res = await fetch('/api/tenant/export');
    if (!res.ok) { toast.error('Export failed'); setExporting(false); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`nucrm_export_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    toast.success('Export downloaded');
    setExporting(false);
  };

  const copySubdomainLink = () => {
    const url = `https://${form.subdomain}.nucrm.io`;
    navigator.clipboard.writeText(url);
    toast.success('Copied!');
  };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nucrm.io';

  return (
    <div className="space-y-5 animate-fade-in">
      <h1 className="text-lg font-bold">Workspace Settings</h1>

      <form onSubmit={save} className="space-y-5">
        {/* Branding */}
        <div className="admin-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Palette className="w-4 h-4 text-muted-foreground"/>Branding</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Logo</label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center border border-border overflow-hidden">
                  {logoPreview || tenant?.logo_url ? (
                    <img src={logoPreview || tenant?.logo_url} className="w-full h-full object-contain" alt="Logo" />
                  ) : (
                    <Globe className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <label className="cursor-pointer text-xs text-violet-600 hover:text-violet-700">
                    Upload logo
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () => setLogoPreview(reader.result as string);
                        reader.readAsDataURL(file);
                      }
                    }}/>
                  </label>
                  <p className="text-xs text-muted-foreground">PNG, JPG up to 2MB</p>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Favicon</label>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center border border-border overflow-hidden">
                  {faviconPreview || tenant?.favicon_url ? (
                    <Image src={faviconPreview || tenant?.favicon_url} className="w-full h-full object-contain" alt="Favicon" />
                  ) : (
                    <Globe className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <label className="cursor-pointer text-xs text-violet-600 hover:text-violet-700">
                    Upload favicon
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () => setFaviconPreview(reader.result as string);
                        reader.readAsDataURL(file);
                      }
                    }}/>
                  </label>
                  <p className="text-xs text-muted-foreground">32x32 PNG preferred</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Basic info */}
        <div className="admin-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Globe className="w-4 h-4 text-muted-foreground"/>Workspace Info</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Workspace Name</label>
              <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required className={inp}/>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Industry</label>
              <select value={form.industry} onChange={e=>setForm(f=>({...f,industry:e.target.value}))} className={inp}>
                {INDUSTRIES.map(i=><option key={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Timezone</label>
              <select value={form.settings.timezone} onChange={e=>setForm(f=>({...f,settings:{...f.settings,timezone:e.target.value}}))} className={inp}>
                {TIMEZONES.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Currency</label>
              <select value={form.settings.currency} onChange={e=>setForm(f=>({...f,settings:{...f.settings,currency:e.target.value}}))} className={inp}>
                {CURRENCIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5"/>Brand Color
              </label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.primary_color} onChange={e=>setForm(f=>({...f,primary_color:e.target.value}))} className="w-10 h-10 p-0.5 rounded-lg border border-border cursor-pointer"/>
                <input value={form.primary_color} onChange={e=>setForm(f=>({...f,primary_color:e.target.value}))} className={inp+' flex-1'} placeholder="#7c3aed"/>
              </div>
            </div>
          </div>
        </div>

        {/* Subdomain */}
        <div className="admin-card p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold flex items-center gap-2"><Link2 className="w-4 h-4 text-muted-foreground"/>Your CRM URL</p>
            <p className="text-xs text-muted-foreground mt-0.5">Give your team a memorable link to access the CRM</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Subdomain</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  value={form.subdomain}
                  onChange={e => {
                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,40);
                    setForm(f=>({...f,subdomain:val}));
                    setSubdomainAvailable(null);
                  }}
                  onBlur={e => checkSubdomain(e.target.value)}
                  className={inp + ' pr-8'}
                  placeholder="yourcompany"
                  maxLength={40}
                />
                {checkingSubdomain && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"/>}
                {!checkingSubdomain && subdomainAvailable===true && <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-500"/>}
                {!checkingSubdomain && subdomainAvailable===false && <AlertTriangle className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-red-500"/>}
              </div>
              <span className="text-sm text-muted-foreground whitespace-nowrap">.nucrm.io</span>
            </div>
            {form.subdomain && (
              <div className="flex items-center justify-between mt-2 p-2 bg-muted/30 rounded-lg">
                <code className="text-xs text-violet-600 font-mono">https://{form.subdomain}.nucrm.io</code>
                <button type="button" onClick={copySubdomainLink} className="p-1 hover:bg-accent rounded transition-colors">
                  <Copy className="w-3.5 h-3.5 text-muted-foreground"/>
                </button>
              </div>
            )}
            {subdomainAvailable===false && <p className="text-xs text-red-500 mt-1">This subdomain is already taken. Try another.</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Custom Domain <span className="text-muted-foreground/50">(optional — Enterprise plan)</span></label>
            <input
              value={form.custom_domain}
              onChange={e=>setForm(f=>({...f,custom_domain:e.target.value}))}
              className={inp}
              placeholder="crm.yourcompany.com"
              disabled={tenant?.plan_id !== 'enterprise'}
            />
            {tenant?.plan_id !== 'enterprise' && (
              <p className="text-xs text-muted-foreground mt-1">Custom domains require the Enterprise plan. <a href="/tenant/settings/billing" className="text-violet-600 hover:underline">Upgrade →</a></p>
            )}
            {form.custom_domain && tenant?.plan_id==='enterprise' && (
              <div className="mt-2 p-3 bg-muted/30 rounded-lg space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">DNS Setup Required</p>
                <p className="text-xs text-muted-foreground">Add a CNAME record pointing to:</p>
                <code className="text-xs bg-muted px-2 py-1 rounded block font-mono">app.nucrm.io</code>
                <p className="text-xs text-muted-foreground">Verification may take up to 24 hours.</p>
              </div>
            )}
          </div>
        </div>

        <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      {/* GDPR */}
      <div className="admin-card p-5 border-dashed space-y-2">
        <p className="text-sm font-semibold">Data Export (GDPR Right to Portability)</p>
        <p className="text-xs text-muted-foreground">Download all workspace data as JSON — contacts, companies, deals, tasks, activities.</p>
        <button onClick={exportData} disabled={exporting} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium disabled:opacity-50 transition-colors">
          {exporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4"/>}
          {exporting ? 'Exporting...' : 'Export All Data'}
        </button>
      </div>
    </div>
  );
}
