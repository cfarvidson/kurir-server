/**
 * Shrinks picked images in the browser so they fit the upload limits instead
 * of being rejected. Mirrors the iOS/Mac `AttachmentCompression`: a file that
 * already fits is never touched, and one that has to shrink keeps as much
 * quality as its share of the mail allows.
 */

/** Same value as `MAX_FILE_SIZE` in `api/attachments/upload/route.ts`. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Same value as `MAX_PENDING_UPLOAD_BYTES` in `attachment-upload.ts`. */
export const MAX_MAIL_BYTES = 25 * 1024 * 1024;
/** JPEG quality is picked per image, as high as its allowance permits. */
export const MAX_QUALITY = 0.9;
/** Below this the artefacts cost more than a lower resolution would. */
export const MIN_QUALITY = 0.6;
/**
 * Longest edge in pixels, stepped down only when `MIN_QUALITY` is not enough;
 * null is full resolution.
 */
export const PIXEL_SIZES: (number | null)[] = [
  null,
  4032,
  3024,
  2048,
  1600,
  1280,
  1024,
];

export type CompressionOfferReason =
  | { kind: "imagesTooLarge"; count: number }
  | { kind: "mailTooLarge" };

/** A decoded image that can be re-encoded at a size and quality. */
export interface OpenImage {
  longestEdge: number;
  encode(maxPixelSize: number | null, quality: number): Promise<Blob | null>;
  close(): void;
}

/** Null when the browser cannot decode the file (HEIC outside Safari). */
export type ImageOpener = (file: File) => Promise<OpenImage | null>;

interface Limits {
  maxFileBytes?: number;
  maxMailBytes?: number;
}

/**
 * Still images only: re-encoding a GIF would drop its animation, and an SVG
 * has no pixels to scale.
 */
export function isCompressible(file: File): boolean {
  return (
    file.type.startsWith("image/") &&
    file.type !== "image/gif" &&
    file.type !== "image/svg+xml"
  );
}

/**
 * Null when the pick can go up as it is, or when nothing in it is an image
 * that compression could help with.
 */
export function compressionOfferReason(
  picked: File[],
  attachedBytes: number,
  { maxFileBytes = MAX_FILE_BYTES, maxMailBytes = MAX_MAIL_BYTES }: Limits = {},
): CompressionOfferReason | null {
  const images = picked.filter(isCompressible);
  const oversized = images.filter((f) => f.size > maxFileBytes).length;
  if (oversized > 0) return { kind: "imagesTooLarge", count: oversized };
  const total = attachedBytes + picked.reduce((sum, f) => sum + f.size, 0);
  if (total > maxMailBytes && images.length > 0) return { kind: "mailTooLarge" };
  return null;
}

export function compressionOfferMessage(reason: CompressionOfferReason): string {
  if (reason.kind === "imagesTooLarge") {
    const subject = reason.count === 1 ? "1 image is" : `${reason.count} images are`;
    return `${subject} over the 10 MB limit for a single file. Compress to make them small enough to attach?`;
  }
  return "These files would take the mail past the 25 MB limit. Compress the images to make the mail smaller?";
}

/**
 * The most bytes one image may take so all of them share `available`. Images
 * already under an even share keep their bytes, and what they leave over goes
 * to the larger ones.
 */
export function imageAllowance(sizes: number[], available: number): number {
  let remaining = Math.max(available, 0);
  const sorted = [...sizes].sort((a, b) => a - b);
  for (const [index, size] of sorted.entries()) {
    const share = Math.floor(remaining / (sorted.length - index));
    if (size > share) return share;
    remaining -= size;
  }
  return Infinity;
}

/**
 * Shrinks only the images that are over their byte allowance, each one just
 * far enough to fit. Everything else passes through untouched.
 */
export async function compressToFit(
  picked: File[],
  attachedBytes: number,
  {
    maxFileBytes = MAX_FILE_BYTES,
    maxMailBytes = MAX_MAIL_BYTES,
    open = openImage,
  }: Limits & { open?: ImageOpener } = {},
): Promise<File[]> {
  const images = picked.filter(isCompressible);
  const otherBytes = picked
    .filter((f) => !isCompressible(f))
    .reduce((sum, f) => sum + f.size, 0);
  const allowance = Math.min(
    maxFileBytes,
    imageAllowance(
      images.map((f) => f.size),
      maxMailBytes - attachedBytes - otherBytes,
    ),
  );
  const result: File[] = [];
  // One at a time: a decoded photo is large, and several at once is not faster.
  for (const file of picked) {
    result.push(await fit(file, allowance, open));
  }
  return result;
}

/**
 * The file unchanged when it fits. Otherwise a JPEG at full resolution with
 * the quality its allowance permits, stepping down `PIXEL_SIZES` only when
 * `MIN_QUALITY` is still too large (the smallest step when nothing fits).
 */
async function fit(file: File, bytes: number, open: ImageOpener): Promise<File> {
  if (!isCompressible(file) || file.size <= bytes) return file;
  const image = await open(file);
  if (!image) return file;
  try {
    let smallest: Blob | null = null;
    // A step at or above the image's own size would repeat full resolution.
    const sizes = PIXEL_SIZES.filter(
      (size) => size === null || size < image.longestEdge,
    );
    for (const size of sizes) {
      // Null means the canvas was too large for this browser: step down.
      const jpeg = await jpegToFit(image, size, bytes);
      if (!jpeg) continue;
      smallest = jpeg;
      if (jpeg.size <= bytes) break;
    }
    if (!smallest || smallest.size >= file.size) return file;
    const stem = file.name.replace(/\.[^./]+$/, "");
    return new File([smallest], `${stem}.jpg`, { type: "image/jpeg" });
  } finally {
    image.close();
  }
}

/**
 * The highest quality between `MIN_QUALITY` and `MAX_QUALITY` whose JPEG
 * fits, or the `MIN_QUALITY` JPEG when even that is too large.
 */
async function jpegToFit(
  image: OpenImage,
  maxPixelSize: number | null,
  bytes: number,
): Promise<Blob | null> {
  const best = await image.encode(maxPixelSize, MAX_QUALITY);
  if (!best) return null;
  if (best.size <= bytes) return best;
  let result = await image.encode(maxPixelSize, MIN_QUALITY);
  if (!result || result.size > bytes) return result;
  let low = MIN_QUALITY;
  let high = MAX_QUALITY;
  for (let round = 0; round < 3; round++) {
    const middle = (low + high) / 2;
    const blob = await image.encode(maxPixelSize, middle);
    if (!blob) break;
    if (blob.size <= bytes) {
      result = blob;
      low = middle;
    } else {
      high = middle;
    }
  }
  return result;
}

/** Decodes with the EXIF orientation applied and re-encodes through a canvas. */
const openImage: ImageOpener = async (file) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  const longestEdge = Math.max(bitmap.width, bitmap.height);
  // The quality search encodes one size several times: draw it once.
  let drawn: { size: number | null; canvas: HTMLCanvasElement } | null = null;
  return {
    longestEdge,
    async encode(maxPixelSize, quality) {
      if (drawn?.size !== maxPixelSize) {
        // Never enlarged.
        const scale = Math.min(1, (maxPixelSize ?? longestEdge) / longestEdge);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const context = canvas.getContext("2d");
        if (!context) return null;
        // JPEG has no alpha: transparent pixels would otherwise turn black.
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        drawn = { size: maxPixelSize, canvas };
      }
      const { canvas } = drawn;
      return new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
    },
    close: () => bitmap.close(),
  };
};
