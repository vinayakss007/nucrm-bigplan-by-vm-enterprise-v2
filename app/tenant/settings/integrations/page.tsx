'use client';
import { useState, useEffect } from 'react';
import { Plug, Trash2, CheckCircle, XCircle, Globe, Mail, Zap, Send, Loader2 } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

const INTEGRATION_TYPES = [
  { id:'webhook', label:'Webhook',  icon:Globe, desc:'POST to any URL on CRM events (contact.created, deal.won, etc.)' },
  { id:'slack',   label:'Slack',   icon:Globe, desc:'Post notifications to a Slack channel via incoming webhook' },
  { id:'zapier',  label:'Zapier',  icon:Zap,   desc:'Connect to 6,000+ apps via Zapier webhook' },
  { id:'resend',  label:'Resend',  icon:Mail,  desc:'Override the default email provider with your own Resend account' },
  { id:'telegram', label:'Telegram', icon:Send, desc:'Get instant notifications on your phone via Telegram bot' },
  { id:'whatsapp', label:'WhatsApp', icon:Globe, desc:'Send WhatsApp messages via Meta Cloud API for customer communication' },
];

const FIELDS: Record<string,{key:string;label:string;type?:string;placeholder?:string}[]> = {
  webhook:[{key:'url',label:'Webhook URL',placeholder:'https://your-server.com/webhook'},{key:'secret',label:'Signing Secret (optional)',type:'password',placeholder:'hmac secret for signature verification'}],
  slack:  [{key:'webhook_url',label:'Slack Webhook URL',placeholder:'https://hooks.slack.com/services/T.../B.../...'},{key:'channel',label:'Channel (optional)',placeholder:'#general'}],
  zapier: [{key:'hook_url',label:'Zapier Webhook URL',placeholder:'https://hooks.zapier.com/hooks/catch/...'}],
  resend: [{key:'api_key',label:'Resend API Key',type:'password',placeholder:'re_...'},{key:'from_email',label:'From Email',placeholder:'noreply@yourcompany.com'}],
  telegram: [
    {key:'bot_token',label:'Bot Token',type:'password',placeholder:'123456789:ABCdefGHIjklMNOpqrsTUVwxyz'},
    {key:'chat_id',label:'Chat ID',placeholder:'123456789'},
  ],
  whatsapp: [
    {key:'phone_number_id',label:'Phone Number ID',placeholder:'Meta Cloud API Phone Number ID'},
    {key:'access_token',label:'Access Token',type:'password',placeholder:'EAA... (Meta access token)'},
    {key:'verify_token',label:'Verify Token',placeholder:'Your webhook verification token'},
    {key:'business_account_id',label:'Business Account ID',placeholder:'Meta Business Account ID'},
  ],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TEST_PAYLOADS: Record<string,any> = {
  webhook: { event:'contact.created', timestamp:new Date().toISOString(), data:{ id:'test-123', first_name:'Test', last_name:'Contact', email:'test@example.com' } },
  slack:   { text:'✅ NuCRM Slack integration test — this is working correctly!' },
  zapier:  { event:'test', contact:{ name:'Test Contact', email:'test@example.com' }, deal:{ title:'Test Deal', value:1000 } },
  telegram: { text:'✅ NuCRM Telegram integration test — this is working correctly!' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IntegrationModal({ type, onSaved, onClose }: any) {
  const [config, setConfig] = useState<Record<string,string>>({});
  const [name, setName]     = useState(type?.label||'');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const fields = FIELDS[type?.id] || [];
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type.id,name,config})});
    const d = await res.json();
    if(res.ok){toast.success(`${name} connected`);onSaved();}else toast.error(d.error||'Failed');
    setSaving(false);
  };

  const testIntegration = async () => {
    if (type.id === 'telegram') {
      const botToken = config['bot_token'];
      const chatId = config['chat_id'];
      if (!botToken || !chatId) { toast.error('Enter Bot Token and Chat ID first'); return; }
      setTesting(true);
      try {
        const res = await fetch(`/api/tenant/integrations/telegram/test`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ bot_token: botToken, chat_id: chatId }),
        });
        const d = await res.json();
        if (res.ok) {
          toast.success('Test message sent! Check Telegram');
        } else {
          toast.error(d.error || 'Test failed');
        }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        toast.error(`Error: ${err.message}`);
      }
      setTesting(false);
      return;
    }

    const url = config['url'] || config['webhook_url'] || config['hook_url'];
    if (!url) { toast.error('Enter the URL first'); return; }
    setTesting(true);
    try {
      const payload = TEST_PAYLOADS[type.id] || { test:true, timestamp: new Date().toISOString() };
      const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','X-NuCRM-Test':'true'}, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
      if (res.ok || (res.status >= 200 && res.status < 300)) {
        toast.success(`Test delivered — HTTP ${res.status}`);
      } else {
        toast.error(`Server responded ${res.status}`);
      }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message?.includes('abort') ? 'Timeout (8s) — check the URL' : `Error: ${err.message}`);
    }
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.6)'}}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2"><type.icon className="w-4 h-4 text-muted-foreground"/> Connect {type.label}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">✕</button>
        </div>
        <form onSubmit={save} className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2">{INTEGRATION_TYPES.find(t=>t.id===type.id)?.desc}</p>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Name</label><input value={name} onChange={e=>setName(e.target.value)} required className={inp}/></div>
          {fields.map(f=>(
            <div key={f.key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{f.label}</label>
              <input type={f.type||'text'} value={config[f.key]||''} onChange={e=>setConfig(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder} className={inp}/>
            </div>
          ))}
          {(type.id==='webhook'||type.id==='slack'||type.id==='zapier') && (
            <button type="button" onClick={testIntegration} disabled={testing}
              className="w-full py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
              {testing?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<Send className="w-3.5 h-3.5"/>}
              {testing?'Sending test...':'Send Test Payload'}
            </button>
          )}
          {type.id==='telegram' && (
            <button type="button" onClick={testIntegration} disabled={testing}
              className="w-full py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
              {testing?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<Send className="w-3.5 h-3.5"/>}
              {testing?'Sending test...':'Send Test Message'}
            </button>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving?'Connecting...':'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [addType, setAddType]           = useState<any>(null);

  const load = async () => { const r=await fetch('/api/tenant/integrations').then(r=>r.json()); setIntegrations(r.data||[]); setLoading(false); };
  useEffect(() => { load(); }, []);

  const toggle = async (id: string, active: boolean) => {
    await fetch(`/api/tenant/integrations/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:!active})});
    setIntegrations(prev=>prev.map(i=>i.id===id?{...i,is_active:!active}:i));
  };
  const del = async (id: string) => {
      await fetch(`/api/tenant/integrations/${id}`,{method:'DELETE'});
    setIntegrations(prev=>prev.filter(i=>i.id!==id)); toast.success('Removed');
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div><h1 className="text-lg font-bold flex items-center gap-2"><Plug className="w-5 h-5"/>Integrations</h1><p className="text-sm text-muted-foreground">Connect NuCRM to external tools</p></div>

      {/* Available connectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {INTEGRATION_TYPES.map(t=>(
          <button key={t.id} onClick={()=>setAddType(t)}
            className="flex items-start gap-3 p-4 rounded-xl border border-border hover:border-violet-400/40 hover:bg-accent/30 text-left transition-all group">
            <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0 group-hover:bg-violet-50 dark:group-hover:bg-violet-950/30 transition-colors">
              <t.icon className="w-4 h-4 text-muted-foreground group-hover:text-violet-600"/>
            </div>
            <div>
              <p className="text-sm font-semibold">{t.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.desc.slice(0,60)}...</p>
            </div>
          </button>
        ))}
      </div>

      {/* Connected integrations */}
      {loading ? <div className="admin-card p-5 animate-pulse h-20"/>
      : integrations.length > 0 && (
        <div className="admin-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border"><p className="text-sm font-semibold">Connected ({integrations.length})</p></div>
          <div className="divide-y divide-border">
            {integrations.map(i=>{
              const typeMeta = INTEGRATION_TYPES.find(t=>t.id===i.type);
              const Icon = typeMeta?.icon||Plug;
              return (
                <div key={i.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-muted-foreground"/></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{i.type} · Added {formatDate(i.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={()=>toggle(i.id,i.is_active)}
                      className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors', i.is_active?'border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:bg-emerald-950/20':'border-border text-muted-foreground hover:bg-accent')}>
                      {i.is_active?<><CheckCircle className="w-3 h-3"/>Active</>:<><XCircle className="w-3 h-3"/>Inactive</>}
                    </button>
                    <button onClick={()=>del(i.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 text-muted-foreground transition-colors">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!loading && !integrations.length && (
        <div className="text-center py-10"><Plug className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3"/><p className="font-semibold text-sm mb-1">No integrations yet</p><p className="text-sm text-muted-foreground">Connect a tool above to get started</p></div>
      )}

      {addType && <IntegrationModal type={addType} onSaved={()=>{load();setAddType(null);}} onClose={()=>setAddType(null)}/>}
    </div>
  );
}
