export const typographyTokens = {
  fontFamily: {
    sans: 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", "Cascadia Code", monospace',
    display: 'Fraunces, Georgia, serif',
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
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
} as const;
