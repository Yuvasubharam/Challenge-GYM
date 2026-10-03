import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, Clock3, Copy, ImagePlus, Receipt, Smartphone, Ticket, XCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { useHome } from '../lib/home';
import { processScreenshot } from '../lib/photo';
import type { MyPayment, Plan } from '../lib/types';
import { ErrorBox, Field, PageLoader, Sheet, Spinner, useAction, useLoad } from '../components/ui';

interface PlanData {
  memberships: { id: number; category: string; duration_label: string; start_date: string; end_date: string; price: number; kind: string; paid: number; due: number }[];
  plans: Plan[];
  pending_renewal: { id: number; amount: number; paid_on: string; plan_name: string } | null;
}

export default function PlanPage() {
  const { home, reload: reloadHome } = useHome();
  const { data, error, reload } = useLoad(() => api.get<PlanData>('/me/plan'));
  const { data: payments, reload: reloadPayments } = useLoad(() => api.get<MyPayment[]>('/me/payments'));
  const [pay, setPay] = useState<{ amount: number; plan?: Plan } | null>(null);
  const [category, setCategory] = useState<string>('');

  useEffect(() => { if (data && !category) setCategory(home?.plan.category && data.plans.some((p) => p.category === home.plan.category) ? home.plan.category : data.plans[0]?.category ?? ''); }, [data, home, category]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data || !home) return <PageLoader />;
  const p = home.plan;
  const cats = [...new Set(data.plans.map((x) => x.category))];
  const done = () => { setPay(null); void reload(); void reloadPayments(); void reloadHome(); };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl sm:text-3xl font-bold pt-1">My plan</h1>

      <section className="card card-pad">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs muted font-semibold uppercase tracking-wide">Current</p>
            <p className="font-display text-xl font-bold mt-1">{p.category ?? 'No active plan'}</p>
            <p className="text-sm muted">{p.duration_label}{p.start_date && ` · ${date(p.start_date)} → ${date(p.end_date)}`}</p>
          </div>
          {p.price !== null && <p className="font-display text-xl font-bold">{money(p.price)}</p>}
        </div>
        {p.due > 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-warn/10 px-4 py-3">
            <p className="text-sm flex-1">Dues pending <b>{money(p.due)}</b></p>
            <button className="btn btn-dark btn-sm" onClick={() => setPay({ amount: p.due })}>Pay now</button>
          </div>
        )}
      </section>

      {data.pending_renewal && (
        <section className="card card-pad flex gap-3 border-warn/40 dark:border-warn/40">
          <Clock3 className="w-5 h-5 text-warn shrink-0 mt-0.5" />
          <p className="text-sm">Your <b>{data.pending_renewal.plan_name}</b> renewal ({money(data.pending_renewal.amount)}) is waiting for the front desk to confirm the payment. Door access renews as soon as they do.</p>
        </section>
      )}

      {/* Renew — reference "Categories" style cards */}
      <section>
        <h2 className="font-display font-semibold text-lg mb-3">{['expired', 'expiring', 'none'].includes(p.status) ? 'Renew your membership' : 'Extend your membership'}</h2>
        {cats.length > 1 && (
          <div className="flex gap-2 mb-3 scroll-x">
            {cats.map((c) => <button key={c} className={`chip ${category === c ? 'chip-on' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {data.plans.filter((x) => x.category === category).map((x) => {
            const months = x.duration_months || 1;
            const best = x.duration_months >= 6;
            return (
              <button key={x.id} onClick={() => setPay({ amount: x.price, plan: x })} disabled={!!data.pending_renewal}
                className={`relative text-left rounded-3xl p-4 border transition active:scale-[.98] disabled:opacity-50
                  ${best ? 'bg-ink-900 text-white border-ink-700' : 'bg-paper-card dark:bg-ink-800 border-paper-line dark:border-ink-700 hover:border-lime'}`}>
                {best && <span className="absolute -top-2 right-3 badge bg-lime text-ink-900">Best value</span>}
                <p className={`text-xs font-semibold ${best ? 'text-ink-300' : 'muted'}`}>{x.duration_months ? `${x.duration_months} month${x.duration_months > 1 ? 's' : ''}` : `${x.duration_days} days`}</p>
                <p className="font-display text-2xl font-bold mt-1">{money(x.price)}</p>
                <p className={`text-xs mt-1 ${best ? 'text-lime' : 'muted'}`}>{money(Math.round(x.price / months))}/mo</p>
              </button>
            );
          })}
        </div>
        <p className="text-xs muted mt-3">{['expired', 'none'].includes(p.status) ? 'Your new plan starts from the day the gym confirms payment.' : 'Renewing early? Your new plan continues from your current end date — no days lost.'}</p>
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg mb-3">Payments</h2>
        {!payments ? <PageLoader /> : payments.length === 0 ? <p className="text-sm muted">No payments yet.</p> : (
          <div className="card overflow-hidden">
            <ul>
              {payments.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-4 py-3 border-t first:border-t-0 border-paper-line dark:border-ink-700">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0
                    ${x.status === 'confirmed' ? 'bg-lime/20 text-lime-700 dark:text-lime' : x.status === 'pending' ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad'}`}>
                    {x.status === 'confirmed' ? <CheckCircle2 className="w-5 h-5" /> : x.status === 'pending' ? <Clock3 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{money(x.amount)} <span className="text-xs muted font-normal uppercase">{x.mode}</span></p>
                    <p className="text-xs muted truncate">{date(x.paid_on)} · {x.status === 'pending' ? 'Waiting for confirmation' : x.status === 'rejected' ? (x.remarks?.match(/Rejected: (.*)$/)?.[1] ?? 'Not accepted') : `${x.category ?? ''} ${x.duration_label ?? ''}`.trim() || x.entry_type}</p>
                  </div>
                  {x.status === 'confirmed' && <Link to={`/receipt/${x.id}`} className="icon-btn" aria-label="Receipt"><Receipt className="w-4 h-4" /></Link>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {pay && <PaySheet amount={pay.amount} plan={pay.plan} onClose={() => setPay(null)} onDone={done} />}
    </div>
  );
}

interface PromoQuote { list: number; discount: number; total: number; bonus_days: number; coupon: { code: string; description: string | null } | null }

function PaySheet({ amount: listAmount, plan, onClose, onDone }: { amount: number; plan?: Plan; onClose: () => void; onDone: () => void }) {
  const { home } = useHome();
  const { busy, run } = useAction();
  const [qr, setQr] = useState('');
  const [utr, setUtr] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  // Promo code (renewals only): validated by the server; the desk applies it on confirmation.
  const [code, setCode] = useState('');
  const [promo, setPromo] = useState<PromoQuote | null>(null);
  const [promoErr, setPromoErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const amount = promo?.total ?? listAmount;
  const applyPromo = async () => {
    if (!plan || !code.trim()) return;
    setChecking(true); setPromoErr(null);
    try { setPromo(await api.get<PromoQuote>(`/me/coupon-quote?plan_id=${plan.id}&code=${encodeURIComponent(code.trim())}`)); }
    catch (e) { setPromo(null); setPromoErr((e as Error).message); }
    finally { setChecking(false); }
  };
  const upi = home?.upi;
  const note = `CG ${home?.member.essl_id ?? ''} ${plan ? plan.name : 'Dues'}`.slice(0, 60);
  const link = upi ? `upi://pay?pa=${encodeURIComponent(upi.vpa)}&pn=${encodeURIComponent(upi.payee)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}` : '';
  const isPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);

  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: '#0E0F11', light: '#FFFFFF' } }).then(setQr).catch(() => setQr('')); }, [link]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    const r = await run(async () => {
      const img = await processScreenshot(file);
      const res = await api.upload<{ proof_key: string }>('/me/proof', img);
      return { ...res, img };
    });
    setUploading(false);
    if (r) { setProof(r.proof_key); setPreview(URL.createObjectURL(r.img)); }
  };

  const submit = () => run(() => api.post('/me/payments', { amount, reference: utr.trim(), plan_id: plan?.id, proof_key: proof, coupon_code: promo?.coupon?.code }),
    'Sent! The front desk will confirm shortly.').then((r) => r && onDone());

  return (
    <Sheet open onClose={onClose} title={plan ? `Renew — ${plan.name}` : 'Pay dues'}
      footer={upi ? <button className="btn btn-primary btn-lg w-full" disabled={busy || utr.trim().length < 6 || uploading || !proof} onClick={submit}>{busy && <Spinner className="w-4 h-4" />}I've paid — send for confirmation</button> : undefined}>
      <div className="text-center rounded-3xl bg-lime/15 py-5 mb-4">
        <p className="text-xs muted font-semibold">Amount</p>
        <p className="font-display text-4xl font-bold">{money(amount)}</p>
        {promo && promo.discount > 0 && <p className="text-xs mt-1"><span className="line-through muted">{money(promo.list)}</span> <b className="text-lime-700 dark:text-lime">You save {money(promo.discount)}</b></p>}
        {promo && promo.bonus_days > 0 && <p className="text-xs font-semibold text-lime-700 dark:text-lime mt-1">+{promo.bonus_days} free days added to your plan</p>}
      </div>
      {plan && (
        <div className="mb-5">
          {promo?.coupon ? (
            <div className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-lime px-4 py-2.5">
              <Ticket className="w-4 h-4 text-lime-700 dark:text-lime" />
              <span className="flex-1 text-sm"><b className="font-mono">{promo.coupon.code}</b> applied{promo.coupon.description ? <span className="block text-xs muted">{promo.coupon.description}</span> : null}</span>
              <button className="text-xs font-semibold underline muted" onClick={() => { setPromo(null); setCode(''); }}>Remove</button>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold muted mb-1.5">Have a promo code?</p>
              <div className="flex gap-2">
                <input className="input font-mono uppercase h-10" value={code} placeholder="Enter code" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                  onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/\s/g, '')); setPromoErr(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void applyPromo(); }} />
                <button className="btn btn-dark h-10" disabled={!code.trim() || checking} onClick={applyPromo}>{checking ? <Spinner className="w-4 h-4" /> : 'Apply'}</button>
              </div>
              {promoErr && <p className="text-xs text-bad mt-1.5">{promoErr}</p>}
            </>
          )}
        </div>
      )}
      {!upi ? (
        <p className="text-sm muted text-center pb-4">Online payment isn't set up yet. Please pay at the front desk{home?.gym.phone ? ` or call ${home.gym.phone}` : ''}.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold mb-2"><span className="inline-flex w-6 h-6 rounded-full bg-ink-900 text-lime dark:bg-lime dark:text-ink-900 text-xs items-center justify-center mr-2">1</span>Pay with any UPI app</p>
            {isPhone && <a href={link} className="btn btn-dark btn-lg w-full mb-3"><Smartphone className="w-5 h-5" />Open GPay / PhonePe / Paytm</a>}
            <div className={`flex items-center gap-4 ${isPhone ? '' : 'flex-col'}`}>
              {qr && <img src={qr} alt="UPI QR code" className={`rounded-2xl border border-paper-line dark:border-ink-600 bg-white p-2 ${isPhone ? 'w-28' : 'w-52'}`} />}
              <div className={`text-sm ${isPhone ? '' : 'text-center'}`}>
                <p className="muted">{isPhone ? 'Or scan from another phone' : 'Scan with your UPI app'}</p>
                <button type="button" className="font-mono font-semibold mt-1 inline-flex items-center gap-1.5" onClick={() => { void navigator.clipboard?.writeText(upi.vpa); setCopied(true); }}>
                  {upi.vpa}{copied ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5 muted" />}
                </button>
                <p className="text-xs muted">{upi.payee}</p>
              </div>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold mb-2"><span className="inline-flex w-6 h-6 rounded-full bg-ink-900 text-lime dark:bg-lime dark:text-ink-900 text-xs items-center justify-center mr-2">2</span>Enter the transaction ID</p>
            <Field label="UPI transaction ID / UTR" hint="12-digit number shown in your UPI app after paying">
              <input className="input font-mono tracking-wide" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\s/g, ''))} inputMode="numeric" placeholder="e.g. 426512345678" autoComplete="off" />
            </Field>
          </div>
          <div>
            <p className="text-sm font-semibold mb-2"><span className="inline-flex w-6 h-6 rounded-full bg-ink-900 text-lime dark:bg-lime dark:text-ink-900 text-xs items-center justify-center mr-2">3</span>Upload the payment screenshot <span className="text-bad">*</span></p>
            <label className={`flex items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3 cursor-pointer ${proof ? 'border-ok/60' : 'border-paper-line dark:border-ink-600 hover:border-lime'}`}>
              {preview ? <img src={preview} alt="Payment screenshot" className="w-12 h-16 object-cover rounded-lg border border-paper-line dark:border-ink-600" />
                : <span className="w-12 h-12 rounded-xl bg-black/5 dark:bg-white/10 flex items-center justify-center">{uploading ? <Spinner className="w-5 h-5" /> : <ImagePlus className="w-5 h-5" />}</span>}
              <span className="flex-1 text-sm">
                {uploading ? 'Uploading…' : proof ? <span className="inline-flex items-center gap-1.5 font-semibold"><CheckCircle2 className="w-4 h-4 text-ok" />Screenshot attached</span> : <b>Tap to attach screenshot</b>}
                <span className="block text-xs muted">{proof ? 'Tap to change' : 'Required — the success screen showing amount and UTR'}</span>
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          <p className="text-xs muted">{plan ? 'Once the gym confirms your payment, your plan renews and your fingerprint access is restored automatically.' : 'The gym will confirm your payment and clear your dues.'}</p>
        </div>
      )}
    </Sheet>
  );
}
