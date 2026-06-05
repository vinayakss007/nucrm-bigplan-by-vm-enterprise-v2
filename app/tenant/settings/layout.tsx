import SettingsNav from '@/components/tenant/settings/settings-nav';
import SettingsMobilePicker from '@/components/tenant/settings/settings-mobile-picker';
import SettingsBreadcrumb from '@/components/tenant/settings/settings-breadcrumb';

/**
 * Settings shell.
 *
 * - Mobile: stacked picker + breadcrumb + content.
 * - Desktop: side-rail + breadcrumb + wide content area (max-w-screen-2xl).
 *
 * The settings INDEX page (/tenant/settings) opts out of the side-rail by
 * rendering its own full-bleed control-center grid via Tailwind's
 * `[&_>_aside]:hidden` style — but we keep the layout simple and let the
 * index consume full width through the natural flex flow.
 */
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
        <div className="max-w-[1600px]">
          <SettingsBreadcrumb />
          {children}
        </div>
      </div>
    </div>
  );
}
