import { BrandingConfig, generateCSSVariables } from '@/lib/branding';
import Image from 'next/image';

interface BrandedHeaderProps {
  branding: BrandingConfig;
}

export function BrandedHeader({ branding }: BrandedHeaderProps) {
  const cssVars = generateCSSVariables(branding);

  const layoutClasses: Record<string, string> = {
    default: 'justify-between',
    centered: 'justify-center',
    minimal: 'justify-start',
  };

  const layoutClass = layoutClasses[branding.headerLayout] ?? layoutClasses['default'];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cssVars }} />
      <header
        className={`flex items-center px-6 py-4 border-b ${layoutClass}`}
        style={{ backgroundColor: branding.primaryColor, color: '#ffffff' }}
      >
        <div className="flex items-center gap-3">
          {branding.logoUrl && (
            <Image
              src={branding.logoUrl}
              alt={branding.companyName ?? 'Logo'}
              className="h-8 w-auto"
            />
          )}
          {branding.companyName && (
            <span className="text-lg font-semibold">{branding.companyName}</span>
          )}
        </div>

        {!branding.hidePoweredBy && (
          <div className="text-xs opacity-60">
            Powered by NuCRM
          </div>
        )}
      </header>
    </>
  );
}

export default BrandedHeader;
