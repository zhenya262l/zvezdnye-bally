// Photos for tasks. The web version gets a picture from the phone camera
// (an <input type="file" capture>, see components/PhotoPicker.web.tsx), shrinks
// it on the phone and gives a JPEG as base64 for the server. A native App Store
// version can add photo/index.native.ts without touching the screens.

/** A photo ready to send: base64 for the server, a data URL for the preview. */
export type Photo = { base64: string; uri: string; bytes: number };

// The server takes up to 1 MB. Usually the first try gives 150–400 KB.
const TARGET_BYTES = 600 * 1024;
const TRIES: [side: number, quality: number][] = [
  [1280, 0.75],
  [1280, 0.6],
  [1024, 0.6],
  [800, 0.55],
];

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('photo_unreadable'));
    };
    img.src = url;
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('photo_unreadable'))), 'image/jpeg', quality);
  });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('photo_unreadable'));
    r.readAsDataURL(blob);
  });
}

/** Shrinks a camera photo to at most 1280 px on the long side, as a JPEG. */
export async function shrinkPhoto(file: Blob): Promise<Photo> {
  const img = await loadImage(file);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) throw new Error('photo_unreadable');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('photo_unreadable');
  let blob: Blob | null = null;
  for (const [side, quality] of TRIES) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    // A white background: a picture with transparency would turn black in JPEG.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    blob = await toJpeg(canvas, quality);
    if (blob.size <= TARGET_BYTES) break;
  }
  // Free the memory of a big picture at once (old iPhones have little).
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('photo_unreadable');
  const base64 = await toBase64(blob);
  return { base64, uri: `data:image/jpeg;base64,${base64}`, bytes: blob.size };
}
