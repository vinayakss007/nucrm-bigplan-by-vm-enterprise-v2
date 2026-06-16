'use client';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  className?: string;
}

export function BarChart({ data, height = 200, className }: ChartProps) {
  const max = Math.max(...data.map(d => d.value), 1);
  
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((item, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
              <div 
                className="w-full rounded-t-md bg-violet-500 hover:bg-violet-600 transition-colors relative group"
                style={{ height: `${(item.value / max) * 100}%`, minHeight: '4px' }}
              >
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                  {item.value.toLocaleString()}
                </div>
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground truncate max-w-full">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineChart({ data, height = 200, className }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const max = Math.max(...data.map(d => d.value), 1);
  const min = Math.min(...data.map(d => d.value), 0);
  const range = max - min || 1;
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    const padding = 20;
    const w = rect.width - padding * 2;
    const h = rect.height - padding * 2;
    
    const points = data.map((item, i) => ({
      x: padding + (i / (data.length - 1 || 1)) * w,
      y: padding + h - ((item.value - min) / range) * h,
    }));
    
    ctx.beginPath();
    ctx.moveTo(points[0]?.x || 0, points[0]?.y || 0);
    points.forEach((p, i) => {
      if (i > 0) {
        const prev = points[i - 1]!;
        const cp1x = prev.x + (p.x - prev.x) / 3;
        const cp2x = p.x - (p.x - prev.x) / 3;
        ctx.bezierCurveTo(cp1x, prev.y, cp2x, p.y, p.x, p.y);
      }
    });
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.beginPath();
    points.forEach((p, _i) => {
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    });
    ctx.fillStyle = '#8b5cf6';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [data, max, min, range]);
  
  return (
    <div className={cn('w-full relative', className)} style={{ height }}>
      <canvas ref={canvasRef} className="w-full h-full" />
      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2">
        {data.map((item, i) => (
          <span key={i} className="text-[10px] text-muted-foreground">{item.label}</span>
        ))}
      </div>
    </div>
  );
}

const CHART_COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#84cc16'];

export function PieChart({ data, height = 200, className }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const size = height;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, size, size);
    
    const total = data.reduce((sum, d) => sum + d.value, 0);
    const cx = size / 2;
    const cy = size / 2;
    const radius = (size / 2) - 10;
    
    let startAngle = -Math.PI / 2;
    
    data.forEach((item, i) => {
      const sliceAngle = (item.value / total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;
      
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = (item.color || CHART_COLORS[i % CHART_COLORS.length]) || '#8b5cf6';
      ctx.fill();
      
      startAngle = endAngle;
    });
    
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'hsl(var(--background))';
    ctx.fill();
  }, [data, height]);
  
  return (
    <div className={cn('w-full flex items-center justify-center', className)} style={{ height }}>
      <canvas ref={canvasRef} className="max-w-full" style={{ height }} />
    </div>
  );
}

export function DonutChart({ data, height = 200, className }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const size = height;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, size, size);
    
    const total = data.reduce((sum, d) => sum + d.value, 0);
    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = (size / 2) - 10;
    const innerRadius = outerRadius * 0.65;
    
    let startAngle = -Math.PI / 2;
    
    data.forEach((item, i) => {
      const sliceAngle = (item.value / total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;
      
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, startAngle, endAngle);
      ctx.arc(cx, cy, innerRadius, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = (item.color || CHART_COLORS[i % CHART_COLORS.length]) || '#8b5cf6';
      ctx.fill();
      
      startAngle = endAngle;
    });
  }, [data, height]);
  
  const total = data.reduce((sum, d) => sum + d.value, 0);
  
  return (
    <div className={cn('w-full flex items-center justify-center gap-4', className)} style={{ height }}>
      <canvas ref={canvasRef} className="max-w-[60%]" style={{ height }} />
      <div className="flex flex-col gap-2 overflow-hidden">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="truncate">{item.label}</span>
            <span className="font-semibold ml-auto pl-2">{total > 0 ? Math.round((item.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max = 100, color = 'bg-violet-500', className }: { value: number; max?: number; color?: string; className?: string }) {
  const percent = Math.min((value / max) * 100, 100);
  return (
    <div className={cn('w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Sparkline({ data, width = 100, height = 30, color = '#8b5cf6' }: { data: number[]; width?: number; height?: number; color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, width, height);
    
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    const points = data.map((v, i) => ({
      x: (i / (data.length - 1)) * width,
      y: height - ((v - min) / range) * (height - 4) - 2,
    }));
    
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    points.forEach((p, i) => {
      if (i > 0) ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    const lastPt = points[points.length - 1]!;
    const firstPt = points[0]!;
    ctx.beginPath();
    ctx.moveTo(lastPt.x, lastPt.y);
    ctx.lineTo(lastPt.x, height);
    ctx.lineTo(firstPt.x, height);
    ctx.lineTo(firstPt.x, firstPt.y);
    ctx.fillStyle = color + '20';
    ctx.fill();
  }, [data, width, height, color]);
  
  return <canvas ref={canvasRef} className="w-full h-full" style={{ width, height }} />;
}
