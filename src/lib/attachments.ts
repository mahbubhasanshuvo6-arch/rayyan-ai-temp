// Attachment handling: file validation, reading, and base64 conversion.
// Gemini supports inline image data (up to ~20MB per image) and text files.

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string; // data URL for preview + transport
  isImage: boolean;
  isPdf: boolean;
  extractedText?: string; // for PDF attachments, extracted via edge function
}

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
export const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50 MB total
export const MAX_ATTACHMENTS = 5;

const IMAGE_TYPES = [
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/heic", "image/heif",
];
const TEXT_TYPES = [
  "text/plain", "text/csv", "text/markdown", "text/html",
  "application/json", "application/xml",
  ".txt", ".md", ".csv", ".json", ".xml", ".html", ".js", ".ts", ".py", ".java",
];
const PDF_TYPES = ["application/pdf", ".pdf"];

export function isPdfType(type: string, name: string): boolean {
  if (PDF_TYPES.includes(type)) return true;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ext === "pdf";
}

export function isImageType(type: string, name: string): boolean {
  if (IMAGE_TYPES.some((t) => type === t)) return true;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"].includes(ext);
}

function isTextType(type: string, name: string): boolean {
  if (TEXT_TYPES.includes(type)) return true;
  const ext = "." + (name.toLowerCase().split(".").pop() ?? "");
  return TEXT_TYPES.includes(ext);
}

export function isSupportedType(type: string, name: string): boolean {
  return isImageType(type, name) || isTextType(type, name) || isPdfType(type, name);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateFile(file: File, currentTotal: number, currentCount: number): ValidationResult {
  if (currentCount >= MAX_ATTACHMENTS) {
    return { ok: false, error: `সর্বোচ্চ ${MAX_ATTACHMENTS}টি ফাইল যুক্ত করা যাবে।` };
  }
  if (!isSupportedType(file.type, file.name)) {
    return { ok: false, error: `"${file.name}" — এই ধরনের ফাইল সমর্থিত নয়। ছবি বা টেক্সট ফাইল ব্যবহার করুন।` };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, error: `"${file.name}" — ফাইলের সাইজ ${formatFileSize(file.size)}। সর্বোচ্চ ${formatFileSize(MAX_FILE_SIZE)} অনুমোদিত।` };
  }
  if (currentTotal + file.size > MAX_TOTAL_SIZE) {
    return { ok: false, error: `মোট ফাইল সাইজ ${formatFileSize(MAX_TOTAL_SIZE)} অতিক্রম করবে।` };
  }
  return { ok: true };
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`"${file.name}" পড়তে ব্যর্থ।`));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`"${file.name}" পড়তে ব্যর্থ।`));
    reader.readAsText(file);
  });
}

export async function createAttachment(file: File): Promise<Attachment> {
  const isImage = isImageType(file.type, file.name);
  const isPdf = isPdfType(file.type, file.name);
  const dataUrl = await readFileAsDataURL(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || (isImage ? "image/jpeg" : isPdf ? "application/pdf" : "text/plain"),
    size: file.size,
    dataUrl,
    isImage,
    isPdf,
  };
}

// Extract text from a PDF (or TXT) file via the process-document edge function.
// Returns the extracted text, or throws on failure.
export async function extractFileText(
  file: File,
  authToken: string,
  ownerLabel?: string,
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  const base64 = btoa(binary);

  const body: Record<string, unknown> = {
    action: "extract",
    file: base64,
    fileName: file.name,
  };
  if (ownerLabel) body.ownerLabel = ownerLabel;

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    },
  );

  const result = await res.json();
  if (!res.ok) {
    throw new Error(result.error ?? "Failed to extract file contents.");
  }
  return result.text as string;
}

// Extract the base64 portion (without the data: prefix) from a data URL.
export function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

// Extract the MIME type from a data URL.
export function dataUrlToMime(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+)/);
  return match ? match[1] : "application/octet-stream";
}

// Build the text content for a non-image attachment to send to the AI.
export async function attachmentToTextContent(att: Attachment): Promise<string> {
  const response = await fetch(att.dataUrl);
  const blob = await response.blob();
  const text = await blob.text();
  const truncated = text.length > 50000 ? text.slice(0, 50000) + "\n\n[... truncated ...]" : text;
  return `[Attached file: ${att.name}]\n\n${truncated}`;
}

// Create a small thumbnail data URL from an image attachment for chat history.
// Resizes to maxDim x maxDim maintaining aspect ratio, outputs as JPEG.
export async function createThumbnail(dataUrl: string, maxDim = 80): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height) {
        height = Math.round((height / width) * maxDim);
        width = maxDim;
      } else {
        width = Math.round((width / height) * maxDim);
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
