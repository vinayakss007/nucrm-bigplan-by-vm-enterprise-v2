'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Target, Mail, Phone, Building2, MapPin, Globe, Linkedin, Calendar,
  User, Clock, DollarSign, Briefcase, TrendingUp, Star, Edit, Trash2,
  MoreHorizontal, ChevronDown, CheckCircle, XCircle, RotateCcw, Zap, Archive,
  ArrowLeft, Activity, FileText, MessageSquare, BarChart3, Award,
  Copy, ExternalLink, Share2, Download, Plus, X
} from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import toast from 'react-hot-toast';

const PIPELINE_CONFIG = {
  new: { label: 'New Lead', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', icon: Star },
  contacted: { label: 'Contacted', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Phone },
  qualified: { label: 'Qualified', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', icon: CheckCircle },
  unqualified: { label: 'Unqualified', color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  converted: { label: 'Converted', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: Zap },
  lost: { label: 'Lost', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', icon: Archive },
  nurturing: { label: 'Nurturing', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: RotateCcw },
};

const LIFECYCLE_STAGES = {
  visitor: { label: 'Visitor', icon: Target },
  lead: { label: 'Lead', icon: Target },
  marketing_qualified_lead: { label: 'MQL', icon: Star },
  sales_qualified_lead: { label: 'SQL', icon: CheckCircle },
  opportunity: { label: 'Opportunity', icon: TrendingUp },
  customer: { label: 'Customer', icon: Zap },
  evangelist: { label: 'Evangelist', icon: Award },
};

const AUTHORITY_LEVELS = {
  decision_maker: { label: 'Decision Maker', color: 'text-emerald-600' },
  influencer: { label: 'Influencer', color: 'text-blue-600' },
  user: { label: 'User', color: 'text-gray-600' },
  unknown: { label: 'Unknown', color: 'text-muted-foreground' },
};

interface Props {
  lead: any;
  activities: any[];
  relatedContacts: any[];
  teamMembers: any[];
  tenantId: string;
  userId: string;
}

export default function LeadDetailClient({ lead, activities, relatedContacts, teamMembers }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'activities' | 'notes'>('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [editData, setEditData] = useState(lead);
  const [editingBant, setEditingBant] = useState(false);
  const [bantSaving, setBantSaving] = useState(false);
  const [bantDraft, setBantDraft] = useState({
    budget: lead.budget ?? '',
    budget_currency: lead.budget_currency ?? 'USD',
    authority_level: lead.authority_level ?? 'unknown',
    need_description: lead.need_description ?? '',
    timeline: lead.timeline ?? '',
    timeline_target_date: lead.timeline_target_date
      ? String(lead.timeline_target_date).slice(0, 10)
      : '',
  });

  const saveBant = async () => {
    setBantSaving(true);
    try {
      const res = await fetch(`/api/tenant/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budget: bantDraft.budget === '' ? null : bantDraft.budget,
          budget_currency: bantDraft.budget_currency || null,
          authority_level: bantDraft.authority_level || null,
          need_description: bantDraft.need_description || null,
          timeline: bantDraft.timeline || null,
          timeline_target_date: bantDraft.timeline_target_date || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success('Discovery updated');
      setEditingBant(false);
      router.refresh();
    } catch {
      toast.error('Failed to update');
    }
    setBantSaving(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffSaving, setHandoffSaving] = useState(false);
  const [handoffDraft, setHandoffDraft] = useState({ assigned_to: '', reason: '' });

  const submitHandoff = async () => {
    if (!handoffDraft.assigned_to) {
      toast.error('Pick a team member to hand off to');
      return;
    }
    setHandoffSaving(true);
    try {
      const res = await fetch(`/api/tenant/leads/${lead.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(handoffDraft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Handoff failed');
        return;
      }
      if (data.no_op) {
        toast('Already assigned to that user', { icon: 'ℹ️' });
      } else {
        toast.success('Lead handed off');
      }
      setShowHandoff(false);
      setHandoffDraft({ assigned_to: '', reason: '' });
      router.refresh();
    } catch {
      toast.error('Handoff failed');
    } finally {
      setHandoffSaving(false);
    }
  };

  const statusConfig = PIPELINE_CONFIG[lead.lead_status as keyof typeof PIPELINE_CONFIG] || PIPELINE_CONFIG.new;
  const StatusIcon = statusConfig.icon;
  const lifecycleConfig = LIFECYCLE_STAGES[lead.lifecycle_stage as keyof typeof LIFECYCLE_STAGES];

  const updateLeadStatus = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/tenant/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success('Status updated');
      router.refresh();
    } catch {
      toast.error('Failed to update status');
    }
  };

  const deleteLead = async () => {
    try {
      const res = await fetch(`/api/tenant/leads/${lead.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Lead deleted');
      router.push('/tenant/leads');
    } catch {
      toast.error('Failed to delete lead');
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const ScoreBadge = ({ score }: { score: number }) => {
    const color = score >= 70 ? 'text-emerald-600 bg-emerald-50' : score >= 40 ? 'text-amber-600 bg-amber-50' : 'text-gray-600 bg-gray-50';
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold', color)}>
        <Star className={cn('w-4 h-4', score >= 70 ? 'fill-emerald-600' : score >= 40 ? 'fill-amber-600' : '')} />
        Lead Score: {score}/100
      </div>
    );
  };

  return (
    <div className="max-w-7xl space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
              {lead.first_name?.charAt(0)}{lead.last_name?.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{lead.first_name} {lead.last_name}</h1>
                <Badge variant="secondary" className="text-xs">
                  {lead.title || 'No title'}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                {lead.company_name && (
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5" />
                    {lead.company_name}
                  </span>
                )}
                {lead.assigned_name && (
                  <span className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    {lead.assigned_name}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <StatusIcon className="w-4 h-4 mr-2" />
                {statusConfig.label}
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.entries(PIPELINE_CONFIG).map(([key, config]) => (
                <DropdownMenuItem key={key} onClick={() => updateLeadStatus(key)}>
                  <config.icon className="w-4 h-4 mr-2" />
                  {config.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => setShowEdit(true)}>
            <Edit className="w-4 h-4 mr-2" />
            Edit
          </Button>
          <Button variant="outline" onClick={() => setShowHandoff(true)} title="Hand this lead off to another team member">
            <User className="w-4 h-4 mr-2" />
            Hand off
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => copyToClipboard(lead.email, 'Email')}>
                <Copy className="w-4 h-4 mr-2" />
                Copy Email
              </DropdownMenuItem>
              {lead.linkedin_url && (
                <DropdownMenuItem onClick={() => window.open(lead.linkedin_url, '_blank')}>
                  <Linkedin className="w-4 h-4 mr-2" />
                  View LinkedIn
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={deleteLead} className="text-red-600">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Lead
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="admin-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30">
              <Star className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Lead Score</p>
              <p className="text-lg font-bold">{lead.score || 0}</p>
            </div>
          </div>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Budget</p>
              <p className="text-lg font-bold">{lead.budget ? formatCurrency(lead.budget) : 'Not set'}</p>
            </div>
          </div>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Authority</p>
              <p className={cn('text-sm font-semibold', AUTHORITY_LEVELS[lead.authority_level as keyof typeof AUTHORITY_LEVELS]?.color)}>
                {AUTHORITY_LEVELS[lead.authority_level as keyof typeof AUTHORITY_LEVELS]?.label}
              </p>
            </div>
          </div>
        </div>
        <div className="admin-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Timeline</p>
              <p className="text-sm font-semibold">{lead.timeline || 'Not set'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab('overview')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2',
            activeTab === 'overview'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('activities')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2',
            activeTab === 'activities'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Activities ({activities.length})
        </button>
        <button
          onClick={() => setActiveTab('notes')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2',
            activeTab === 'notes'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Notes
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic Information */}
          <div className="admin-card p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <User className="w-4 h-4" />
              Basic Information
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Full Name</p>
                <p className="text-sm font-medium">{lead.first_name} {lead.last_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                  <a href={`mailto:${lead.email}`} className="text-sm text-violet-600 hover:underline">
                    {lead.email}
                  </a>
                  <button onClick={() => copyToClipboard(lead.email, 'Email')} className="text-muted-foreground hover:text-foreground">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {lead.phone && (
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                    <a href={`tel:${lead.phone}`} className="text-sm text-violet-600 hover:underline">
                      {lead.phone}
                    </a>
                  </div>
                </div>
              )}
              {lead.title && (
                <div>
                  <p className="text-xs text-muted-foreground">Job Title</p>
                  <p className="text-sm">{lead.title}</p>
                </div>
              )}
              {lifecycleConfig && (
                <div>
                  <p className="text-xs text-muted-foreground">Lifecycle Stage</p>
                  <Badge variant="secondary">
                    <lifecycleConfig.icon className="w-3 h-3 mr-1" />
                    {lifecycleConfig.label}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Company Information */}
          <div className="admin-card p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Company Information
            </h3>
            <div className="space-y-3">
              {lead.company_name && (
                <div>
                  <p className="text-xs text-muted-foreground">Company Name</p>
                  <p className="text-sm font-medium">{lead.company_name}</p>
                </div>
              )}
              {lead.company_industry && (
                <div>
                  <p className="text-xs text-muted-foreground">Industry</p>
                  <p className="text-sm">{lead.company_industry}</p>
                </div>
              )}
              {lead.company_size && (
                <div>
                  <p className="text-xs text-muted-foreground">Company Size</p>
                  <p className="text-sm">{lead.company_size}</p>
                </div>
              )}
              {lead.company_website && (
                <div>
                  <p className="text-xs text-muted-foreground">Website</p>
                  <a href={lead.company_website} target="_blank" className="text-sm text-violet-600 hover:underline flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" />
                    {lead.company_website}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* BANT Qualification */}
          <div className="admin-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                BANT Qualification
              </h3>
              {!editingBant ? (
                <Button size="sm" variant="outline" onClick={() => setEditingBant(true)}>
                  <Edit className="w-3.5 h-3.5 mr-1.5" />Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={bantSaving} onClick={() => {
                    setEditingBant(false);
                    setBantDraft({
                      budget: lead.budget ?? '',
                      budget_currency: lead.budget_currency ?? 'USD',
                      authority_level: lead.authority_level ?? 'unknown',
                      need_description: lead.need_description ?? '',
                      timeline: lead.timeline ?? '',
                      timeline_target_date: lead.timeline_target_date
                        ? String(lead.timeline_target_date).slice(0, 10)
                        : '',
                    });
                  }}>Cancel</Button>
                  <Button size="sm" disabled={bantSaving} onClick={() => void saveBant()}>
                    {bantSaving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
            {!editingBant ? (
              <div className="space-y-3">
                {lead.budget && (
                  <div>
                    <p className="text-xs text-muted-foreground">Budget</p>
                    <p className="text-sm font-medium">{formatCurrency(lead.budget)}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Authority Level</p>
                  <p className={cn('text-sm font-semibold', AUTHORITY_LEVELS[lead.authority_level as keyof typeof AUTHORITY_LEVELS]?.color)}>
                    {AUTHORITY_LEVELS[lead.authority_level as keyof typeof AUTHORITY_LEVELS]?.label}
                  </p>
                </div>
                {lead.need_description && (
                  <div>
                    <p className="text-xs text-muted-foreground">Need</p>
                    <p className="text-sm whitespace-pre-wrap">{lead.need_description}</p>
                  </div>
                )}
                {lead.timeline && (
                  <div>
                    <p className="text-xs text-muted-foreground">Timeline</p>
                    <p className="text-sm">{lead.timeline}</p>
                  </div>
                )}
                {lead.timeline_target_date && (
                  <div>
                    <p className="text-xs text-muted-foreground">Target date</p>
                    <p className="text-sm">{formatDate(lead.timeline_target_date)}</p>
                  </div>
                )}
                {!lead.budget && !lead.authority_level && !lead.need_description && !lead.timeline && (
                  <p className="text-xs text-muted-foreground">No qualification info yet — click Edit to capture budget, authority, need and timeline.</p>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Budget</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 50000"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                      value={bantDraft.budget}
                      onChange={(e) => setBantDraft((p) => ({ ...p, budget: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Currency</label>
                    <select
                      className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                      value={bantDraft.budget_currency}
                      onChange={(e) => setBantDraft((p) => ({ ...p, budget_currency: e.target.value }))}
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="INR">INR</option>
                      <option value="AUD">AUD</option>
                      <option value="CAD">CAD</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Authority Level</label>
                  <select
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                    value={bantDraft.authority_level}
                    onChange={(e) => setBantDraft((p) => ({ ...p, authority_level: e.target.value }))}
                  >
                    <option value="unknown">Unknown</option>
                    <option value="user">User</option>
                    <option value="influencer">Influencer</option>
                    <option value="decision_maker">Decision Maker</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Need / Requirements</label>
                  <textarea
                    rows={3}
                    placeholder="What does this client want? What problem are they solving?"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                    value={bantDraft.need_description}
                    onChange={(e) => setBantDraft((p) => ({ ...p, need_description: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Timeline</label>
                    <input
                      type="text"
                      placeholder="e.g. Q3, Next month, ASAP"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                      value={bantDraft.timeline}
                      onChange={(e) => setBantDraft((p) => ({ ...p, timeline: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Target date</label>
                    <input
                      type="date"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                      value={bantDraft.timeline_target_date}
                      onChange={(e) => setBantDraft((p) => ({ ...p, timeline_target_date: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  These fields are carried over to the contact + deal when this lead is converted, so the team always sees what the client wants.
                </p>
              </div>
            )}
          </div>

          {/* Additional Information */}
          <div className="admin-card p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Additional Information
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Lead Source</p>
                <Badge variant="secondary" className="capitalize">{lead.lead_source}</Badge>
              </div>
              {lead.country || lead.city ? (
                <div>
                  <p className="text-xs text-muted-foreground">Location</p>
                  <div className="flex items-center gap-1 text-sm">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                    {[lead.city, lead.country].filter(Boolean).join(', ')}
                  </div>
                </div>
              ) : null}
              {lead.linkedin_url && (
                <div>
                  <p className="text-xs text-muted-foreground">LinkedIn</p>
                  <a href={lead.linkedin_url} target="_blank" className="text-sm text-violet-600 hover:underline flex items-center gap-1">
                    <Linkedin className="w-3.5 h-3.5" />
                    View Profile
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              {lead.tags?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Tags</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {lead.tags.map((tag: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'activities' && (
        <div className="admin-card">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Activity Timeline</h3>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Activity
            </Button>
          </div>
          <div className="p-4">
            {activities.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No activities yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {activities.map((activity: any) => (
                  <div key={activity.id} className="flex items-start gap-3">
                    <div className="p-2 rounded-full bg-muted">
                      <Activity className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm">{activity.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDate(activity.performed_at)} by {activity.performed_by_name || 'System'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'notes' && (
        <div className="admin-card">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Notes</h3>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Note
            </Button>
          </div>
          <div className="p-4">
            {lead.notes ? (
              <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No notes yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Related Contacts */}
      {relatedContacts.length > 0 && (
        <div className="admin-card p-4">
          <h3 className="font-semibold mb-4">Related Contacts</h3>
          <div className="space-y-2">
            {relatedContacts.map((contact: any) => (
              <div
                key={contact.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent cursor-pointer"
                onClick={() => router.push(`/tenant/contacts/${contact.id}`)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
                    {getInitials(contact)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{contact.first_name} {contact.last_name}</p>
                    <p className="text-xs text-muted-foreground">{contact.email}</p>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Handoff dialog */}
      {showHandoff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !handoffSaving && setShowHandoff(false)}
        >
          <div
            className="admin-card p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <User className="w-4 h-4" />
              Hand off lead
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Reassign this lead to another team member. The handoff is logged on the contact's
              activity timeline so the next person sees the full history.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  Hand off to
                </label>
                <select
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  value={handoffDraft.assigned_to}
                  onChange={(e) => setHandoffDraft((p) => ({ ...p, assigned_to: e.target.value }))}
                  disabled={handoffSaving}
                >
                  <option value="">Select team member…</option>
                  {teamMembers
                    .filter((m: any) => m.user_id !== lead.assigned_to)
                    .map((m: any) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name || m.email}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  Reason / handoff notes <span className="font-normal">(optional, but recommended)</span>
                </label>
                <textarea
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  rows={3}
                  placeholder="e.g. Handing over for the demo on Tuesday — they're keen on the Pro tier."
                  value={handoffDraft.reason}
                  onChange={(e) => setHandoffDraft((p) => ({ ...p, reason: e.target.value }))}
                  disabled={handoffSaving}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={handoffSaving}
                  onClick={() => setShowHandoff(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={handoffSaving || !handoffDraft.assigned_to}
                  onClick={() => void submitHandoff()}
                >
                  {handoffSaving ? 'Handing off…' : 'Hand off'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getInitials(contact: any) {
  return (contact.first_name?.charAt(0) || '') + (contact.last_name?.charAt(0) || '');
}
