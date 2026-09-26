import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';

export interface Session { aid: number; mid: number; name: string; role: 'member' }

interface Ctx { session: Session | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const SessionCtx = createContext<Ctx>(null as unknown as Ctx);
export const useSession = () => useContext(SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setSession(await api.get<Session>('/auth/me')); } catch { setSession(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { setUnauthorizedHandler(() => setSession(null)); void refresh(); }, [refresh]);
  const logout = useCallback(async () => { await api.post('/auth/logout').catch(() => undefined); setSession(null); }, []);
  return <SessionCtx.Provider value={{ session, loading, refresh, logout }}>{children}</SessionCtx.Provider>;
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('cg-theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
    setDark(next);
  };
  return { dark, toggle };
}
