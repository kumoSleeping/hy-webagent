/** Match PI's default max dimensions; user limit is 10 MB encoded payload. */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_WIDTH = 2000;
const DEFAULT_MAX_HEIGHT = 2000;
const JPEG_QUALITIES = [0.85, 0.7, 0.55, 0.4, 0.25];

export interface CompressedImage {
  mediaType: string;
  data: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  wasCompressed: boolean;
}

export interface CompressImageOptions {
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** 0–100 preparation progress (decode / encode). */
  onProgress?: (percent: number) => void;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed"))),
      type,
      quality
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Failed to read encoded image"));
    reader.readAsDataURL(blob);
  });
}

function fitDimensions(width: number, height: number, maxWidth: number, maxHeight: number) {
  let w = width;
  let h = height;
  if (w > maxWidth) {
    h = Math.round((h * maxWidth) / w);
    w = maxWidth;
  }
  if (h > maxHeight) {
    w = Math.round((w * maxHeight) / h);
    h = maxHeight;
  }
  return { width: w, height: h };
}

/** Canvas re-encode strips EXIF and other metadata. */
export async function compressImageFile(
  file: File,
  options?: CompressImageOptions
): Promise<CompressedImage | null> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options?.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const onProgress = options?.onProgress;
  onProgress?.(8);

  const img = await loadImageFromFile(file);
  onProgress?.(28);
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;
  if (!originalWidth || !originalHeight) return null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let { width: currentWidth, height: currentHeight } = fitDimensions(
    originalWidth,
    originalHeight,
    maxWidth,
    maxHeight
  );

  let pass = 0;
  while (true) {
    canvas.width = currentWidth;
    canvas.height = currentHeight;
    ctx.clearRect(0, 0, currentWidth, currentHeight);
    ctx.drawImage(img, 0, 0, currentWidth, currentHeight);
    onProgress?.(Math.min(88, 35 + pass * 12));

    for (const quality of JPEG_QUALITIES) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (blob.size <= maxBytes) {
        const data = await blobToBase64(blob);
        const wasCompressed =
          currentWidth !== originalWidth ||
          currentHeight !== originalHeight ||
          blob.size < file.size ||
          file.type !== "image/jpeg";
        onProgress?.(100);
        return {
          mediaType: "image/jpeg",
          data,
          width: currentWidth,
          height: currentHeight,
          originalWidth,
          originalHeight,
          wasCompressed,
        };
      }
    }

    const pngBlob = await canvasToBlob(canvas, "image/png");
    if (pngBlob.size <= maxBytes) {
      const data = await blobToBase64(pngBlob);
      onProgress?.(100);
      return {
        mediaType: "image/png",
        data,
        width: currentWidth,
        height: currentHeight,
        originalWidth,
        originalHeight,
        wasCompressed: true,
      };
    }

    if (currentWidth === 1 && currentHeight === 1) break;

    const nextWidth = currentWidth === 1 ? 1 : Math.max(1, Math.floor(currentWidth * 0.75));
    const nextHeight = currentHeight === 1 ? 1 : Math.max(1, Math.floor(currentHeight * 0.75));
    if (nextWidth === currentWidth && nextHeight === currentHeight) break;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
    pass += 1;
  }

  return null;
}

/** Same note PI adds so the model can map resized coordinates. */
export function formatDimensionNote(result: CompressedImage): string | undefined {
  if (result.width === result.originalWidth && result.height === result.originalHeight) {
    return undefined;
  }
  const scale = result.originalWidth / result.width;
  return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}
