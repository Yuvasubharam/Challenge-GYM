import { createContext, useContext, type ReactNode } from 'react';
import { api } from './api';
import type { Home } from './types';
import { useLoad } from '../components/ui';

interface Ctx { home: Home | null; error: string | null; reload: () => Promise<void> }
const HomeCtx = createContext<Ctx>({ home: null, error: null, reload: async () => {} });
export const useHome = () => useContext(HomeCtx);

export function HomeProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useLoad(() => api.get<Home>('/me'));
  return <HomeCtx.Provider value={{ home: data, error, reload }}>{children}</HomeCtx.Provider>;
}
