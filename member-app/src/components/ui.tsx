import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { initials } from '../lib/format';
import type { Status } from '../lib/types';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fn();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[80] left-1/2 -translate-x-1/2 bottom-28 md:bottom-6 flex flex-col gap-2 w-[min(92vw,420px)]" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-start gap-2.5 rounded-2xl bg-ink-900 text-white px-4 py-3 text-sm shadow-xl border border-ink-700">
            {t.kind === 'ok' ? <CheckCircle2 className="w-5 h-5 text-lime shrink-0" /> : <AlertTriangle className="w-5 h-5 text-bad shrink-0" />}
            <span className="leading-snug">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast('ok', ok); return r; }
    catch (e) { toast('error', (e as Error).message); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return { busy, run };
}

export const Spinner = ({ className = 'w-5 h-5' }: { className?: string }) => <Loader2 className={`animate-spin ${className}`} />;
export const PageLoader = () => <div className="flex justify-center py-24 text-ink-300"><Spinner className="w-7 h-7" /></div>;

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="card card-pad flex items-center gap-3 text-sm">
      <AlertTriangle className="w-5 h-5 text-bad shrink-0" /><span className="flex-1">{error}</span>
      {onRetry && <button className="btn btn-outline btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-lime text-ink-900' },
  near_expiry: { label: 'Active', cls: 'bg-lime text-ink-900' },
  expiring: { label: 'Expiring soon', cls: 'bg-warn text-ink-900' },
  expired: { label: 'Expired', cls: 'bg-bad text-white' },
  frozen: { label: 'Frozen', cls: 'bg-ink-300 text-ink-900' },
  none: { label: 'No plan', cls: 'bg-ink-300 text-ink-900' },
  staff: { label: 'Staff', cls: 'bg-lime text-ink-900' },
};
export const StatusBadge = ({ status }: { status: Status }) => <span className={`badge ${STATUS[status].cls}`}>{STATUS[status].label}</span>;

export function Avatar({ name, hasPhoto, size = 44, version = 0 }: { name: string; hasPhoto?: boolean; size?: number; version?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.36 };
  if (hasPhoto) return <img src={`/api/me/photo?v=${version}`} alt="" style={style} className="rounded-full object-cover shrink-0 bg-ink-700" />;
  return <div style={style} className="rounded-full shrink-0 flex items-center justify-center font-display font-bold bg-lime text-ink-900">{initials(name)}</div>;
}

export function Ring({ value, size = 160, stroke = 14, children, tone = 'lime' }: { value: number; size?: number; stroke?: number; children?: ReactNode; tone?: 'lime' | 'warn' | 'bad' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = tone === 'lime' ? '#C8F135' : tone === 'warn' ? '#F5A524' : '#F0524F';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-white/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={color} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: 'stroke-dashoffset .8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[92dvh] flex flex-col bg-paper-card dark:bg-ink-800 rounded-t-4xl sm:rounded-4xl border border-paper-line dark:border-ink-700 shadow-2xl">
        <div className="mx-auto mt-2.5 w-10 h-1.5 rounded-full bg-black/10 dark:bg-white/15 sm:hidden" />
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-paper-line dark:border-ink-700 safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="label">{label}</span>{children}{hint && <span className="block text-[11px] muted mt-1">{hint}</span>}</label>;
}
