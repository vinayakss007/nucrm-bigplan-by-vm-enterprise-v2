import SettingsNav from '@/components/tenant/settings/settings-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <SettingsNav />
      <div className="w-full">
        {children}
      </div>
    </div>
  );
}
