'use client';
import { useState, useEffect, useRef } from 'react';
import { Terminal, Download, Trash2, Pause, Play } from 'lucide-react';

type LogEntry = {
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  ts: string;
  msg: string;
  meta?: Record<string, unknown>;
  stack?: string;
};

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  debug: 'text-white/40',
  success: 'text-emerald-400',
};

const LEVEL_BG: Record<string, string> = {
  info: 'bg-blue-500/5',
  warn: 'bg-amber-500/5',
  error: 'bg-red-500/5',
  debug: 'bg-transparent',
  success: 'bg-emerald-500/5',
};

export default function LiveLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let mounted = true;

    function connect() {
      es = new EventSource('/api/logs/stream');
      es.onopen = () => { if (mounted) setConnected(true); };
      es.onmessage = (e) => {
        if (!mounted || paused) return;
        try {
          const entry: LogEntry = JSON.parse(e.data);
          setLogs(prev => [...prev.slice(-999), entry]);
        } catch { /* ignore parse errors */ }
      };
      es.onerror = () => {
        if (mounted) setConnected(false);
        es?.close();
        setTimeout(connect, 3000);
      };
    }

    connect();
    return () => { mounted = false; es?.close(); };
  }, [paused]);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, paused]);

  const clearLogs = () => setLogs([]);
  const downloadLogs = () => {
    const blob = new Blob([logs.map(l => `[${l.ts}] [${l.level.toUpperCase()}] ${l.msg}${l.meta ? ' ' + JSON.stringify(l.meta) : ''}`).join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nucrm-logs-${new Date().toISOString().slice(0, 19)}.txt`;
    a.click();
  };

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><Terminal className="w-5 h-5 text-emerald-400" />Live Logs</h1>
          <p className="text-xs text-white/30">Real-time system log stream</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="text-xs text-white/30">{connected ? 'Connected' : 'Disconnected'}</span>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button onClick={() => setPaused(!paused)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white transition-colors">
            {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={downloadLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white transition-colors">
            <Download className="w-3 h-3" />Export
          </button>
          <button onClick={clearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-red-400 transition-colors">
            <Trash2 className="w-3 h-3" />Clear
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[
          { key: 'all', label: 'All', color: 'text-white/60' },
          { key: 'info', label: 'INFO', color: 'text-blue-400' },
          { key: 'success', label: 'OK', color: 'text-emerald-400' },
          { key: 'warn', label: 'WARN', color: 'text-amber-400' },
          { key: 'error', label: 'ERROR', color: 'text-red-400' },
          { key: 'debug', label: 'DEBUG', color: 'text-white/30' },
        ].map(l => (
          <button key={l.key} onClick={() => setFilter(l.key)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              filter === l.key
                ? 'bg-white/10 border-white/20 text-white'
                : 'border-white/5 text-white/30 hover:text-white/60'
            }`}>
            {l.label}
          </button>
        ))}
      </div>

      <div ref={logContainerRef}
        className="rounded-xl border border-white/10 bg-black/40 overflow-hidden font-mono text-xs max-h-[70vh] overflow-y-auto">
        {!filteredLogs.length ? (
          <p className="text-white/20 p-6 text-center">
            {connected ? 'Waiting for logs...' : 'Disconnected. Retrying...'}
          </p>
        ) : (
          <div className="divide-y divide-white/[0.02]">
            {filteredLogs.map((log, i) => (
              <div key={i} className={`flex items-start gap-3 px-4 py-1.5 hover:bg-white/[0.02] ${LEVEL_BG[log.level] || ''}`}>
                <span className="text-[10px] text-white/20 whitespace-nowrap shrink-0 w-20">
                  {log.ts.slice(11, 19)}
                </span>
                <span className={`text-[10px] font-bold uppercase shrink-0 w-12 ${LEVEL_COLORS[log.level] || 'text-white/40'}`}>
                  {log.level}
                </span>
                <span className="text-white/70 break-all flex-1 min-w-0">
                  {log.msg}
                  {log.meta && Object.keys(log.meta).length > 0 && (
                    <span className="text-white/30 ml-2">{JSON.stringify(log.meta)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <p className="text-[10px] text-white/20">
        Showing {filteredLogs.length} of {logs.length} total entries
        {paused && ' (paused)'}
      </p>
    </div>
  );
}
