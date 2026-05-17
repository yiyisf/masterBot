export const colorTokens = {
  brand: {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
    700: '#6d28d9',
    800: '#5b21b6',
    900: '#4c1d95',
  },
  surface: {
    base: 'var(--background)',
    elevated: 'var(--card)',
    overlay: 'var(--popover)',
  },
  text: {
    primary: 'var(--foreground)',
    secondary: 'var(--muted-foreground)',
    disabled: 'oklch(0.7 0 0)',
  },
  semantic: {
    success: 'oklch(0.6 0.15 145)',
    warning: 'oklch(0.75 0.15 75)',
    error: 'var(--destructive)',
    info: 'oklch(0.55 0.15 240)',
  },
  border: {
    default: 'var(--border)',
    focus: 'var(--ring)',
    strong: 'oklch(0.7 0 0)',
  },
} as const;
