import type { Metadata } from 'next';
import ReportBuilderClient from './client-page';

export const metadata: Metadata = {
  title: 'Report Builder - NuCRM',
  description: 'Build custom reports with real-time aggregations',
};

export default function ReportBuilderPage() {
  return <ReportBuilderClient />
}
