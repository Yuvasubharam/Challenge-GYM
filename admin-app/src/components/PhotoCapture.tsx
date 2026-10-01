// Take a member's photo with the device camera (webcam at the desk, or the phone/tablet camera),
// or upload / drag-and-drop a picture. Always hands back the processed 512 px WebP (see lib/photo).
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Eye, ImageUp, RefreshCcw, SwitchCamera } from 'lucide-react';
import { processPhoto } from '../lib/photo';
import { Avatar, Modal, Spinner, useToast } from './ui';
import { api } from '../lib/api';

export function PhotoCapture({ open, onClose, onPhoto, title = 'Member photo' }: {
  open: boolean; onClose: () => void; onPhoto: (photo: Blob) => Promise<void> | void; title?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [camError, setCamError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const toast = useToast();

  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setLive(false); }, []);

  // Start the camera while the dialog is open and no photo is being reviewed.
  useEffect(() => {
    if (!open || shot) return;
    if (!navigator.mediaDevices?.getUserMedia) { setCamError('No camera access in this browser — upload a photo instead.'); return; }
    let cancelled = false;
    setCamError(null);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then(async (s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => undefined); }
        setLive(true);
      })
      .catch((e: Error) => setCamError(e.name === 'NotAllowedError' ? 'Camera permission was denied — allow it in the browser, or upload a photo.' : 'No camera found — upload a photo instead.'));
    return () => { cancelled = true; stop(); };
  }, [open, shot, facing, stop]);

  useEffect(() => { if (!open) { setShot((s) => { if (s) URL.revokeObjectURL(s.url); return null; }); stop(); } }, [open, stop]);

  const review = async (get: () => Promise<Blob>) => {
    try {
      const blob = await get();
      stop();
      setShot((s) => { if (s) URL.revokeObjectURL(s.url); return { blob, url: URL.createObjectURL(blob) }; });
    } catch (e) { toast('error', (e as Error).message); }
  };
  const capture = () => video.current && review(() => processPhoto(video.current!));
  const pickFile = (f?: File | null) => f && review(() => processPhoto(f));
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files?.[0]); };

  const save = async () => {
    if (!shot) return;
    setBusy(true);
    try { await onPhoto(shot.blob); onClose(); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={shot ? <>
        <button className="btn btn-outline" onClick={() => setShot((s) => { if (s) URL.revokeObjectURL(s.url); return null; })}><RefreshCcw className="w-4 h-4" />Retake</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy && <Spinner className="w-4 h-4" />}Use photo</button>
      </> : <>
        <button className="btn btn-outline" onClick={() => file.current?.click()}><ImageUp className="w-4 h-4" />Upload a photo</button>
        <button className="btn btn-primary" disabled={!live} onClick={() => void capture()}><Camera className="w-4 h-4" />Capture</button>
      </>}>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={`relative mx-auto w-full max-w-sm aspect-square rounded-4xl overflow-hidden bg-ink-900 ${over ? 'ring-4 ring-lime' : ''}`}>
        {shot ? <img src={shot.url} alt="Captured" className="w-full h-full object-cover" /> : <>
          <video ref={video} playsInline muted className={`w-full h-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${live ? '' : 'invisible'}`} />
          {!live && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-ink-300 text-sm">
            {camError ? <><ImageUp className="w-8 h-8" />{camError}<span className="text-xs">You can also drop a picture here.</span></> : <Spinner className="w-7 h-7" />}
          </div>}
          {live && <>
            <div className="absolute inset-[12%] rounded-full border-2 border-white/40 border-dashed pointer-events-none" />
            <button type="button" className="absolute bottom-3 right-3 icon-btn bg-black/50 text-white" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} aria-label="Switch camera"><SwitchCamera className="w-5 h-5" /></button>
          </>}
        </>}
      </div>
      <p className="text-xs muted text-center mt-3">{shot ? `Saved as a small square photo (${Math.max(1, Math.round(shot.blob.size / 1024))} KB).` : 'Keep the face inside the circle. Or drag a picture onto the camera box.'}</p>
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
    </Modal>
  );
}

/**
 * Avatar that doubles as the photo button: click to capture/upload, or drop an image on it.
 * Used on the member page and in the members list.
 */
export function EditableAvatar({ memberId, name, photo, size, onChange, className = '' }: {
  memberId: number; name: string; photo: string | null; size: number; onChange: (photoKey: string) => void; className?: string;
}) {
  // With a photo, a click opens the viewer (View / Change); without one it goes straight to the camera.
  const [open, setOpen] = useState<null | 'view' | 'change'>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const upload = async (blob: Blob) => {
    const r = await api.upload<{ photo_key: string }>(`/members/${memberId}/photo`, blob);
    onChange(r.photo_key);
    toast('ok', 'Photo saved');
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    setBusy(true);
    try { await upload(await processPhoto(f)); } catch (err) { toast('error', (err as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" title={photo ? 'View or change photo (click, or drop a new picture)' : 'Add photo (click, or drop a picture)'}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(photo ? 'view' : 'change'); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => void onDrop(e)}
        className={`relative shrink-0 rounded-full group ${over ? 'ring-4 ring-lime' : ''} ${className}`}>
        <Avatar name={name} photo={photo} size={size} />
        <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
          {busy ? <Spinner className="w-4 h-4 text-white" /> : (() => { const Icon = photo ? Eye : Camera; return <Icon className="text-white" style={{ width: Math.max(14, size / 3), height: Math.max(14, size / 3) }} />; })()}
        </span>
        {busy && <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center"><Spinner className="w-4 h-4 text-white" /></span>}
      </button>
      {/* Rendered at <body> and walled off: the avatar sits inside clickable rows / links in the members list. */}
      {open && createPortal(
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {open === 'view' && photo ? (
            <Modal open onClose={() => setOpen(null)} title={name}
              footer={<><button className="btn btn-outline" onClick={() => setOpen(null)}>Close</button>
                <button className="btn btn-primary" onClick={() => setOpen('change')}><Camera className="w-4 h-4" />Change photo</button></>}>
              <img src={`/api/files/${photo}`} alt={name} className="w-full max-w-md mx-auto aspect-square object-cover rounded-4xl bg-ink-900" />
            </Modal>
          ) : <PhotoCapture open onClose={() => setOpen(null)} onPhoto={upload} title={`Photo — ${name}`} />}
        </div>, document.body)}
    </>
  );
}
