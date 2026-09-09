export type WorkspaceLocale = 'zh-CN' | 'en-US';
export type WorkspaceTheme = 'system' | 'light' | 'dark';

export function resolveLocale(
  persisted: string | undefined,
  browserLocale: string,
): WorkspaceLocale {
  if (persisted === 'zh-CN' || persisted === 'en-US') return persisted;
  return browserLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function resolveTheme(persisted: string | undefined): WorkspaceTheme {
  return persisted === 'light' || persisted === 'dark' || persisted === 'system'
    ? persisted
    : 'system';
}
