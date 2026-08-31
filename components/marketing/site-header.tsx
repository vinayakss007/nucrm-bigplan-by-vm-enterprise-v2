/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAV } from '@/lib/marketing/site';
import { Icon } from './icon';
import { Logo } from './logo';

/**
 * Marketing header.
 *
 * Behaviour notes:
 *  - Desktop mega-menus open on pointer enter and on keyboard focus, and close
 *    on Escape or on click outside, so they are usable without a mouse.
 *  - The panel is absolutely positioned against the header, not the trigger, so
 *    wide three-column menus stay centred instead of overflowing the viewport.
 *  - The bar starts transparent over the hero and only gains its glass
 *    treatment once the page has scrolled.
 */
export function SiteHeader() {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Route change should always leave the menus closed.
  useEffect(() => {
    setOpen(null);
    setMobile(false);
    setMobileGroup(null);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
        setMobile(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);

  // Lock background scroll while the mobile drawer is up.
  useEffect(() => {
    document.body.style.overflow = mobile ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobile]);

  const hoverOpen = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(label);
  };
  const hoverClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), 140);
  };

  const isActive = (href?: string) => href && href !== '/' && pathname.startsWith(href);

  return (
    <header
      ref={headerRef}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || open || mobile ? 'mk-glass border-b border-white/[0.08]' : 'border-b border-transparent'
      }`}
      onMouseLeave={hoverClose}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-2 px-5 sm:px-8">
        <Logo size={32} />

        {/* desktop nav */}
        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((group) => {
            const hasMenu = Boolean(group.columns?.length);
            const on = open === group.label;
            return (
              <div key={group.label} onMouseEnter={() => (hasMenu ? hoverOpen(group.label) : setOpen(null))}>
                {hasMenu ? (
                  <button
                    type="button"
                    aria-expanded={on}
                    aria-haspopup="true"
                    onClick={() => setOpen(on ? null : group.label)}
                    onFocus={() => hoverOpen(group.label)}
                    className={`flex items-center gap-1 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${
                      on || isActive(group.href) ? 'text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {group.label}
                    <Icon name="ChevronDown" className={`h-3.5 w-3.5 transition-transform ${on ? 'rotate-180' : ''}`} />
                  </button>
                ) : (
                  <Link
                    href={group.href ?? '/'}
                    className={`rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${
                      isActive(group.href) ? 'text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {group.label}
                  </Link>
                )}
              </div>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/auth/login"
            className="hidden rounded-lg px-3 py-2 text-[14px] font-medium text-slate-400 transition-colors hover:text-white sm:block"
          >
            Sign in
          </Link>
          <Link href="/auth/signup" className="mk-btn mk-btn-primary !min-h-[38px] !px-4 !py-2 !text-[13.5px]">
            Start free
          </Link>
          <button
            type="button"
            onClick={() => setMobile((v) => !v)}
            aria-label={mobile ? 'Close menu' : 'Open menu'}
            aria-expanded={mobile}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.1] text-slate-300 lg:hidden"
          >
            <Icon name={mobile ? 'X' : 'Menu'} className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* desktop mega panel */}
      {NAV.map((group) => {
        if (!group.columns?.length) return null;
        const on = open === group.label;
        return (
          <div
            key={`panel-${group.label}`}
            className={`absolute inset-x-0 top-full hidden justify-center px-5 transition-all duration-200 lg:flex ${
              on ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
            }`}
            onMouseEnter={() => hoverOpen(group.label)}
            aria-hidden={!on}
          >
            <div className="mk-glass mt-2 w-full max-w-[1100px] overflow-hidden rounded-2xl border border-white/[0.1] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)]">
              <div className={`grid gap-0 ${group.feature ? 'lg:grid-cols-[1fr_1fr_1fr_0.9fr]' : 'lg:grid-cols-3'}`}>
                {group.columns.map((col) => (
                  <div key={col.heading} className="border-white/[0.07] p-5 lg:border-r">
                    <div className="mk-eyebrow mb-3 text-slate-500">{col.heading}</div>
                    <ul className="space-y-0.5">
                      {col.links.map((l) => (
                        <li key={l.href + l.label}>
                          <Link
                            href={l.href}
                            className="group flex gap-3 rounded-xl p-2 transition-colors hover:bg-white/[0.05]"
                          >
                            {l.icon && (
                              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-400 transition-colors group-hover:border-sky-400/30 group-hover:text-sky-300">
                                <Icon name={l.icon} className="h-3.5 w-3.5" />
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="block text-[13.5px] font-semibold text-slate-200 group-hover:text-white">
                                {l.label}
                              </span>
                              {l.desc && <span className="mk-tiny mt-0.5 block">{l.desc}</span>}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {group.feature && (
                  <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/22 via-sky-600/10 to-transparent p-5">
                    <div className="mk-dot-bg pointer-events-none absolute inset-0 opacity-40" aria-hidden />
                    <div className="relative">
                      <div className="mk-h4 text-white">{group.feature.heading}</div>
                      <p className="mk-small mt-2 text-slate-400">{group.feature.body}</p>
                      <Link
                        href={group.feature.href}
                        className="mk-link mt-4 inline-flex items-center gap-1.5 text-[13px]"
                      >
                        {group.feature.cta}
                        <Icon name="ArrowRight" className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* mobile drawer */}
      <div
        className={`overflow-hidden border-t border-white/[0.07] transition-[max-height] duration-400 lg:hidden ${
          mobile ? 'max-h-[calc(100vh-64px)]' : 'max-h-0'
        }`}
      >
        <div className="max-h-[calc(100vh-64px)] overflow-y-auto px-5 pb-8 pt-4">
          {NAV.map((group) => {
            const hasMenu = Boolean(group.columns?.length);
            const on = mobileGroup === group.label;
            if (!hasMenu) {
              return (
                <Link
                  key={group.label}
                  href={group.href ?? '/'}
                  className="flex min-h-[48px] items-center border-b border-white/[0.06] text-[15px] font-semibold text-slate-200"
                >
                  {group.label}
                </Link>
              );
            }
            return (
              <div key={group.label} className="border-b border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setMobileGroup(on ? null : group.label)}
                  aria-expanded={on}
                  className="flex min-h-[48px] w-full items-center justify-between text-[15px] font-semibold text-slate-200"
                >
                  {group.label}
                  <Icon name="ChevronDown" className={`h-4 w-4 text-slate-500 transition-transform ${on ? 'rotate-180' : ''}`} />
                </button>
                <div className="grid transition-all duration-300" style={{ gridTemplateRows: on ? '1fr' : '0fr' }}>
                  <div className="overflow-hidden">
                    <div className="pb-3">
                      {group.columns?.map((col) => (
                        <div key={col.heading} className="mb-2">
                          <div className="mk-eyebrow mb-1.5 mt-2 text-slate-600">{col.heading}</div>
                          {col.links.map((l) => (
                            <Link
                              key={l.href + l.label}
                              href={l.href}
                              className="flex min-h-[42px] items-center gap-2.5 rounded-lg px-1 text-[14px] text-slate-400"
                            >
                              {l.icon && <Icon name={l.icon} className="h-4 w-4 text-slate-600" />}
                              {l.label}
                            </Link>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="mt-6 flex flex-col gap-2.5">
            <Link href="/auth/signup" className="mk-btn mk-btn-primary w-full">
              Start free
            </Link>
            <Link href="/auth/login" className="mk-btn mk-btn-ghost w-full">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
