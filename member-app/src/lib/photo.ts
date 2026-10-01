// Member photos are processed in the browser before upload: rotated upright, centre-cropped to a
// square, resized to 512 px and encoded as WebP (~20–40 KB instead of a 3–5 MB camera photo).
// iPhone Safari cannot encode WebP from a canvas, so it falls back to a JPEG of similar size.
const SIZE = 512;
const QUALITY = 0.72;

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
