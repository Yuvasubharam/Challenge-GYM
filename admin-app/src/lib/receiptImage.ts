// Draws the payment receipt as a PNG (same look as the on-screen card) so it can be shared
// to WhatsApp as an image. Plain canvas — no extra dependency, crisp at 2× on phones.
import { date, money } from './format';

export interface ReceiptData {
  gym: { name: string; phone: string; address: string };
  receipt_no: string | null;
  paid_on: string;
  amount: number;
  mode: string;
  reference: string | null;
  rows: [string, string][];
  void: boolean;
}

const C = { ink: '#0E0F11', ink300: '#9BA1A6', ink400: '#5D6268', line: '#E8EAEB', lime: '#C8F135', limeSoft: '#F3FBD7', bad: '#E5484D' };
const SANS = 'Inter, system-ui, sans-serif';
const DISPLAY = 'Lexend, Inter, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Shrink the font until `text` fits `maxW`, then draw it. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, weight: number, size: number, family: string) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; s -= 1; } while (ctx.measureText(text).width > maxW && s > 9);
  ctx.fillText(text, x, y);
}

export async function renderReceipt(r: ReceiptData): Promise<Blob> {
  await document.fonts?.ready;
  const W = 440, PAD = 24, SCALE = 2;
  const rowH = 38;
  const H = 96 + 24 + 44 + 128 + 20 + r.rows.length * rowH + (r.void ? 36 : 0) + 64;
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  // Card: square corners — transparent PNG corners show up black in some WhatsApp viewers.
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, 96);
  const logo = await loadImage('/favicon-128.png');
  ctx.fillStyle = C.lime; roundRect(ctx, PAD, 26, 44, 44, 14); ctx.fill();
  if (logo) ctx.drawImage(logo, PAD + 4, 30, 36, 36);
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left';
  fitText(ctx, r.gym.name, PAD + 58, r.gym.address || r.gym.phone ? 46 : 55, W - PAD * 2 - 58, 700, 19, DISPLAY);
  const sub = [r.gym.address, r.gym.phone].filter(Boolean).join(' · ');
  if (sub) { ctx.fillStyle = C.ink300; fitText(ctx, sub, PAD + 58, 66, W - PAD * 2 - 58, 400, 12, SANS); }

  // Title row
  let y = 96 + 36;
  ctx.fillStyle = C.ink400; ctx.font = `700 11px ${SANS}`; ctx.fillText('PAYMENT RECEIPT', PAD, y);
  ctx.textAlign = 'right'; ctx.font = `400 13px ${SANS}`; ctx.fillText(date(r.paid_on), W - PAD, y);
  ctx.textAlign = 'left';
  if (r.receipt_no) { ctx.fillStyle = C.ink; ctx.font = `700 14px ui-monospace, monospace`; ctx.fillText(r.receipt_no, PAD, y + 20); }

  // Amount box
  y += 36;
  ctx.fillStyle = C.limeSoft; roundRect(ctx, PAD, y, W - PAD * 2, 112, 22); ctx.fill();
  ctx.textAlign = 'center'; ctx.fillStyle = C.ink400; ctx.font = `600 12px ${SANS}`; ctx.fillText('Amount received', W / 2, y + 32);
  ctx.fillStyle = C.ink; fitText(ctx, money(r.amount), W / 2, y + 72, W - PAD * 4, 700, 36, DISPLAY);
  ctx.fillStyle = C.ink400; ctx.font = `500 11px ${SANS}`;
  ctx.fillText(`${r.mode.toUpperCase()}${r.reference ? ` · ${r.reference}` : ''}`, W / 2, y + 94);

  // Detail rows
  y += 112 + 20;
  for (const [k, v] of r.rows) {
    ctx.textAlign = 'left'; ctx.fillStyle = C.ink400; ctx.font = `400 13px ${SANS}`; ctx.fillText(k, PAD, y + 22);
    ctx.textAlign = 'right'; ctx.fillStyle = C.ink;
    fitText(ctx, v, W - PAD, y + 22, W - PAD * 2 - 110, 600, 13, SANS);
    ctx.strokeStyle = C.line; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(PAD, y + rowH - 4); ctx.lineTo(W - PAD, y + rowH - 4); ctx.stroke(); ctx.setLineDash([]);
    y += rowH;
  }
  if (r.void) { ctx.textAlign = 'center'; ctx.fillStyle = C.bad; ctx.font = `800 16px ${SANS}`; ctx.fillText('VOID', W / 2, y + 26); y += 36; }

  ctx.textAlign = 'center'; ctx.fillStyle = C.ink400; ctx.font = `400 12px ${SANS}`;
  ctx.fillText('Thank you for training with us 💪', W / 2, y + 36);

  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the receipt image'))), 'image/png'));
}
