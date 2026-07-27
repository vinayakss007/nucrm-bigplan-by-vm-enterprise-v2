/**
 * Skeletons for Next.js `loading.tsx` boundaries.
 *
 * A segment without a `loading.tsx` has no Suspense boundary, so navigation into
 * it renders nothing until the server component resolves — the blank-screen
 * complaint. Placing one at a segment root covers that segment and every child
 * that does not define its own, which is why a handful of files here replaces
 * ~150 per-page ones.
 *
 * Server components on purpose: a skeleton needs no interactivity, and marking it
 * 'use client' would ship it to the browser for no benefit.
 */

/** Neutral shell: page heading, an action, and a card. */
export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 bg-muted rounded-xl" />
        <div className="h-9 w-28 bg-muted rounded-xl" />
      </div>
      <div className="admin-card p-5 space-y-3">
        <div className="h-5 w-40 bg-muted rounded" />
        <div className="h-4 w-full bg-muted rounded" />
        <div className="h-4 w-5/6 bg-muted rounded" />
        <div className="h-4 w-2/3 bg-muted rounded" />
      </div>
    </div>
  );
}

/** List/table shell, matching the shape most CRM index pages settle into. */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 bg-muted rounded-xl" />
        <div className="h-9 w-28 bg-muted rounded-xl" />
      </div>
      <div className="admin-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="h-5 w-32 bg-muted rounded" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="h-3 w-32 bg-muted rounded" />
              </div>
              <div className="h-5 w-16 bg-muted rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Centred card, for the auth and portal flows. */
export function CenteredSkeleton() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 animate-pulse"
      aria-hidden="true"
    >
      <div className="w-full max-w-sm space-y-4">
        <div className="h-8 w-40 bg-muted rounded-xl mx-auto" />
        <div className="admin-card p-6 space-y-4">
          <div className="h-4 w-24 bg-muted rounded" />
          <div className="h-10 w-full bg-muted rounded-xl" />
          <div className="h-4 w-24 bg-muted rounded" />
          <div className="h-10 w-full bg-muted rounded-xl" />
          <div className="h-10 w-full bg-muted rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * Announces that a page is loading.
 *
 * The skeletons are `aria-hidden` because a screen reader reciting dozens of
 * empty boxes is worse than silence. This gives assistive tech one polite
 * announcement instead, addressing the missing-aria-live gap for route
 * transitions.
 */
export function LoadingAnnouncement({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}
