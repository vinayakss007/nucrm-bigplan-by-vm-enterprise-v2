/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
export default function Loading() {
  return (
    <div className="animate-pulse w-full space-y-4">
      <div className="h-7 w-56 bg-muted rounded" />
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 w-20 bg-muted rounded-lg" />
        ))}
      </div>
      <div className="admin-card p-5 space-y-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-12 bg-muted rounded-xl" />
        ))}
      </div>
    </div>
  );
}
