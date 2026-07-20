'use client';
import dynamic from 'next/dynamic';

export const LazyAreaChart = dynamic(() => import('recharts').then(m => m.AreaChart), { ssr: false });
export const LazyArea = dynamic(() => import('recharts').then(m => m.Area), { ssr: false });
export const LazyBarChart = dynamic(() => import('recharts').then(m => m.BarChart), { ssr: false });
export const LazyBar = dynamic(() => import('recharts').then(m => m.Bar), { ssr: false });
export const LazyLineChart = dynamic(() => import('recharts').then(m => m.LineChart), { ssr: false });
export const LazyLine = dynamic(() => import('recharts').then(m => m.Line), { ssr: false });
export const LazyPieChart = dynamic(() => import('recharts').then(m => m.PieChart), { ssr: false });
export const LazyPie = dynamic(() => import('recharts').then(m => m.Pie), { ssr: false });
export const LazyCell = dynamic(() => import('recharts').then(m => m.Cell), { ssr: false });
export const LazyXAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false });
export const LazyYAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false });
export const LazyCartesianGrid = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false });
export const LazyTooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false });
export const LazyResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false });
export const LazyLegend = dynamic(() => import('recharts').then(m => m.Legend), { ssr: false });
