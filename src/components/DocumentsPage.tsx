import { useState, useCallback, useEffect, useRef } from "react";
import { supabase, EDGE_URL } from "@/lib/supabase";
import { navigate } from "@/lib/router";
import type { UserDocument } from "@/lib/types";
import {
  FileText, Upload, Trash2, ArrowLeft, Loader2, AlertCircle,
  CheckCircle2, FileUp, X, Info, LogIn,
} from "lucide-react";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthUserId(data.session?.user?.id ?? null);
    });
  }, []);

  const load = useCallback(async () => {
    if (!authUserId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qe } = await supabase
        .from("user_documents")
        .select("id, user_id, owner_label, title, file_name, file_type, file_size, chunk_count, status, error_message, created_at, updated_at")
        .eq("user_id", authUserId)
        .order("created_at", { ascending: false });
      if (qe) {
        setError(qe.message);
      } else {
        setDocuments((data as UserDocument[]) ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    }
    setLoading(false);
  }, [authUserId]);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file: File) => {
    setError(null);

    // Client-side validation
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (ext !== "pdf" && ext !== "txt") {
      setError("Only PDF and TXT files are supported.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("File too large. Maximum size is 10 MB.");
      return;
    }
    if (file.size === 0) {
      setError("Empty file.");
      return;
    }

    setUploading(true);
    setUploadProgress("Reading file...");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setError("Please sign in to upload documents.");
        setUploading(false);
        setUploadProgress(null);
        return;
      }

      // Convert file to base64 for JSON API
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(binary);

      setUploadProgress("Uploading and extracting text...");

      const res = await fetch(`${EDGE_URL}/process-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          file: base64,
          fileName: file.name,
          fileType: file.type,
          title: file.name.replace(/\.[^.]+$/, ""),
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? "Upload failed.");
      } else {
        setUploadProgress(null);
        load(); // Refresh list
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    }
    setUploading(false);
    setUploadProgress(null);
  };

  const handleDelete = async (id: string) => {
    // Delete via direct DB + storage — RLS allows owner to delete
    // First get storage_path
    const { data: doc } = await supabase
      .from("user_documents")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();

    if (doc?.storage_path) {
      await supabase.storage.from("user-documents").remove([doc.storage_path]);
    }
    // Delete the document record — cascades to knowledge_entries chunks
    await supabase.from("user_documents").delete().eq("id", id);
    setConfirmDelete(null);
    load();
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ""; // Reset so same file can be selected again
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate("chat")}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Chat
          </button>
          <h1 className="text-lg font-semibold flex-1 text-center">
            <FileText className="w-5 h-5 inline mr-2 text-slate-400" />
            My Documents
          </h1>
          <div className="w-24" />
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4 lg:p-6 space-y-6">
        {/* Auth gate */}
        {!authUserId ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <LogIn className="w-8 h-8 text-slate-400" />
            </div>
            <p className="text-slate-300 font-medium mb-2">Sign in required</p>
            <p className="text-sm text-slate-500 mb-6">
              You need to be signed in to upload and manage your documents.
            </p>
            <button
              onClick={() => navigate("chat")}
              className="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500"
            >
              Go to Chat to Sign In
            </button>
          </div>
        ) : (
          <>
        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition ${
            dragOver
              ? "border-blue-500 bg-blue-950/20"
              : "border-slate-700 bg-slate-900/50 hover:border-slate-600"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            onChange={onFileSelect}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
              <p className="text-sm text-slate-300">{uploadProgress ?? "Processing..."}</p>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-3 w-full"
            >
              <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center">
                <FileUp className="w-7 h-7 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  Upload PDF or TXT file
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Drag and drop or click to browse. Max 10 MB.
                </p>
              </div>
            </button>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-rose-950/50 border border-rose-800 text-rose-200 rounded-xl px-4 py-3 text-sm flex items-start gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{error}</p>
              {error.includes("scanned") || error.includes("OCR") ? (
                <p className="text-xs text-rose-300/70 mt-2">
                  Scanned PDFs contain images, not text. Please upload a text-based PDF or convert it to TXT first.
                </p>
              ) : null}
            </div>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Info banner */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-400 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
          <p>
            Your documents are private — only you can see them. Text is extracted and split into searchable chunks.
            When you chat, relevant content from your documents is automatically included as context for the AI.
          </p>
        </div>

        {/* Document list */}
        <div>
          <h2 className="text-sm font-medium text-slate-400 mb-3">
            {documents.length} {documents.length === 1 ? "document" : "documents"}
          </h2>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No documents uploaded yet. Upload a PDF or TXT file to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex items-start gap-4"
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                    {doc.file_type === "pdf" ? (
                      <FileText className="w-5 h-5 text-rose-400" />
                    ) : (
                      <FileText className="w-5 h-5 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{doc.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {doc.file_name} · {formatBytes(doc.file_size)}
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      {doc.status === "ready" && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> Ready · {doc.chunk_count} chunks
                        </span>
                      )}
                      {doc.status === "pending" && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                          <Loader2 className="w-3 h-3 animate-spin" /> Processing...
                        </span>
                      )}
                      {doc.status === "failed" && (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-400">
                          <AlertCircle className="w-3 h-3" /> Failed
                        </span>
                      )}
                      <span className="text-xs text-slate-600">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {doc.status === "failed" && doc.error_message && (
                      <p className="text-xs text-rose-300/80 mt-2 bg-rose-950/30 rounded-lg px-3 py-2">
                        {doc.error_message}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setConfirmDelete(doc.id)}
                    className="text-slate-500 hover:text-rose-400 shrink-0 p-1.5 rounded-lg transition"
                    title="Delete document"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
          </>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-700 p-6 max-w-md w-full">
            <p className="text-sm text-slate-200 mb-5">
              Delete this document? All extracted text chunks will also be removed. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-sm text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm hover:bg-rose-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
