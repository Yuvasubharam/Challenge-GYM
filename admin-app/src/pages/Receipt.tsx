import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, Send, Share2 } from 'lucide-react';
import { api } from '../lib/api';
import { date, money, waLink } from '../lib/format';
import { renderReceipt } from '../lib/receiptImage';
import { ErrorBox, PageLoader, Spinner, useLoad, useToast } from '../components/ui';

interface R {
  payment: { id: number; amount: number; mode: string; paid_on: string; receipt_no: string; reference: string | null; entry_type: string; handled_by: string; remarks: string | null;
    name: string; essl_id: string; mobile: string | null; category: string | null; duration_label: string | null; start_date: string | null; end_date: string | null; status: string };
  gym: { name: string; phone: string; address: string };
}

/** The member app's address for this admin (admin.challengegym.in → challengegym.in). */
function memberOrigin(): string {
  const { protocol, hostname } = window.location;
  if (hostname.startsWith('admin.')) return `${protocol}//${hostname.slice(6)}`;
  if (hostname.includes('challenge-gym-admin')) return `${protocol}//${hostname.replace('challenge-gym-admin', 'challenge-gym-member')}`;
  return 'https://challengegym.in';
}

export default function Receipt() {
  const { id } = useParams();
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const { data, error } = useLoad(() => api.get<R>(`/payments/${id}/receipt`), [id]);
  // Ready before the click, so opening WhatsApp stays inside the tap (no pop-up blocking).
  useEffect(() => {
    api.post<{ token: string }>(`/payments/${id}/share`, {}).then((r) => setLink(`${memberOrigin()}/r/${r.token}`)).catch(() => setLink(null));
  }, [id]);
  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!data) return <PageLoader />;
  const { payment: p, gym } = data;
  const plan = `${p.category ?? 'Membership'}${p.duration_label ? ` · ${p.duration_label}` : ''}`;
  const rows: [string, string][] = [
    ['Member', p.name], ['Member ID', p.essl_id], ['Mobile', p.mobile ?? '—'], ['For', `${plan} (${p.entry_type})`],
    ['Valid', p.start_date ? `${date(p.start_date)} → ${date(p.end_date)}` : '—'], ['Received by', p.handled_by ?? '—'],
  ];
  // WhatsApp formatting: *bold*. Sent as the image caption, or on its own via the text link.
  const text = [
    `🧾 *${gym.name} — Payment receipt*`,
    p.receipt_no ? `Receipt: ${p.receipt_no}` : null,
    `Member: ${p.name} (#${p.essl_id})`,
    `Amount: *${money(p.amount)}* (${p.mode.toUpperCase()}${p.reference ? ` · ${p.reference}` : ''})`,
    `Plan: ${plan}`,
    p.start_date ? `Valid: ${date(p.start_date)} → ${date(p.end_date)}` : null,
    `Paid on: ${date(p.paid_on)}`,
    p.status !== 'confirmed' ? '⚠️ This receipt is VOID' : null,
    '',
    'Thank you for training with us 💪',
  ].filter((l) => l !== null).join('\n');
  const message = link ? `${text}\n\n🔗 View / download your receipt: ${link}` : text;
  const receiptPng = () => renderReceipt({ gym, receipt_no: p.receipt_no, paid_on: p.paid_on, amount: p.amount, mode: p.mode, reference: p.reference, rows, void: p.status !== 'confirmed' });

  // Straight into the member's own chat: wa.me opens it with the message + receipt link (WhatsApp links
  // can't carry a picture). The picture is put on the clipboard first, so it can be pasted there too.
  const sendToChat = () => {
    const wa = waLink(p.mobile, message);
    if (!wa) return;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        void navigator.clipboard.write([new ClipboardItem({ 'image/png': receiptPng() })]).catch(() => undefined);
      }
    } catch { /* clipboard images unsupported — the link in the message is enough */ }
    window.open(wa, '_blank', 'noopener');
    toast('ok', 'WhatsApp opened in the member’s chat — tap Send. The receipt picture is copied too; paste it if you like.');
  };

  // Image + text in one go through the phone's share sheet (pick WhatsApp → the customer).
  // Browsers without file sharing (most desktops): download the image and open the chat with the text.
  const share = async () => {
    setSharing(true);
    try {
      const blob = await receiptPng();
      const file = new File([blob], `receipt-${p.receipt_no || p.id}.png`, { type: 'image/png' });
      // Some apps drop the caption when an image is attached; having it on the clipboard lets staff paste it.
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: message });
        } catch (e) {
          if ((e as Error).name !== 'AbortError') throw e;
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const wa = waLink(p.mobile, message);
      if (wa) window.open(wa, '_blank', 'noopener');
      toast('ok', wa ? 'Receipt image downloaded — attach it in the WhatsApp chat that just opened' : 'Receipt image downloaded');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="min-h-dvh bg-paper dark:bg-ink-900 py-8 px-4">
      <div className="max-w-md mx-auto bg-white text-ink-900 rounded-4xl shadow-card overflow-hidden print:shadow-none print:rounded-none">
        <div className="bg-ink-900 text-white p-6 flex items-center gap-3">
          <img src="/favicon-128.png" alt="" className="w-11 h-11 rounded-2xl bg-lime p-1 object-contain" />
          <div className="flex-1"><p className="font-display font-bold text-lg">{gym.name}</p><p className="text-xs text-ink-300">{gym.address}{gym.phone ? ` · ${gym.phone}` : ''}</p></div>
        </div>
        <div className="p-6">
          <div className="flex justify-between items-start">
            <div><p className="text-xs text-ink-400 font-semibold uppercase tracking-wide">Payment receipt</p><p className="font-mono font-bold mt-1">{p.receipt_no}</p></div>
            <p className="text-sm text-ink-400">{date(p.paid_on)}</p>
          </div>
          <div className="my-6 text-center py-6 rounded-3xl bg-lime/20">
            <p className="text-xs text-ink-500 font-semibold">Amount received</p>
            <p className="font-display text-4xl font-bold mt-1">{money(p.amount)}</p>
            <p className="text-xs text-ink-500 mt-1 uppercase">{p.mode}{p.reference ? ` · ${p.reference}` : ''}</p>
          </div>
          <dl className="text-sm space-y-2.5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-dashed border-ink-100 pb-2"><dt className="text-ink-400">{k}</dt><dd className="font-semibold text-right">{v}</dd></div>
            ))}
          </dl>
          {p.status !== 'confirmed' && <p className="mt-4 text-center text-bad font-bold uppercase">Void</p>}
          <p className="text-center text-xs text-ink-400 mt-6">Thank you for training with us 💪</p>
        </div>
      </div>
      <div className="max-w-md mx-auto grid grid-cols-2 gap-2 mt-4 no-print">
        {p.mobile && <button className="btn bg-[#25D366] text-white col-span-2 btn-lg" onClick={sendToChat}>
          <Send className="w-4 h-4" />Send on WhatsApp to {p.mobile}</button>}
        <button className="btn btn-dark" onClick={() => window.print()}><Printer className="w-4 h-4" />Print</button>
        <button className="btn btn-outline" disabled={sharing} onClick={() => void share()}>
          {sharing ? <Spinner className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}Share picture…</button>
      </div>
      <p className="max-w-md mx-auto text-xs muted text-center mt-3 no-print">
        {p.mobile ? '“Send on WhatsApp” opens this member’s chat directly with the receipt and a link they can open or download. ' : 'No mobile number on file — use Share picture. '}
        “Share picture” sends the image through the phone’s share sheet (you pick the chat).</p>
    </div>
  );
}
