'use client';

import { useState } from 'react';
import { 
  Plus, X, GripVertical, Settings, Save, Eye, Copy, Check, 
  Trash2, ChevronLeft, Layout, Type, Mail, Phone, Hash, 
  Calendar, CheckSquare, List
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const FIELD_TEMPLATES = [
  { type: 'text', label: 'Single Line Text', icon: Type },
  { type: 'email', label: 'Email Address', icon: Mail },
  { type: 'phone', label: 'Phone Number', icon: Phone },
  { type: 'textarea', label: 'Multi-line Text', icon: Layout },
  { type: 'number', label: 'Number', icon: Hash },
  { type: 'date', label: 'Date', icon: Calendar },
  { type: 'select', label: 'Dropdown', icon: List },
  { type: 'checkbox', label: 'Checkbox', icon: CheckSquare },
];

export default function FormBuilderPage() {
  const router = useRouter();
  const [name, setName] = useState('New Lead Form');
  const [fields, setFields] = useState<any[]>([
    { id: '1', key: 'first_name', label: 'First Name', type: 'text', required: true, placeholder: 'John' },
    { id: '2', key: 'last_name', label: 'Last Name', type: 'text', required: true, placeholder: 'Doe' },
    { id: '3', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'john@example.com' },
  ]);
  const [settings, setSettings] = useState({
    success_message: 'Thank you! We have received your submission.',
    submit_button_text: 'Submit',
    theme_color: '#7c3aed', // violet-600
    notify_email: '',
  });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'fields' | 'settings' | 'preview'>('fields');

  const addField = (template: any) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newField = {
      id,
      key: `${template.type}_${id}`,
      label: template.label,
      type: template.type,
      required: false,
      placeholder: '',
      options: template.type === 'select' ? ['Option 1', 'Option 2'] : undefined,
    };
    setFields([...fields, newField]);
  };

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
  };

  const updateField = (id: string, updates: any) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          fields,
          settings,
        }),
      });
      if (res.ok) {
        toast.success('Form saved successfully!');
        router.push('/tenant/forms');
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to save');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] -m-6 overflow-hidden">
      {/* Top Bar */}
      <div className="h-14 border-b border-border bg-card px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/tenant/forms" className="p-2 hover:bg-accent rounded-lg">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <input 
            value={name} 
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent font-bold text-lg focus:outline-none focus:border-b border-violet-500 w-64"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-lg p-1 mr-4">
            <button 
              onClick={() => setActiveTab('fields')}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all", activeTab === 'fields' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground")}
            >
              <Layout className="w-3.5 h-3.5 inline mr-1.5" /> Build
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all", activeTab === 'settings' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground")}
            >
              <Settings className="w-3.5 h-3.5 inline mr-1.5" /> Settings
            </button>
            <button 
              onClick={() => setActiveTab('preview')}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all", activeTab === 'preview' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground")}
            >
              <Eye className="w-3.5 h-3.5 inline mr-1.5" /> Preview
            </button>
          </div>
          
          <button 
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? <Plus className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Form
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Field Templates */}
        <div className="w-72 border-r border-border bg-card p-4 overflow-y-auto hidden lg:block">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Add Fields</h3>
          <div className="grid grid-cols-1 gap-2">
            {FIELD_TEMPLATES.map((template) => (
              <button
                key={template.type}
                onClick={() => addField(template)}
                className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-violet-500 hover:bg-violet-500/5 text-left transition-all group"
              >
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-violet-500 group-hover:text-white transition-colors">
                  <template.icon className="w-4 h-4" />
                </div>
                <span className="text-sm font-medium">{template.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-muted/30 overflow-y-auto p-8">
          {activeTab === 'fields' && (
            <div className="max-w-2xl mx-auto space-y-4">
              {fields.map((field, _index) => (
                <div key={field.id} className="group relative bg-card border border-border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all">
                  <div className="absolute -left-3 top-1/2 -translate-y-1/2 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <div className="p-1.5 bg-card border border-border rounded-lg cursor-grab">
                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-5">
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-1">Label</label>
                      <input 
                        value={field.label}
                        onChange={(e) => updateField(field.id, { label: e.target.value })}
                        className="w-full bg-muted/50 border border-transparent focus:border-violet-500 px-3 py-2 rounded-lg text-sm transition-all"
                      />
                    </div>
                    <div className="col-span-6 md:col-span-3">
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-1">Type</label>
                      <div className="px-3 py-2 rounded-lg bg-muted/50 text-xs font-medium text-muted-foreground border border-transparent capitalize">
                        {field.type}
                      </div>
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-1">Required</label>
                      <button 
                        onClick={() => updateField(field.id, { required: !field.required })}
                        className={cn("w-full py-2 rounded-lg text-xs font-bold transition-all", field.required ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground")}
                      >
                        {field.required ? 'YES' : 'NO'}
                      </button>
                    </div>
                    <div className="col-span-12 md:col-span-2 flex items-end justify-end">
                      <button 
                        onClick={() => removeField(field.id)}
                        className="p-2 hover:bg-red-50 text-muted-foreground hover:text-red-500 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              
              <button 
                onClick={() => addField(FIELD_TEMPLATES[0])}
                className="w-full py-4 border-2 border-dashed border-border rounded-2xl flex items-center justify-center gap-2 text-muted-foreground hover:border-violet-500 hover:text-violet-600 hover:bg-violet-50/50 transition-all"
              >
                <Plus className="w-5 h-5" />
                <span className="font-medium">Add New Field</span>
              </button>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-xl mx-auto bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h3 className="text-lg font-bold mb-4">Form Settings</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Success Message</label>
                    <textarea 
                      value={settings.success_message}
                      onChange={(e) => setSettings({ ...settings, success_message: e.target.value })}
                      className="w-full bg-muted/50 border border-border focus:border-violet-500 px-3 py-2 rounded-xl text-sm min-h-[100px] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Submit Button Text</label>
                    <input 
                      value={settings.submit_button_text}
                      onChange={(e) => setSettings({ ...settings, submit_button_text: e.target.value })}
                      className="w-full bg-muted/50 border border-border focus:border-violet-500 px-3 py-2 rounded-xl text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Theme Color</label>
                    <div className="flex gap-2">
                      <input 
                        type="color"
                        value={settings.theme_color}
                        onChange={(e) => setSettings({ ...settings, theme_color: e.target.value })}
                        className="h-10 w-10 p-0 border-none bg-transparent cursor-pointer"
                      />
                      <input 
                        value={settings.theme_color}
                        onChange={(e) => setSettings({ ...settings, theme_color: e.target.value })}
                        className="flex-1 bg-muted/50 border border-border px-3 py-2 rounded-xl text-sm font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="max-w-md mx-auto">
              <div className="bg-card border border-border rounded-3xl shadow-2xl overflow-hidden">
                <div className="p-8 border-b border-border bg-gradient-to-br from-violet-50/50 to-transparent">
                  <h2 className="text-2xl font-bold text-center">{name}</h2>
                  <p className="text-sm text-muted-foreground text-center mt-2">Fill out the form below</p>
                </div>
                <div className="p-8 space-y-4">
                  {fields.map((field) => (
                    <div key={field.id}>
                      <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                        {field.label} {field.required && <span className="text-red-500">*</span>}
                      </label>
                      {field.type === 'textarea' ? (
                        <div className="w-full h-24 bg-muted/30 rounded-xl border border-border" />
                      ) : (
                        <div className="w-full h-11 bg-muted/30 rounded-xl border border-border" />
                      )}
                    </div>
                  ))}
                  <button 
                    disabled
                    style={{ backgroundColor: settings.theme_color }}
                    className="w-full py-4 rounded-2xl text-white font-bold shadow-lg opacity-80"
                  >
                    {settings.submit_button_text}
                  </button>
                </div>
              </div>
              <p className="text-center text-[10px] text-muted-foreground mt-6 uppercase tracking-widest">
                Powered by abetworks.in — NuCRM
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
