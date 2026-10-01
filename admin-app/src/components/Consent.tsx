// Risk-acceptance consent at the desk: pick the language, read + tick "I agree", then sign.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Eraser, FileSignature, Languages } from 'lucide-react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { CONSENT, CONSENT_LANG_LABEL, CURRENT_CONSENT, type ConsentLang } from '../lib/consent';
import { Field, Modal, Spinner, useAction } from './ui';
import { SignaturePad, SignatureView, type SignaturePadHandle } from './Signature';

export interface StoredConsent { id: number; version: string; lang: ConsentLang; signer_name: string; signature: string; signed_at: string; witnessed_by: string | null }

const LANG_KEY = 'cg_consent_lang';

function ConsentText({ version, lang, name }: { version: string; lang: ConsentLang; name: string }) {
  const t = CONSENT[version]?.[lang];
  if (!t) return <p className="text-sm muted">Consent text {version} is not available in this app version.</p>;
  return (
    <div lang={lang} className="text-sm leading-relaxed">
      <p className="font-display font-bold text-base mb-2">{t.title}</p>
      <p className="mb-2">{t.intro(name)}</p>
      <ol className="list-decimal pl-5 space-y-2">{t.points.map((p, i) => <li key={i}>{p}</li>)}</ol>
    </div>
  );
}

export function ConsentModal({ open, onClose, onSigned, memberId, name }: {
  open: boolean; onClose: () => void; onSigned: () => void; memberId: number; name: string;
}) {
  const [lang, setLang] = useState<ConsentLang>(() => { try { return (localStorage.getItem(LANG_KEY) as ConsentLang) || 'en'; } catch { return 'en'; } });
  const [step, setStep] = useState<'read' | 'sign'>('read');
  const [agreed, setAgreed] = useState(false);
  const [signer, setSigner] = useState(name);
  const [empty, setEmpty] = useState(true);
  const pad = useRef<SignaturePadHandle>(null);
  const { busy, run } = useAction();
  const t = CONSENT[CURRENT_CONSENT][lang];

  useEffect(() => { if (open) { setStep('read'); setAgreed(false); setSigner(name); setEmpty(true); } }, [open, name]);
  const pickLang = (l: ConsentLang) => { setLang(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ } };

  const save = () => run(() => api.post(`/members/${memberId}/consent`, {
    version: CURRENT_CONSENT, lang, agreed, signer_name: signer, signature: pad.current!.toPath(),
  }), 'Consent signed and saved').then((r) => { if (r) onSigned(); });

  return (
    <Modal open={open} onClose={onClose} wide title={step === 'read' ? 'Risk consent' : 'Signature'}
      footer={step === 'read' ? <>
        <button className="btn btn-outline" onClick={onClose}>Later</button>
        <button className="btn btn-primary" disabled={!agreed} onClick={() => setStep('sign')}>Continue to sign<ArrowRight className="w-4 h-4" /></button>
      </> : <>
        <button className="btn btn-outline mr-auto" onClick={() => setStep('read')}><ArrowLeft className="w-4 h-4" />Back</button>
        <button className="btn btn-outline" onClick={() => pad.current?.clear()}><Eraser className="w-4 h-4" />Clear</button>
        <button className="btn btn-primary" disabled={busy || empty || !signer.trim()} onClick={() => void save()}>{busy && <Spinner className="w-4 h-4" />}<FileSignature className="w-4 h-4" />Save signature</button>
      </>}>
      {step === 'read' ? (
        <div className="space-y-4">
          <Field label="Language / భాష / भाषा">
            <div className="relative">
              <Languages className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 muted pointer-events-none" />
              <select className="input pl-11" value={lang} onChange={(e) => pickLang(e.target.value as ConsentLang)}>
                {(Object.keys(CONSENT_LANG_LABEL) as ConsentLang[]).map((l) => <option key={l} value={l}>{CONSENT_LANG_LABEL[l]}</option>)}
              </select>
            </div>
          </Field>
          <div className="rounded-3xl bg-black/[.03] dark:bg-white/[.04] p-4 max-h-[45dvh] overflow-y-auto"><ConsentText version={CURRENT_CONSENT} lang={lang} name={name} /></div>
          <label lang={lang} className="flex items-start gap-3 rounded-2xl border border-paper-line dark:border-ink-600 p-4 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 mt-0.5 accent-lime-600 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span className="text-sm font-semibold">{t.agree}{lang !== 'en' && <span className="block font-normal muted text-xs mt-0.5">{CONSENT[CURRENT_CONSENT].en.agree}</span>}</span>
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm muted">Hand the screen to the member. They sign with a finger, stylus or mouse.</p>
          <SignaturePad ref={pad} onChange={setEmpty} placeholder={t.signHere} />
          <Field label="Signed by" hint="Usually the member. For a minor, the parent/guardian signs — enter their name.">
            <input className="input" value={signer} onChange={(e) => setSigner(e.target.value)} maxLength={80} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Member page: signed consent (signature, date, language) with the full text on demand. */
export function ConsentCard({ consent, name, onSign }: { consent: StoredConsent; name: string; onSign: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="card card-pad mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <FileSignature className="w-5 h-5 text-green-600 dark:text-ok shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Risk consent signed</p>
          {/* signed_at is UTC; show the gym's (IST) calendar date */}
          <p className="text-xs muted">{date(new Date(Date.parse(consent.signed_at) + 330 * 60_000).toISOString())} · {CONSENT_LANG_LABEL[consent.lang] ?? consent.lang} · by {consent.signer_name}{consent.witnessed_by ? ` · witnessed by ${consent.witnessed_by}` : ''}</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'View'}</button>
        <button className="btn btn-ghost btn-sm" onClick={onSign}>Sign again</button>
      </div>
      {show && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl bg-black/[.03] dark:bg-white/[.04] p-4 max-h-80 overflow-y-auto"><ConsentText version={consent.version} lang={consent.lang} name={name} /></div>
          <div><SignatureView path={consent.signature} className="border border-paper-line" /><p className="text-[11px] muted mt-1">Version {consent.version}</p></div>
        </div>
      )}
    </div>
  );
}
