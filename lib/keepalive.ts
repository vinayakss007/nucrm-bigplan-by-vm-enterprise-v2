/**
 * Smart Keep-Alive Service for Neon Database
 * 
 * Automatically detects if you're using Neon (serverless)
 * and only runs keep-alive when needed.
 * 
 * For Traditional PostgreSQL: Does nothing (not needed)
 * For Neon (Serverless): Smart traffic-based keep-alive
 * 
 * Usage: Add to app/layout.tsx or main provider
 */

// Detect if using Neon database
function isNeonDatabase(): boolean {
  const dbUrl = process.env['NEXT_PUBLIC_DATABASE_URL'] || process.env['DATABASE_URL'] || '';
  return dbUrl.includes('neon.tech') || dbUrl.includes('neondb');
}

let keepAliveInterval: NodeJS.Timeout | null = null;
let lastRequestTime: number = Date.now();
let isEnabled = false;

// Track page views/interactions
function trackActivity() {
  lastRequestTime = Date.now();
}

// Ping the keep-alive endpoint
async function pingDatabase() {
  try {
    const response = await fetch('/api/keepalive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    
    if (response.ok) {
      console.log('[KeepAlive] ✓ Database connection warmed');
    } else {
      console.warn('[KeepAlive] ⚠ Keep-alive returned non-OK status');
    }
  } catch (err) {
    console.error('[KeepAlive] ✗ Keep-alive failed:', err);
  }
}

// Check if we should ping (no activity for N minutes)
function shouldPing(idleThresholdMs: number): boolean {
  const idleTime = Date.now() - lastRequestTime;
  return idleTime >= idleThresholdMs;
}

export function startNeonKeepAlive(options?: {
  /** Check interval in ms (default: 2 minutes) */
  checkInterval?: number;
  /** Idle threshold before ping (default: 10 minutes) */
  idleThreshold?: number;
  /** Force enable even if not Neon (for testing) */
  forceEnable?: boolean;
}) {
  // Auto-detect if using Neon
  const usingNeon = isNeonDatabase();
  const forceEnable = options?.forceEnable || false;
  
  isEnabled = usingNeon || forceEnable;
  
  // Skip if not using Neon
  if (!isEnabled) {
    console.log('[KeepAlive] ℹ️ Not using Neon database - keep-alive disabled');
    console.log('[KeepAlive] ℹ️ Traditional PostgreSQL detected - no keep-alive needed');
    return;
  }

  if (keepAliveInterval) {
    console.log('[KeepAlive] ℹ️ Already running');
    return;
  }

  const checkInterval = options?.checkInterval || 2 * 60 * 1000; // 2 min
  const idleThreshold = options?.idleThreshold || 10 * 60 * 1000; // 10 min

  console.log(`[KeepAlive] ✅ Neon detected - Starting traffic-based keep-alive...`);
  console.log(`[KeepAlive] Will ping after ${idleThreshold / 60000} min of idle time`);
  console.log(`[KeepAlive] Check interval: ${checkInterval / 60000} min`);
  
  // Track user activity
  if (typeof window !== 'undefined') {
    // Track clicks
    document.addEventListener('click', trackActivity);
    
    // Track scrolls
    document.addEventListener('scroll', trackActivity, { passive: true });
    
    // Track keypresses
    document.addEventListener('keydown', trackActivity);
    
    // Track page visibility (pause when tab hidden)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        trackActivity();
      }
    });
  }

  // Check periodically if we need to ping
  keepAliveInterval = setInterval(() => {
    // Don't ping if user is actively using the app
    if (shouldPing(idleThreshold)) {
      console.log('[KeepAlive] No activity for 10 min, warming up database...');
      pingDatabase();
    }
  }, checkInterval);

  // Cleanup on page unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      stopNeonKeepAlive();
    });
  }
}

export function stopNeonKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('[KeepAlive] Stopped');
  }
  
  // Remove event listeners
  if (typeof window !== 'undefined') {
    document.removeEventListener('click', trackActivity);
    document.removeEventListener('scroll', trackActivity);
    document.removeEventListener('keydown', trackActivity);
  }
}

/**
 * Manually trigger keep-alive (useful after long operations)
 */
export function forceKeepAlive() {
  if (isEnabled) {
    pingDatabase();
  }
}

/**
 * Check if keep-alive is enabled
 */
export function isKeepAliveEnabled(): boolean {
  return isEnabled;
}

/**
 * Get database type (for debugging)
 */
export function getDatabaseType(): 'neon' | 'traditional' | 'unknown' {
  if (isNeonDatabase()) return 'neon';
  
  const dbUrl = process.env['NEXT_PUBLIC_DATABASE_URL'] || process.env['DATABASE_URL'] || '';
  if (dbUrl) return 'traditional';
  
  return 'unknown';
}
