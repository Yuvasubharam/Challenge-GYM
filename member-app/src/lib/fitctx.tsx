import { createContext, useContext, useState, type ReactNode } from 'react';
import { api } from './api';
import type { FitProfile, WeighIn } from './fit';
import type { RawProfile } from '../pages/Onboarding';
import Onboarding from '../pages/Onboarding';
import { PageLoader, useLoad } from '../components/ui';
import { useHome } from './home';

interface ProfileRes { onboarded: boolean; profile: FitProfile | null; raw: RawProfile | null; weigh_in: WeighIn | null }
interface Ctx { fit: ProfileRes | null; reload: () => Promise<void>; edit: () => void }
const FitCtx = createContext<Ctx>({ fit: null, reload: async () => {}, edit: () => {} });
export const useFit = () => useContext(FitCtx);

const SKIP_KEY = 'cg-onboarding-skipped';

/** Loads the fitness profile; shows onboarding after first sign-in (skippable once per session). */
export function FitProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useLoad(() => api.get<ProfileRes>('/fit/profile'));
  const { home } = useHome();
  const [skipped, setSkipped] = useState(() => { try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } });
  const [editing, setEditing] = useState(false);

  if (!data) return <PageLoader />;
  const skip = () => { try { sessionStorage.setItem(SKIP_KEY, '1'); } catch { /* ignore */ } setSkipped(true); setEditing(false); };
  if ((!data.onboarded && !skipped) || editing) {
    return <Onboarding initial={data.raw} gender={home?.member.gender} editing={editing && data.onboarded}
      onSkip={editing ? () => setEditing(false) : skip} onDone={() => { setEditing(false); setSkipped(true); void reload(); }} />;
  }
  return <FitCtx.Provider value={{ fit: data, reload, edit: () => setEditing(true) }}>{children}</FitCtx.Provider>;
}
