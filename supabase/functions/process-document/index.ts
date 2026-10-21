// process-document: receives a document upload (PDF/TXT), validates it,
// extracts text, splits into chunks, and stores chunks as knowledge_entries.
//
// Security:
//   1. Requires a valid Supabase JWT (user must be authenticated OR have
//      an owner_label for anon sessions).
//   2. File validation: type check (PDF/TXT only), size limit (10MB),
//      magic byte check for PDFs.
//   3. Extracted text is stored as knowledge_entries with document_id
//      linking back to user_documents. RLS ensures only the owner can
//      read their own document chunks.
//   4. Retrieved document content is treated as untrusted input — the
//      gemini-chat function's system prompt instructs the AI never to
//      follow instructions embedded inside retrieved documents.
//
// Flow:
//   POST /process-document  (multipart/form-data or JSON with base64)
//   -> validate file -> upload to storage -> create user_documents row
//   -> extract text -> chunk -> insert knowledge_entries
//   -> update user_documents status to 'ready'
//
// OCR: not supported in this version. Scanned PDFs (image-only) will
// produce an empty text result and a clear error message.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const CHUNK_SIZE = 1000; // characters per chunk
const CHUNK_OVERLAP = 100; // overlap between chunks for context continuity
const ALLOWED_TYPES = new Set(["application/pdf", "text/plain", "application/octet-stream"]);
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

interface ProcessResult {
  documentId: string;
  chunkCount: number;
  textLength: number;
  status: "ready" | "failed";
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ---- Auth ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    let userId: string | null = null;
    const { data: ud } = await supabase.auth.getUser(jwt);
    userId = ud?.user?.id ?? null;

    // Parse request — accept both multipart and JSON
    let fileBytes: Uint8Array;
    let fileName: string;
    let fileType: string;
    let title: string;
    let ownerLabel: string | null = null;

    const contentType = req.headers.get("Content-Type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return json({ error: "No file provided." }, 400);
      title = (formData.get("title") as string)?.trim() || file.name;
      ownerLabel = (formData.get("ownerLabel") as string)?.trim() || null;
      fileName = file.name;
      fileType = file.type || guessType(fileName);
      fileBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      // JSON with base64-encoded file
      const body = await req.json();
      const base64 = String(body.file ?? "");
      fileName = String(body.fileName ?? "document");
      fileType = String(body.fileType ?? guessType(fileName));
      title = String(body.title ?? fileName).trim();
      ownerLabel = body.ownerLabel ? String(body.ownerLabel) : null;
      if (!base64) return json({ error: "No file data provided." }, 400);
      // Decode base64 to bytes
      const binary = atob(base64);
      fileBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) fileBytes[i] = binary.charCodeAt(i);
    }

    // ---- Validate file ----
    if (fileBytes.length === 0) {
      return json({ error: "Empty file." }, 400);
    }
    if (fileBytes.length > MAX_FILE_SIZE) {
      return json({ error: "File too large. Maximum size is 10 MB." }, 400);
    }

    // Determine actual file type by extension + magic bytes
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    let detectedType = fileType;
    if (ext === "pdf" || isPdfMagic(fileBytes)) {
      detectedType = "application/pdf";
    } else if (ext === "txt" || isTextFile(fileBytes)) {
      detectedType = "text/plain";
    }

    if (detectedType === "application/pdf") {
      if (!isPdfMagic(fileBytes)) {
        return json({ error: "Invalid PDF file: magic bytes do not match. The file may be corrupted or is not a real PDF." }, 400);
      }
    } else if (detectedType === "text/plain") {
      // OK — text files are straightforward
    } else {
      return json({ error: `Unsupported file type: ${ext}. Only PDF and TXT files are accepted.` }, 400);
    }

    if (!ownerLabel && !userId) {
      return json({ error: "Authentication required: either sign in or provide an owner label." }, 401);
    }

    // ---- Create user_documents record ----
    const storageFolder = userId ?? ownerLabel!;
    const storagePath = `${storageFolder}/${Date.now()}-${sanitizeFileName(fileName)}`;

    const { data: docRecord, error: docError } = await supabase
      .from("user_documents")
      .insert({
        user_id: userId,
        owner_label: ownerLabel,
        title,
        file_name: fileName,
        file_type: ext === "pdf" ? "pdf" : "txt",
        file_size: fileBytes.length,
        storage_path: storagePath,
        status: "pending",
      })
      .select()
      .maybeSingle();

    if (docError || !docRecord) {
      return json({ error: "Failed to create document record: " + (docError?.message ?? "unknown") }, 500);
    }

    const documentId = docRecord.id;

    // ---- Upload to storage ----
    const { error: uploadError } = await supabase.storage
      .from("user-documents")
      .upload(storagePath, fileBytes, {
        contentType: detectedType,
        upsert: false,
      });

    if (uploadError) {
      await supabase.from("user_documents").update({
        status: "failed",
        error_message: "Storage upload failed: " + uploadError.message,
      }).eq("id", documentId);
      return json({ error: "File upload failed: " + uploadError.message }, 500);
    }

    // ---- Extract text ----
    let extractedText: string;
    try {
      if (detectedType === "application/pdf") {
        extractedText = await extractPdfText(fileBytes);
      } else {
        extractedText = decodeText(fileBytes);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown extraction error";
      await supabase.from("user_documents").update({
        status: "failed",
        error_message: errMsg,
      }).eq("id", documentId);
      // Clean up the uploaded file since extraction failed
      await supabase.storage.from("user-documents").remove([storagePath]);
      return json({ error: errMsg }, 422);
    }

    // Check if we got any meaningful text
    const cleanedText = extractedText.trim();
    if (cleanedText.length < 10) {
      const errMsg = "No readable text could be extracted from this file. If it is a scanned PDF (image-only), OCR is required but not currently supported. Please upload a text-based PDF or a TXT file.";
      await supabase.from("user_documents").update({
        status: "failed",
        error_message: errMsg,
        content_text: cleanedText || null,
      }).eq("id", documentId);
      await supabase.storage.from("user-documents").remove([storagePath]);
      return json({ error: errMsg }, 422);
    }

    // ---- Chunk the text ----
    const chunks = chunkText(cleanedText, CHUNK_SIZE, CHUNK_OVERLAP);
    const totalChunks = chunks.length;

    // ---- Insert chunks as knowledge_entries ----
    const entries = chunks.map((chunk, i) => ({
      user_id: userId,
      owner_label: ownerLabel,
      title: `${title} (part ${i + 1}/${totalChunks})`,
      content: chunk,
      tags: [] as string[],
      source: `document:${fileName}`,
      category: "document-chunk",
      visibility: "private",
      is_shared: false,
      document_id: documentId,
      chunk_index: i,
      total_chunks: totalChunks,
    }));

    const { error: chunkError } = await supabase
      .from("knowledge_entries")
      .insert(entries);

    if (chunkError) {
      await supabase.from("user_documents").update({
        status: "failed",
        error_message: "Failed to store document chunks: " + chunkError.message,
      }).eq("id", documentId);
      return json({ error: "Failed to store document chunks: " + chunkError.message }, 500);
    }

    // ---- Update document status ----
    await supabase.from("user_documents").update({
      status: "ready",
      content_text: cleanedText.slice(0, 50000),
      chunk_count: totalChunks,
      updated_at: new Date().toISOString(),
    }).eq("id", documentId);

    const result: ProcessResult = {
      documentId,
      chunkCount: totalChunks,
      textLength: cleanedText.length,
      status: "ready",
    };

    return json({ document: result }, 200);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});

// ---- PDF text extraction ----
// Uses pdf-parse via npm: import for Deno. This works for text-based PDFs.
// Scanned/image-only PDFs will return empty text — the caller handles that.
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  try {
    // Dynamic import — pdf-parse is a CommonJS module that reads from a Buffer.
    // In Deno, we use the npm: specifier to load it.
    const pdfParse = (await import("npm:pdf-parse@1.1.1")).default;
    // pdf-parse expects a Buffer or Uint8Array
    const buffer = Buffer.from(bytes);
    const data = await pdfParse(buffer);
    return data.text ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ocr") || msg.includes("image") || msg.includes("scan")) {
      throw new Error("This appears to be a scanned PDF. OCR is not currently supported. Please upload a text-based PDF or a TXT file.");
    }
    throw new Error(`PDF text extraction failed: ${msg}. The file may be corrupted, encrypted, or a scanned image.`);
  }
}

// ---- Text decoding ----
function decodeText(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}

// ---- Chunking ----
function chunkText(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + size;
    // Try to break at a sentence boundary or newline near the end
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastNewline = slice.lastIndexOf("\n");
      const lastSentence = Math.max(
        slice.lastIndexOf("।"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? ")
      );
      const breakPoint = Math.max(lastNewline, lastSentence);
      if (breakPoint > size * 0.5) {
        end = start + breakPoint + 1;
      }
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
    // Avoid infinite loop if overlap >= size
    if (start >= text.length) break;
    // Ensure forward progress
    if (end <= start) {
      start = end;
    }
  }
  // Filter out empty chunks
  return chunks.filter((c) => c.length > 0);
}

// ---- File type detection helpers ----
function isPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return bytes[0] === PDF_MAGIC[0] && bytes[1] === PDF_MAGIC[1] &&
    bytes[2] === PDF_MAGIC[2] && bytes[3] === PDF_MAGIC[3];
}

function isTextFile(bytes: Uint8Array): boolean {
  // Check first 512 bytes for binary content
  const checkLen = Math.min(bytes.length, 512);
  let nullCount = 0;
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0) nullCount++;
  }
  // Text files should have very few null bytes
  return nullCount < checkLen * 0.1;
}

function guessType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "txt") return "text/plain";
  return "application/octet-stream";
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
