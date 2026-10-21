// process-document: receives a document upload (PDF/TXT), validates it,
// extracts text, splits into chunks, and stores chunks as knowledge_entries.
//
// Security:
//   1. Requires a valid Supabase JWT — user MUST be authenticated.
//      No owner_label fallback (Part 1 RLS fix removed anon access).
//   2. File validation: type check (PDF/TXT only), size limit (10MB),
//      magic byte check for PDFs, binary detection for TXT.
//   3. Storage path is always `<auth.uid()>/<uuid>-<sanitized-name>` —
//      the folder name MUST match auth.uid() so Storage RLS allows it.
//   4. On re-processing (document_id provided), verifies the existing
//      document belongs to the authenticated user before touching it.
//   5. Duplicate prevention: if document_id is provided, old chunks are
//      deleted only AFTER new extraction succeeds. If extraction fails,
//      old chunks are preserved.
//   6. Service-role key stays server-side only. User-supplied document_id
//      and storage_path are NEVER trusted blindly — always verified against
//      the authenticated user's records.
//   7. Extracted document text is treated as untrusted input — the
//      gemini-chat function's system prompt instructs the AI never to
//      follow instructions embedded inside retrieved documents.
//
// Flow:
//   POST /process-document  (JSON with base64)
//   -> authenticate -> validate file -> upload to private storage
//   -> create user_documents row (status=pending)
//   -> extract text -> chunk -> insert knowledge_entries
//   -> update user_documents status to 'ready'
//   On failure: set status='failed', preserve old data if re-processing

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const CHUNK_SIZE = 1000; // target ~1000 chars per chunk (within 800-1200 range)
const CHUNK_OVERLAP = 0; // no overlap — avoids duplicate content in knowledge base
const ALLOWED_EXTENSIONS = new Set(["pdf", "txt"]);
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
    // ---- Auth: require authenticated user ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized: authentication required." }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authData?.user?.id) {
      return json({ error: "Unauthorized: invalid or expired session." }, 401);
    }
    const userId = authData.user.id;

    // ---- Parse request (JSON with base64-encoded file) ----
    const body = await req.json();
    const base64 = String(body.file ?? "");
    const fileName = String(body.fileName ?? "document");
    const title = String(body.title ?? fileName).trim();
    const reprocessDocId = body.documentId ? String(body.documentId) : null;

    if (!base64) return json({ error: "No file data provided." }, 400);

    // Decode base64 to bytes
    const binary = atob(base64);
    const fileBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) fileBytes[i] = binary.charCodeAt(i);

    // ---- Validate file ----
    if (fileBytes.length === 0) {
      return json({ error: "Empty file." }, 400);
    }
    if (fileBytes.length > MAX_FILE_SIZE) {
      return json({ error: "File too large. Maximum size is 10 MB." }, 400);
    }

    // Determine actual file type by extension + magic bytes
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return json({ error: `Unsupported file type: .${ext}. Only PDF and TXT files are accepted.` }, 400);
    }

    let detectedType: "pdf" | "txt";
    if (ext === "pdf" || isPdfMagic(fileBytes)) {
      if (!isPdfMagic(fileBytes)) {
        return json({ error: "Invalid PDF file: file signature does not match. The file may be corrupted or is not a real PDF." }, 400);
      }
      detectedType = "pdf";
    } else {
      if (!isTextFile(fileBytes)) {
        return json({ error: "File appears to be binary, not a valid text file." }, 400);
      }
      detectedType = "txt";
    }

    // ---- Re-processing: verify ownership of existing document ----
    let existingDocId: string | null = null;
    let existingStoragePath: string | null = null;

    if (reprocessDocId) {
      const { data: existing, error: fetchErr } = await supabase
        .from("user_documents")
        .select("id, user_id, storage_path")
        .eq("id", reprocessDocId)
        .maybeSingle();

      if (fetchErr || !existing) {
        return json({ error: "Document not found for re-processing." }, 404);
      }
      if (existing.user_id !== userId) {
        return json({ error: "Forbidden: you do not own this document." }, 403);
      }
      existingDocId = existing.id;
      existingStoragePath = existing.storage_path;
    }

    // ---- Create or reuse user_documents record ----
    let documentId: string;
    const storagePath = `${userId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;

    if (existingDocId) {
      // Update existing record to pending, keep old chunks until success
      const { error: updateErr } = await supabase
        .from("user_documents")
        .update({
          title,
          file_name: fileName,
          file_type: detectedType,
          file_size: fileBytes.length,
          storage_path: storagePath,
          status: "pending",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingDocId);

      if (updateErr) {
        return json({ error: "Failed to update document record: " + updateErr.message }, 500);
      }
      documentId = existingDocId;
    } else {
      const { data: docRecord, error: docError } = await supabase
        .from("user_documents")
        .insert({
          user_id: userId,
          owner_label: null,
          title,
          file_name: fileName,
          file_type: detectedType,
          file_size: fileBytes.length,
          storage_path: storagePath,
          status: "pending",
        })
        .select()
        .maybeSingle();

      if (docError || !docRecord) {
        return json({ error: "Failed to create document record: " + (docError?.message ?? "unknown") }, 500);
      }
      documentId = docRecord.id;
    }

    // ---- Upload to storage ----
    const { error: uploadError } = await supabase.storage
      .from("user-documents")
      .upload(storagePath, fileBytes, {
        contentType: detectedType === "pdf" ? "application/pdf" : "text/plain",
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
      if (detectedType === "pdf") {
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
      // Clean up the new uploaded file (old file preserved if re-processing)
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
        content_text: cleanedText.length > 0 ? cleanedText : null,
      }).eq("id", documentId);
      await supabase.storage.from("user-documents").remove([storagePath]);
      return json({ error: errMsg }, 422);
    }

    // ---- Chunk the text ----
    const chunks = chunkText(cleanedText, CHUNK_SIZE);
    const totalChunks = chunks.length;

    // ---- Replace old chunks if re-processing ----
    if (existingDocId) {
      const { error: delErr } = await supabase
        .from("knowledge_entries")
        .delete()
        .eq("document_id", documentId);

      if (delErr) {
        // Non-fatal: old chunks may remain, but we proceed with new ones
        console.warn("Failed to delete old chunks:", delErr.message);
      }
      // Clean up old storage file
      if (existingStoragePath && existingStoragePath !== storagePath) {
        await supabase.storage.from("user-documents").remove([existingStoragePath]);
      }
    }

    // ---- Insert chunks as knowledge_entries ----
    const entries = chunks.map((chunk, i) => ({
      user_id: userId,
      owner_label: null,
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
      // Don't delete old chunks — we already deleted them above.
      // The document status reflects the failure.
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
// Uses pdf-parse via npm: import for Deno. Works for text-based PDFs.
// Scanned/image-only PDFs return empty text — caller handles that.
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  try {
    // Buffer polyfill for Deno — pdf-parse expects a Node.js Buffer
    const { Buffer } = await import("node:buffer");
    const pdfParse = (await import("npm:pdf-parse@1.1.1")).default;
    const buffer = Buffer.from(bytes);
    const data = await pdfParse(buffer);
    return data.text ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ocr") || msg.includes("image") || msg.includes("scan") || msg.includes("empty")) {
      throw new Error("This appears to be a scanned PDF with no extractable text. OCR is not currently supported. Please upload a text-based PDF or a TXT file.");
    }
    throw new Error(`PDF text extraction failed: ${msg}. The file may be corrupted, encrypted, or a scanned image.`);
  }
}

// ---- Text decoding ----
function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ---- Chunking ----
// Splits text into ~CHUNK_SIZE character chunks, trying to break at
// sentence boundaries (English . ! ? and Bengali ।) or newlines.
function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + size;
    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }
    // Try to break at a sentence boundary or newline in the last 20% of the chunk
    const searchStart = start + Math.floor(size * 0.8);
    const slice = text.slice(searchStart, end);
    const lastNewline = slice.lastIndexOf("\n");
    const lastSentence = Math.max(
      slice.lastIndexOf("।"),
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
    );
    const breakOffset = Math.max(lastNewline, lastSentence);
    if (breakOffset >= 0) {
      end = searchStart + breakOffset + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    // Ensure forward progress: next start must be beyond current start
    if (end <= start) {
      start = start + 1;
    } else {
      start = end;
    }
  }
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

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
