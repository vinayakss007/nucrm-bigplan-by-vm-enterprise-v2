import Link from 'next/link';
import { BRAND, FOOTER, TRUST_BADGES } from '@/lib/marketing/site';
import { STUDIO_PRODUCTS } from '@/lib/marketing/abetworks';
import { Icon } from './icon';
import { AbetworksWordmark, Logo } from './logo';

/**
 * Mega footer.
 *
 * This is deliberately exhaustive: it is the site map. Every marketing page —
 * every feature pillar, every industry, every comparison, every product in the
 * abetworks family and every legal page — is reachable from here, so a visitor
 * who scrolls to the bottom of the landing page discovers the whole site
 * instead of a dead end.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden border-t border-white/[0.08] bg-[#04040a]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" aria-hidden />
      <div
        className="pointer-events-none absolute -bottom-40 left-1/2 h-80 w-[900px] -translate-x-1/2 rounded-full bg-violet-600/10 blur-[130px]"
        aria-hidden
      />

      <div className="relative mx-auto w-full max-w-[1200px] px-5 py-16 sm:px-8">
        {/* brand + trust */}
        <div className="grid gap-10 border-b border-white/[0.07] pb-12 lg:grid-cols-[1.15fr_2fr]">
          <div>
            <Logo size={36} href={null} />
            <p className="mk-body mt-5 max-w-sm">{BRAND.description}</p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {TRUST_BADGES.map((b) => (
                <span key={b} className="mk-chip !text-[11px]">
                  <Icon name="ShieldCheck" className="h-3 w-3 text-emerald-400" />
                  {b}
                </span>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/auth/signup" className="mk-btn mk-btn-primary !min-h-[40px] !px-4 !text-[13.5px]">
                Start free
              </Link>
              <Link href="/contact" className="mk-btn mk-btn-ghost !min-h-[40px] !px-4 !text-[13.5px]">
                Talk to sales
              </Link>
            </div>
          </div>

          {/* the abetworks family, surfaced rather than buried */}
          <div>
            <div className="mk-eyebrow mb-4 text-slate-500">Also built by abetworks</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {STUDIO_PRODUCTS.map((p) => (
                <Link
                  key={p.slug}
                  href={`/abetworks/${p.slug}`}
                  className="group flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 transition-colors hover:border-violet-400/25 hover:bg-white/[0.045]"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${p.accent} ring-1 ring-inset ring-white/20`}
                  >
                    <Icon name={p.icon} className="h-3.5 w-3.5 text-white" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-200 group-hover:text-white">{p.name}</span>
                    <span className="mk-tiny mt-0.5 line-clamp-2 block">{p.hook}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* link columns */}
        <nav className="grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-6" aria-label="Footer">
          {FOOTER.map((col) => (
            <div key={col.heading}>
              <div className="mk-eyebrow mb-3.5 text-slate-500">{col.heading}</div>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="text-[13px] text-slate-400 transition-colors hover:text-violet-300">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* base line */}
        <div className="flex flex-col gap-4 border-t border-white/[0.07] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="mk-tiny">
            © {year} <AbetworksWordmark className="text-slate-400" />. NuCRM is a product of abetworks. All rights
            reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href={`mailto:${BRAND.email}`} className="mk-tiny transition-colors hover:text-violet-300">
              {BRAND.email}
            </a>
            <Link href="/legal/privacy" className="mk-tiny transition-colors hover:text-violet-300">
              Privacy
            </Link>
            <Link href="/legal/terms" className="mk-tiny transition-colors hover:text-violet-300">
              Terms
            </Link>
            <Link href="/security" className="mk-tiny transition-colors hover:text-violet-300">
              Security
            </Link>
          </div>
        </div>
      </div>

      {/* oversized wordmark, cropped by the viewport edge */}
      <div className="pointer-events-none select-none overflow-hidden" aria-hidden>
        <div
          className="whitespace-nowrap text-center font-extrabold leading-[0.78] tracking-tighter text-white/[0.028]"
          style={{ fontSize: 'clamp(72px, 17vw, 240px)' }}
        >
          nucrm
        </div>
      </div>
    </footer>
  );
}
