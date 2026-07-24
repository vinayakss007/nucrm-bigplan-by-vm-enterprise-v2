'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Eye, Send, TrendingUp, Loader2, BarChart3, Hash, List, Type, CheckSquare, Star } from 'lucide-react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TimeSeriesPoint {
  date: string;
  count: number;
}

interface ValueDistItem {
  value: string;
  count: number;
}

interface NumericStats {
  min: number;
  max: number;
  avg: number;
}

interface FieldAnalytics {
  key: string;
  label: string;
  type: string;
  total: number;
  filled: number;
  completionRate: number;
  valueDistribution?: ValueDistItem[];
  numericStats?: NumericStats;
}

interface AnalyticsData {
  name: string;
  views: number;
  submissions: number;
  timeSeries: TimeSeriesPoint[];
  fields: FieldAnalytics[];
}

const FIELD_ICONS: Record<string, React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  email: <Type className="h-3.5 w-3.5" />,
  textarea: <Type className="h-3.5 w-3.5" />,
  number: <Hash className="h-3.5 w-3.5" />,
  select: <List className="h-3.5 w-3.5" />,
  radio: <Star className="h-3.5 w-3.5" />,
  checkbox: <CheckSquare className="h-3.5 w-3.5" />,
  multiselect: <List className="h-3.5 w-3.5" />,
};

export default function FormAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const formId = params.id as string;

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tenant/forms/${formId}/analytics?days=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed');
        return r.json();
      })
      .then(setData)
      .catch(() => router.push('/tenant/forms'))
      .finally(() => setLoading(false));
  }, [formId, days, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
      </div>
    );
  }

  if (!data) return null;

  const maxCount = Math.max(...data.timeSeries.map((p) => p.count), 1);
  const conversionRate = data.views > 0
    ? ((data.submissions / data.views) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link
        href="/tenant/forms"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back to forms
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{data.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Form analytics</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard icon={<Eye className="h-5 w-5 text-blue-600" />} label="Total views" value={data.views.toLocaleString()} bg="bg-blue-50" />
        <StatCard icon={<Send className="h-5 w-5 text-green-600" />} label="Submissions" value={data.submissions.toLocaleString()} bg="bg-green-50" />
        <StatCard icon={<TrendingUp className="h-5 w-5 text-purple-600" />} label="Conversion rate" value={`${conversionRate}%`} bg="bg-purple-50" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Submissions over time</h2>
        {data.timeSeries.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-10">No submissions in this period.</p>
        ) : (
          <div className="flex items-end gap-1" style={{ height: 180 }}>
            {data.timeSeries.map((pt) => (
              <div key={pt.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div
                  className="w-full rounded-t bg-purple-500 hover:bg-purple-600 transition-colors min-h-[2px]"
                  style={{ height: `${(pt.count / maxCount) * 100}%` }}
                />
                <span className="text-[10px] text-gray-400 mt-1 truncate w-full text-center">
                  {pt.date.slice(5)}
                </span>
                <div className="absolute -top-8 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                  {pt.count} submission{pt.count !== 1 ? 's' : ''} on {pt.date}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.fields && data.fields.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Field Performance</h2>
          </div>
          <div className="space-y-6">
            {data.fields.map((field) => (
              <FieldCard key={field.key} field={field} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Embed this form</h2>
        <p className="text-sm text-gray-500 mb-3">
          Copy this snippet into any HTML page to embed the form:
        </p>
        <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 overflow-x-auto select-all">
          {`<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/api/embed/form.js?id=${formId}"></script>`}
        </pre>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string; bg: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
      <div className={`${bg} p-2 rounded-lg`}>{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function FieldCard({ field }: { field: FieldAnalytics }) {
  const isOptionField = ['select', 'radio', 'multiselect'].includes(field.type);
  const isNumeric = field.type === 'number';
  const color = field.completionRate >= 80 ? 'bg-green-500' : field.completionRate >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const icon = FIELD_ICONS[field.type] ?? <Type className="h-3.5 w-3.5" />;

  return (
    <div className="border border-gray-100 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{icon}</span>
          <span className="font-medium text-gray-900 text-sm">{field.label}</span>
          <span className="text-[10px] uppercase tracking-wider text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{field.type}</span>
        </div>
        <span className="text-xs text-gray-500">{field.filled}/{field.total} filled</span>
      </div>

      <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${field.completionRate}%` }} />
      </div>
      <p className="text-xs text-gray-500 mb-3">{field.completionRate}% completion rate</p>

      {isOptionField && field.valueDistribution && field.valueDistribution.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-600 mb-2">Value distribution</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={field.valueDistribution} layout="vertical" margin={{ left: 20, right: 20, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="value" tick={{ fontSize: 11 }} width={80} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="count" fill="#7c3aed" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {isNumeric && field.numericStats && (
        <div className="mt-3 flex gap-4 text-xs">
          <div className="bg-gray-50 rounded px-3 py-2">
            <span className="text-gray-400 block">Min</span>
            <span className="font-semibold text-gray-800">{field.numericStats.min}</span>
          </div>
          <div className="bg-gray-50 rounded px-3 py-2">
            <span className="text-gray-400 block">Max</span>
            <span className="font-semibold text-gray-800">{field.numericStats.max}</span>
          </div>
          <div className="bg-gray-50 rounded px-3 py-2">
            <span className="text-gray-400 block">Avg</span>
            <span className="font-semibold text-gray-800">{field.numericStats.avg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
