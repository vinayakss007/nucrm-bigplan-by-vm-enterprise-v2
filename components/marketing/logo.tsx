import Link from 'next/link';

/**
 * The NuCRM mark: a rounded gradient tile carrying a geometric "N" with the
 * brand's violet accent dot. Drawn inline so it stays crisp at any size and
 * needs no asset request.
 */
export function LogoMark({ size = 34, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: 'linear-gradient(148deg, #8b5cf6 0%, #6366f1 55%, #4f46e5 100%)',
        boxShadow: '0 6px 20px -6px rgba(124,58,237,0.85), inset 0 1px 0 rgba(255,255,255,0.3)',
      }}
    >
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
        <path
          d="M10 22.5V9.5h2.6l7 9.1V9.5h2.6"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="22.2" cy="22" r="2.1" fill="#67e8f9" />
      </svg>
    </span>
  );
}

/**
 * Full lockup. `by abetworks` is intentionally lowercase and small — it is the
 * maker's signature under the product name, never a competing headline.
 */
export function Logo({
  size = 34,
  href = '/',
  showLockup = true,
  className = '',
}: {
  size?: number;
  href?: string | null;
  showLockup?: boolean;
  className?: string;
}) {
  const inner = (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="flex flex-col leading-none">
        <span
          className="font-extrabold tracking-tight text-white"
          style={{ fontSize: size * 0.56, letterSpacing: '-0.03em' }}
        >
          NuCRM
        </span>
        {showLockup && (
          <span
            className="font-medium lowercase text-slate-400"
            style={{ fontSize: Math.max(9.5, size * 0.275), letterSpacing: '0.06em', marginTop: 2 }}
          >
            by abetworks
          </span>
        )}
      </span>
    </span>
  );

  if (!href) return inner;

  return (
    <Link href={href} aria-label="NuCRM by abetworks — home" className="group inline-flex">
      {inner}
    </Link>
  );
}

/** Standalone wordmark for the studio itself. Always lowercase. */
export function AbetworksWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-extrabold lowercase tracking-tight ${className}`} style={{ letterSpacing: '-0.03em' }}>
      abetworks
    </span>
  );
}
