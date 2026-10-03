// Member photos are processed in the browser before upload: rotated upright, centre-cropped to a
// square, resized to 512 px and encoded as WebP (~20–40 KB instead of a 3–5 MB camera photo).
// iPhone Safari cannot encode WebP from a canvas, so it falls back to a JPEG of similar size.
const SIZE = 512;
const QUALITY = 0.72;

// Payment screenshots keep their aspect ratio and stay readable (UTR, amount): longest side ≤ 1600 px,
// JPEG — a few hundred KB, comfortably under the server's 3 MB cap even for tall phone screenshots.
const PROOF_MAX = 1600;

export async function processScreenshot(src: Blob): Promise<Blob> {
  if (!src.type.startsWith('image/')) throw new Error('Choose the screenshot image from your UPI app');
  const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bmp) throw new Error('This image could not be read — try a JPG or PNG');
  const scale = Math.min(1, PROOF_MAX / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); // transparent PNGs → white, not black
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const jpeg = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', 0.85));
  if (!jpeg) throw new Error('Could not process the screenshot');
  return jpeg;
}

export async function processPhoto(src: Blob | HTMLVideoElement | HTMLCanvasElement): Promise<Blob> {
  let img: CanvasImageSource, w: number, h: number;
  if (src instanceof Blob) {
    if (!src.type.startsWith('image/')) throw new Error('Choose an image file (JPG, PNG, WebP or HEIC photo)');
    const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) throw new Error('This image could not be read — try a JPG or PNG');
    img = bmp; w = bmp.width; h = bmp.height;
  } else if (src instanceof HTMLVideoElement) {
    img = src; w = src.videoWidth; h = src.videoHeight;
  } else {
    img = src; w = src.width; h = src.height;
  }
  const side = Math.min(w, h);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.min(SIZE, side);
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, cv.width, cv.height);
  const encode = (type: string) => new Promise<Blob | null>((r) => cv.toBlob(r, type, QUALITY));
  const webp = await encode('image/webp');
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await encode('image/jpeg');
  if (!jpeg) throw new Error('Could not process the photo');
  return jpeg;
}
