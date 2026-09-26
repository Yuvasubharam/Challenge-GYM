import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import type { MemberStatus } from '../lib/types';
import { initials } from '../lib/format';

// ── Data loading ────────────────────────────────────────────────────────
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fn();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

// ── Toasts ──────────────────────────────────────────────────────────────
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
      <div className="fixed z-[80] left-1/2 -translate-x-1/2 bottom-24 lg:bottom-6 flex flex-col gap-2 w-[min(92vw,420px)]" aria-live="polite">
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

/** Run an async action with busy state + toast on success/failure. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast('ok', ok);
      return r;
    } catch (e) {
      toast('error', (e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

// ── Primitives ──────────────────────────────────────────────────────────
export const Spinner = ({ className = 'w-5 h-5' }: { className?: string }) => <Loader2 className={`animate-spin ${className}`} />;

export function PageLoader() {
  return <div className="flex justify-center py-24 text-ink-300"><Spinner className="w-7 h-7" /></div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="card card-pad flex items-center gap-3 text-sm">
      <AlertTriangle className="w-5 h-5 text-bad shrink-0" />
      <span className="flex-1">{error}</span>
      {onRetry && <button className="btn btn-outline btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      {icon && <div className="w-14 h-14 rounded-2xl bg-lime/15 text-lime-700 dark:text-lime flex items-center justify-center mb-4">{icon}</div>}
      <p className="font-display font-semibold text-lg">{title}</p>
      {hint && <p className="muted text-sm mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const STATUS: Record<MemberStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-ok/15 text-green-700 dark:text-ok' },
  near_expiry: { label: 'Near expiry', cls: 'bg-info/15 text-blue-700 dark:text-info' },
  expiring: { label: 'Expiring', cls: 'bg-warn/15 text-amber-700 dark:text-warn' },
  expired: { label: 'Expired', cls: 'bg-bad/15 text-red-700 dark:text-bad' },
  frozen: { label: 'Frozen', cls: 'bg-ink-300/20 text-ink-500 dark:text-ink-200' },
  none: { label: 'No plan', cls: 'bg-ink-300/20 text-ink-500 dark:text-ink-200' },
  staff: { label: 'Staff', cls: 'bg-lime/25 text-lime-800 dark:text-lime' },
};
export const statusLabel = (s: MemberStatus) => STATUS[s].label;
export const StatusBadge = ({ status }: { status: MemberStatus }) => <span className={`badge ${STATUS[status].cls}`}>{STATUS[status].label}</span>;

export function Avatar({ name, photo, size = 40 }: { name: string; photo?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.36 };
  if (photo) return <img src={`/api/files/${photo}`} alt="" style={style} className="rounded-full object-cover shrink-0 bg-ink-700" />;
  return (
    <div style={style} className="rounded-full shrink-0 flex items-center justify-center font-display font-bold bg-ink-900 text-lime dark:bg-ink-700">
      {initials(name)}
    </div>
  );
}

/** Circular progress (reference "Health Grade 90%" style). */
export function Ring({ value, size = 88, stroke = 9, children, tone = 'lime' }: { value: number; size?: number; stroke?: number; children?: ReactNode; tone?: 'lime' | 'warn' | 'bad' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = tone === 'lime' ? '#C8F135' : tone === 'warn' ? '#F5A524' : '#F0524F';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-black/10 dark:stroke-white/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={color} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">{children}</div>
    </div>
  );
}

// ── Overlays ────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92dvh] flex flex-col bg-paper-card dark:bg-ink-800 rounded-t-4xl sm:rounded-4xl border border-paper-line dark:border-ink-700 shadow-2xl`}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-paper-line dark:border-ink-700 flex gap-2 justify-end safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? 'bg-bad text-white hover:bg-red-600' : 'btn-primary'}`} disabled={busy} onClick={onConfirm}>{busy && <Spinner className="w-4 h-4" />}{confirmLabel}</button>
      </>}>
      <div className="text-sm muted leading-relaxed">{message}</div>
    </Modal>
  );
}

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[11px] muted mt-1">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="scroll-x -mx-1 px-1">
      <div className="flex gap-2 w-max">
        {options.map((o) => (
          <button key={o.value} className={`chip ${value === o.value ? 'chip-on' : ''}`} onClick={() => onChange(o.value)}>
            {o.label}{o.count !== undefined && <span className="opacity-60">{o.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-display font-semibold text-base sm:text-lg">{title}</h2>
      {action}
    </div>
  );
}
