// Downscale + re-encode an image client-side before upload, so large phone
// photos stay well under the server's size cap (and cost fewer vision tokens).
// Falls back to the original file if the browser can't decode it (e.g. HEIC).
const MAX_EDGE = 1600; // px on the long edge — plenty for food recognition
const QUALITY = 0.85;

export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // undecodable (e.g. HEIC) — let the server handle/reject it
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITY),
  );
  return blob ?? file;
}
