import { describe, expect, it } from 'vitest';
import { resolveLocale, resolveTheme } from './preferences';

describe('Workspace presentation preferences', () => {
  it('supports zh-CN and en-US with a natural browser fallback', () => {
    expect(resolveLocale('zh-TW', 'en-US')).toBe('en-US');
    expect(resolveLocale(undefined, 'zh-CN')).toBe('zh-CN');
    expect(resolveLocale('invalid', 'fr-FR')).toBe('en-US');
  });

  it('accepts only non-sensitive theme names', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('message content')).toBe('system');
    expect(resolveTheme(undefined)).toBe('system');
  });
});
