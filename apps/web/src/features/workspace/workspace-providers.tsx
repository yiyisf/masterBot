'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  resolveLocale,
  resolveTheme,
  type WorkspaceLocale,
  type WorkspaceTheme,
} from './preferences';

const localePreferenceKey = 'cmaster.workspace.locale';
const themePreferenceKey = 'cmaster.workspace.theme';

interface WorkspacePreferences {
  locale: WorkspaceLocale;
  setLocale(locale: WorkspaceLocale): void;
  theme: WorkspaceTheme;
  setTheme(theme: WorkspaceTheme): void;
}

const PreferencesContext = createContext<WorkspacePreferences | undefined>(undefined);

export function useWorkspacePreferences(): WorkspacePreferences {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('WorkspacePreferencesProvider is missing');
  return value;
}

export function WorkspaceProviders({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, retry: 2, refetchOnWindowFocus: true },
    },
  }));
  const [locale, setLocaleState] = useState<WorkspaceLocale>('zh-CN');
  const [theme, setThemeState] = useState<WorkspaceTheme>('system');

  useEffect(() => {
    try {
      // Hydration uses stable defaults; preferences are synchronized from Browser-only storage afterward.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocaleState(resolveLocale(
        window.localStorage.getItem(localePreferenceKey) ?? undefined,
        navigator.language,
      ));
      setThemeState(resolveTheme(window.localStorage.getItem(themePreferenceKey) ?? undefined));
    } catch {
      // Storage may be unavailable under Browser privacy policy; defaults remain fully usable.
    }
  }, []);

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyPresentationPreferences = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && colorScheme.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.lang = locale;
    };
    applyPresentationPreferences();
    colorScheme.addEventListener('change', applyPresentationPreferences);
    return () => colorScheme.removeEventListener('change', applyPresentationPreferences);
  }, [locale, theme]);

  function setLocale(value: WorkspaceLocale): void {
    try {
      window.localStorage.setItem(localePreferenceKey, value);
    } catch {
      // Preference persistence is optional and cannot block Workspace use.
    }
    setLocaleState(value);
  }

  function setTheme(value: WorkspaceTheme): void {
    try {
      window.localStorage.setItem(themePreferenceKey, value);
    } catch {
      // Preference persistence is optional and cannot block Workspace use.
    }
    setThemeState(value);
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesContext.Provider value={{ locale, setLocale, theme, setTheme }}>
        {children}
      </PreferencesContext.Provider>
    </QueryClientProvider>
  );
}
