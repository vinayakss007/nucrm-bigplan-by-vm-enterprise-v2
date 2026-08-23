/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
export default function Loading() {
  return (
    <div className="animate-pulse w-full space-y-4">
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="admin-card p-5 space-y-4">
        {[...Array(4)].map((_,i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-10 bg-muted rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
