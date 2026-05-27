import SettingsNav from '@/components/tenant/settings/settings-nav';
import SettingsMobilePicker from '@/components/tenant/settings/settings-mobile-picker';
import SettingsBreadcrumb from '@/components/tenant/settings/settings-breadcrumb';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:gap-6 -m-4 sm:-m-6 p-4 sm:p-6 min-h-[calc(100vh-3.5rem)]">
      {/* Mobile-only picker — sits above content on phones */}
      <div className="lg:hidden">
        <SettingsMobilePicker />
      </div>

      {/* Desktop side-rail — sits next to content on lg+ */}
      <SettingsNav />

      <div className="flex-1 min-w-0 lg:border-l lg:border-border lg:pl-6">
        <SettingsBreadcrumb />
        {children}
      </div>
    </div>
  );
}
