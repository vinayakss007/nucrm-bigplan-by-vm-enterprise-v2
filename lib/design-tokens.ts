/**
 * NuCRM Design System
 * Centralized design tokens for consistent UI/UX
 */

// ── Colors ─────────────────────────────────────────────────────────────────────
export const colors = {
  // Primary (Purple)
  primary: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
    400: '#c084fc',
    500: '#a855f7',
    600: '#9333ea',
    700: '#7c3aed',
    800: '#6b21a8',
    900: '#581c87',
    950: '#3b0764',
  },
  // Success (Green)
  success: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
  },
  // Warning (Amber)
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },
  // Error (Red)
  error: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
  },
  // Info (Blue)
  info: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  // Gray (Slate)
  gray: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
  // Utility
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
};

// ── Spacing ────────────────────────────────────────────────────────────────────
export const spacing = {
  unit: 4,
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 40,
  '3xl': 48,
  '4xl': 64,
};

// ── Typography ─────────────────────────────────────────────────────────────────
export const typography = {
  fontFamily: {
    sans: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'JetBrains Mono, "Fira Code", monospace',
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    none: 1,
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
};

// ── Shadows ────────────────────────────────────────────────────────────────────
export const shadows = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  none: 'none',
};

// ── Border Radius ──────────────────────────────────────────────────────────────
export const borderRadius = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  full: '9999px',
};

// ── Z-Index ────────────────────────────────────────────────────────────────────
export const zIndex = {
  hide: -1,
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  fixed: 1200,
  modalBackdrop: 1300,
  modal: 1400,
  popover: 1500,
  tooltip: 1600,
  toast: 1700,
};

// ── Transitions ────────────────────────────────────────────────────────────────
export const transitions = {
  duration: {
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
  },
  timing: {
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
  },
};

// ── Breakpoints ────────────────────────────────────────────────────────────────
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
};

// ── Component Tokens ───────────────────────────────────────────────────────────
export const button = {
  variants: {
    primary: {
      bg: colors.primary[600],
      bgHover: colors.primary[700],
      text: colors.white,
    },
    secondary: {
      bg: colors.gray[100],
      bgHover: colors.gray[200],
      text: colors.gray[900],
    },
    outline: {
      border: `2px solid ${colors.gray[300]}`,
      bg: 'transparent',
      bgHover: colors.gray[50],
      text: colors.gray[700],
    },
    ghost: {
      bg: 'transparent',
      bgHover: colors.gray[100],
      text: colors.gray[700],
    },
    danger: {
      bg: colors.error[600],
      bgHover: colors.error[700],
      text: colors.white,
    },
    success: {
      bg: colors.success[600],
      bgHover: colors.success[700],
      text: colors.white,
    },
  },
  sizes: {
    sm: { px: spacing.sm, py: spacing.xs, fontSize: typography.fontSize.xs },
    md: { px: spacing.md, py: spacing.sm, fontSize: typography.fontSize.sm },
    lg: { px: spacing.lg, py: spacing.md, fontSize: typography.fontSize.base },
    icon: { size: '2.5rem', padding: spacing.sm },
  },
};

export const input = {
  borderColor: colors.gray[300],
  borderColorFocus: colors.primary[500],
  bgColor: colors.white,
  textColor: colors.gray[900],
  placeholderColor: colors.gray[400],
  errorColor: colors.error[500],
  borderRadius: borderRadius.md,
  shadow: shadows.sm,
};

export const card = {
  bgColor: colors.white,
  borderColor: colors.gray[200],
  borderRadius: borderRadius.lg,
  shadow: shadows.md,
  shadowHover: shadows.lg,
};

export const badge = {
  variants: {
    default: { bg: colors.gray[100], text: colors.gray[700] },
    primary: { bg: colors.primary[100], text: colors.primary[700] },
    success: { bg: colors.success[100], text: colors.success[700] },
    warning: { bg: colors.warning[100], text: colors.warning[700] },
    error: { bg: colors.error[100], text: colors.error[700] },
    info: { bg: colors.info[100], text: colors.info[700] },
  },
};

// ── Utility Functions ──────────────────────────────────────────────────────────
export function getContrastText(bgColor: string): string {
  // Simple luminance check for contrast
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? colors.gray[900] : colors.white;
}

export function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Exports ────────────────────────────────────────────────────────────────────
export default {
  colors,
  spacing,
  typography,
  shadows,
  borderRadius,
  zIndex,
  transitions,
  breakpoints,
  button,
  input,
  card,
  badge,
  getContrastText,
  rgba,
};
