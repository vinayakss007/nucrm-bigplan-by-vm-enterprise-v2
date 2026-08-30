/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { Component, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Global Error Boundary]', error, errorInfo);
    Sentry.captureException(error, { extra: { errorInfo }, tags: { context: 'AppErrorBoundary' } });
    this.props.onError?.(error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const digest = (this.state.error as (Error & { digest?: string }) | null)?.digest;
      const showDetails = process.env.NODE_ENV !== 'production';
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-red-600" />
          </div>
          <h2 className="text-lg font-bold mb-1">Something went wrong</h2>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-2">
            An unexpected error occurred
          </p>
          {/* SECURITY (#1113/#1221/#1260): generic message + digest id in production;
              the raw message is only rendered outside production. */}
          {digest && (
            <p className="text-[10px] text-muted-foreground/70 text-center max-w-sm mb-2 font-mono">
              Error ID: {digest}
            </p>
          )}
          {showDetails && this.state.error?.message && (
            <p className="text-xs text-red-500 text-center max-w-sm mb-4 font-mono break-all">
              {this.state.error.message}
            </p>
          )}
          {!showDetails && (
            <p className="text-[10px] text-muted-foreground text-center max-w-sm mb-4 font-mono">
              Check console (F12) for full error details
            </p>
          )}
          <button onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
