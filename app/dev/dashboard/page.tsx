'use client';

/**
 * Development Dashboard - SUPER ADMIN ONLY
 * 
 * Real-time monitoring dashboard for local development
 * Shows requests, errors, database queries, performance metrics
 * 
 * ⚠️ ACCESS: Super Admin Only
 * ⚠️ ENVIRONMENT: Development Only (Disabled in Production)
 * 
 * Access at: http://localhost:3000/dev/dashboard
 */

import { useState, useEffect } from 'react';

interface DashboardData {
  timestamp: string;
  uptime: number;
  nodeVersion: string;
  stats: {
    uptime: string;
    totalRequests: number;
    totalErrors: number;
    errorRate: string;
    avgResponseTime: string;
    avgQueryTime: string;
    totalQueries: number;
    slowQueries: number;
  };
  dbStats: {
    tables: number;
    totalRows: number;
    activeConnections: number;
  } | null;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  environment: Record<string, string>;
}

interface RequestLog {
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: number;
}

interface QueryLog {
  sql: string;
  duration: number;
  timestamp: number;
}

interface ErrorLog {
  message: string;
  context?: string;
  timestamp: string;
  stack?: string;
}

export default function DevelopmentDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [queries, setQueries] = useState<QueryLog[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'queries' | 'errors'>('overview');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/dev/dashboard');
      const jsonData = await res.json();
      setData(jsonData);

      const logsRes = await fetch('/api/dev/logs?limit=50');
      const logsData = await logsRes.json();
      setRequests(logsData.requests || []);

      const queriesRes = await fetch('/api/dev/queries?limit=50&slow=true');
      const queriesData = await queriesRes.json();
      setQueries(queriesData.queries || []);

      const errorsRes = await fetch('/api/dev/errors?limit=20');
      const errorsData = await errorsRes.json();
      setErrors(errorsData.errors || []);

      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    if (autoRefresh) {
      const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const formatUptime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getStatusColor = (status: number) => {
    if (status >= 500) return 'bg-red-500';
    if (status >= 400) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-500',
      POST: 'bg-green-500',
      PUT: 'bg-yellow-500',
      DELETE: 'bg-red-500',
      PATCH: 'bg-purple-500',
    };
    return colors[method] || 'bg-gray-500';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-lg">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      {/* Super Admin Banner */}
      <div className="bg-gradient-to-r from-purple-900 to-blue-900 border-b-2 border-yellow-500 rounded-lg p-4 mb-8">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-3xl">👑</span>
            <div>
              <h2 className="text-xl font-bold text-yellow-400">Super Admin Dashboard</h2>
              <p className="text-sm text-gray-300">
                ⚠️ Development Tools Only - Disabled in Production
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-green-600 rounded-full text-sm font-bold">
                {(data?.environment as any)?.['nodeEnv'] || 'development'}
              </span>
              <span className="px-3 py-1 bg-purple-600 rounded-full text-sm font-bold">
                Super Admin Access
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              These tools help you track and fix issues
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold">🚀 Development Dashboard</h1>
            <p className="text-gray-400 mt-2">
              Node.js {data?.nodeVersion} • Uptime: {data && formatUptime(data.uptime)}
            </p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
            >
              🔄 Refresh
            </button>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-4 py-2 rounded ${
                autoRefresh ? 'bg-green-600' : 'bg-gray-600'
              }`}
            >
              Auto: {autoRefresh ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-700">
          {(['overview', 'requests', 'queries', 'errors'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2 rounded-t ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && data && (
          <div className="space-y-6">
            {/* Security Notice */}
            <div className="bg-blue-900/50 border border-blue-500 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🔒</span>
                <div>
                  <h3 className="font-bold text-blue-400">Super Admin Security Notice</h3>
                  <ul className="text-sm text-gray-300 mt-2 space-y-1">
                    <li>✅ These tracking tools are <strong>only accessible to super admins</strong></li>
                    <li>✅ Automatically <strong>disabled in production</strong> environment</li>
                    <li>✅ Helps you <strong>track errors and improve performance</strong></li>
                    <li>✅ All data stays <strong>local to your development environment</strong></li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-gray-400 text-sm mb-2">Total Requests</h3>
                <p className="text-3xl font-bold">{data.stats.totalRequests}</p>
                <p className="text-sm text-gray-500 mt-2">
                  Avg: {data.stats.avgResponseTime}
                </p>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-gray-400 text-sm mb-2">Errors</h3>
                <p className="text-3xl font-bold text-red-500">{data.stats.totalErrors}</p>
                <p className="text-sm text-gray-500 mt-2">
                  Rate: {data.stats.errorRate}
                </p>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-gray-400 text-sm mb-2">Database Queries</h3>
                <p className="text-3xl font-bold">{data.stats.totalQueries}</p>
                <p className="text-sm text-gray-500 mt-2">
                  Avg: {data.stats.avgQueryTime}
                </p>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-gray-400 text-sm mb-2">Slow Queries</h3>
                <p className="text-3xl font-bold text-yellow-500">{data.stats.slowQueries}</p>
                <p className="text-sm text-gray-500 mt-2">
                  {'>'}100ms threshold
                </p>
              </div>

              {/* Memory */}
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-gray-400 text-sm mb-2">Memory RSS</h3>
                <p className="text-3xl font-bold">{data.memory.rss} MB</p>
                <p className="text-sm text-gray-500 mt-2">
                  Heap: {data.memory.heapUsed} / {data.memory.heapTotal} MB
                </p>
              </div>

              {/* Database */}
              {data.dbStats && (
                <>
                  <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-gray-400 text-sm mb-2">Database Tables</h3>
                    <p className="text-3xl font-bold">{data.dbStats.tables}</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Total Rows: {data.dbStats.totalRows}
                    </p>
                  </div>

                  <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-gray-400 text-sm mb-2">DB Connections</h3>
                    <p className="text-3xl font-bold">{data.dbStats.activeConnections}</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Active queries
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Environment */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">🔧 Environment</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(data.environment).map(([key, value]) => (
                  <div key={key} className="flex justify-between items-center">
                    <span className="text-gray-400">{key}</span>
                    <span className={`px-2 py-1 rounded text-sm ${
                      value === 'configured' || value === 'true'
                        ? 'bg-green-600'
                        : value === 'test mode'
                        ? 'bg-yellow-600'
                        : 'bg-gray-600'
                    }`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Requests */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">📡 Recent Requests</h3>
              <div className="space-y-2">
                {requests.slice(-10).reverse().map((req, i) => (
                  <div key={i} className="flex items-center gap-4 text-sm">
                    <span className={`px-2 py-1 rounded ${getMethodColor(req.method)}`}>
                      {req.method}
                    </span>
                    <span className="flex-1 font-mono">{req.path}</span>
                    <span className={`px-2 py-1 rounded ${getStatusColor(req.status)}`}>
                      {req.status}
                    </span>
                    <span className="text-gray-400">{req.duration}ms</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Requests Tab */}
        {activeTab === 'requests' && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-4">📡 All Requests</h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {requests.slice().reverse().map((req, i) => (
                <div key={i} className="flex items-center gap-4 text-sm p-2 hover:bg-gray-700 rounded">
                  <span className={`px-2 py-1 rounded ${getMethodColor(req.method)}`}>
                    {req.method}
                  </span>
                  <span className="flex-1 font-mono">{req.path}</span>
                  <span className={`px-2 py-1 rounded ${getStatusColor(req.status)}`}>
                    {req.status}
                  </span>
                  <span className={`text-gray-400 ${req.duration > 1000 ? 'text-yellow-500' : ''}`}>
                    {req.duration}ms
                  </span>
                  <span className="text-gray-500 text-xs">
                    {new Date(req.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Queries Tab */}
        {activeTab === 'queries' && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-4">🗄️ Slow Database Queries</h3>
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {queries.slice().reverse().map((q, i) => (
                <div key={i} className="p-4 bg-gray-900 rounded">
                  <div className="flex items-center gap-4 mb-2">
                    <span className={`px-2 py-1 rounded ${
                      q.duration > 500 ? 'bg-red-600' : 'bg-yellow-600'
                    }`}>
                      {q.duration}ms
                    </span>
                    <span className="text-gray-500 text-xs">
                      {new Date(q.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre className="text-sm font-mono text-gray-300 whitespace-pre-wrap">
                    {q.sql}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Errors Tab */}
        {activeTab === 'errors' && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-4">❌ Error Logs</h3>
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {errors.slice().reverse().map((err, i) => (
                <div key={i} className="p-4 bg-gray-900 rounded border-l-4 border-red-600">
                  <div className="flex items-center gap-4 mb-2">
                    <span className="text-red-500 font-bold">ERROR</span>
                    <span className="text-gray-500 text-xs">
                      {new Date(err.timestamp).toLocaleString()}
                    </span>
                    {err.context && (
                      <span className="px-2 py-1 bg-gray-700 rounded text-xs">
                        {err.context}
                      </span>
                    )}
                  </div>
                  <p className="text-red-400 mb-2">{err.message}</p>
                  {err.stack && (
                    <pre className="text-xs font-mono text-gray-500 whitespace-pre-wrap bg-gray-950 p-2 rounded">
                      {err.stack}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer - Security Notice */}
      <div className="max-w-7xl mx-auto mt-8 pt-8 border-t border-gray-700">
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🛡️</span>
              <div>
                <h3 className="font-bold">Super Admin Development Tools</h3>
                <p className="text-sm text-gray-400">
                  These tools help you track errors, monitor performance, and improve your application
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-400">
                Environment: <span className="text-green-400 font-mono">{(data?.environment as any)?.['nodeEnv']}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Production Access: <span className="text-red-400">Disabled</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
