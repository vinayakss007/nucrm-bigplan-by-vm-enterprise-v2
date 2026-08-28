/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // global-error renders OUTSIDE the themed <html> shell (it replaces the root
  // layout), so design-system CSS variables / Tailwind theme classes are not
  // available here. Use CSS system colors + `colorScheme: 'light dark'` so the
  // last-resort error page follows the OS light/dark preference instead of a
  // hardcoded light background that looks broken in dark mode (#1115).
  return (
    <html lang="en">
      <body style={{ margin: 0, colorScheme: 'light dark' }}>
        <div style={{ 
          minHeight: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          fontFamily: 'system-ui, sans-serif', 
          padding: '20px',
          backgroundColor: 'Canvas',
          color: 'CanvasText'
        }}>
          <div style={{ textAlign: 'center', maxWidth: '400px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>
              Something went wrong!
            </h1>
            <p style={{ opacity: 0.7, marginBottom: '24px' }}>
              A critical error occurred.
            </p>
            <button 
              onClick={() => window.location.reload()}
              style={{ 
                padding: '10px 20px', 
                backgroundColor: '#7c3aed', 
                color: 'white', 
                border: 'none', 
                borderRadius: '8px', 
                cursor: 'pointer' 
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}