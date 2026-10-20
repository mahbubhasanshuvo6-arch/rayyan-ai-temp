import { useEffect, useState, useCallback } from "react";
import { supabase, EDGE_URL } from "@/lib/supabase";
import { useSettings, accentMap } from "@/lib/useSettings";
import { navigate } from "@/lib/router";
import type { Project, GeneratedFile } from "@/lib/types";
import {
  ArrowLeft, Sparkles, Loader2, Plus, FileCode, Trash2,
  Eye, Copy, Check, FolderOpen,
} from "lucide-react";

const SESSION_LABEL_KEY = "rayyan_owner_label";
function getOrCreateOwnerLabel(): string {
  let label = localStorage.getItem(SESSION_LABEL_KEY);
  if (!label) {
    label = `anon-${crypto.randomUUID()}`;
    localStorage.setItem(SESSION_LABEL_KEY, label);
  }
  return label;
}

export default function BuilderPage() {
  const { settings } = useSettings();
  const accent = accentMap[settings.accent_color] ?? accentMap.blue;
  const [projects, setProjects] = useState<Project[]>([]);
  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [activeFile, setActiveFile] = useState<GeneratedFile | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const ownerLabel = getOrCreateOwnerLabel();

  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("owner_label", ownerLabel)
      .order("created_at", { ascending: false });
    if (data) setProjects(data as Project[]);
  }, [ownerLabel]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const loadFiles = async (project: Project) => {
    const { data } = await supabase
      .from("generated_files")
      .select("*")
      .eq("project_id", project.id)
      .order("path", { ascending: true });
    const f = (data as GeneratedFile[]) ?? [];
    setFiles(f);
    setActiveFile(f[0] ?? null);
    buildPreview(f);
  };

  const buildPreview = (allFiles: GeneratedFile[]) => {
    const htmlFile = allFiles.find((f) => f.path.endsWith(".html"));
    const cssFile = allFiles.find((f) => f.path.endsWith(".css"));
    const jsFile = allFiles.find((f) => f.path.endsWith(".js"));
    if (!htmlFile) {
      setPreviewHtml(null);
      return;
    }
    let html = htmlFile.content;
    if (cssFile) {
      html = html.replace("</head>", `<style>\n${cssFile.content}\n</style>\n</head>`);
    }
    if (jsFile) {
      html = html.replace("</body>", `<script>\n${jsFile.content}\n</script>\n</body>`);
    }
    setPreviewHtml(html);
  };

  const selectProject = (p: Project) => {
    setActiveProject(p);
    loadFiles(p);
  };

  const build = async () => {
    if (!prompt.trim() || building) return;
    if (!settings.app_builder_enabled) {
      setError("App builder is currently disabled by the administrator.");
      return;
    }
    setBuilding(true);
    setError(null);

    try {
      const res = await fetch(`${EDGE_URL}/gemini-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ mode: "build", prompt: prompt.trim(), ownerLabel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Build failed.");
        setBuilding(false);
        return;
      }

      const { data: proj } = await supabase
        .from("projects")
        .insert({
          owner_label: ownerLabel,
          name: data.name ?? "Untitled App",
          description: data.description ?? "",
          prompt: prompt.trim(),
          status: "ready",
        })
        .select()
        .maybeSingle();

      if (proj && data.files?.length) {
        const inserts = data.files.map((f: { path: string; language: string; content: string }) => ({
          project_id: (proj as Project).id,
          path: f.path,
          language: f.language,
          content: f.content,
        }));
        await supabase.from("generated_files").insert(inserts);
        selectProject(proj as Project);
      }
      setPrompt("");
      loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBuilding(false);
    }
  };

  const deleteProject = async (id: string) => {
    if (!confirm("Delete this project and all its files?")) return;
    await supabase.from("projects").delete().eq("id", id);
    if (activeProject?.id === id) {
      setActiveProject(null);
      setFiles([]);
      setActiveFile(null);
      setPreviewHtml(null);
    }
    loadProjects();
  };

  const copyFile = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [showPreview, setShowPreview] = useState(true);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900 sticky top-0 z-10">
        <button onClick={() => navigate("chat")} className="text-slate-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accent.gradient} flex items-center justify-center`}>
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-lg font-semibold flex-1">App Builder</h1>
      </header>

      <div className="max-w-6xl mx-auto p-4 grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Left: projects + prompt */}
        <div className="space-y-4">
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Build something new
            </h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the app you want... e.g. 'A todo list app with dark mode and local storage'"
              rows={4}
              className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-slate-600 resize-none mb-3"
            />
            <button
              onClick={build}
              disabled={!prompt.trim() || building}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg ${accent.bg} text-white font-medium disabled:opacity-40 transition`}
            >
              {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {building ? "Building..." : "Generate App"}
            </button>
            {error && (
              <p className="mt-3 text-sm text-rose-300 bg-rose-950/50 border border-rose-800 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>

          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <FolderOpen className="w-4 h-4" /> My Projects
            </h2>
            {projects.length === 0 && <p className="text-sm text-slate-500">No projects yet.</p>}
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => selectProject(p)}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer mb-1 transition ${
                  activeProject?.id === p.id ? "bg-slate-800" : "hover:bg-slate-800/50"
                }`}
              >
                <FileCode className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="flex-1 text-sm truncate">{p.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: preview + files */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 min-h-[500px]">
          {!activeProject ? (
            <div className="flex flex-col items-center justify-center h-[500px] text-slate-500">
              <Sparkles className="w-12 h-12 mb-3 opacity-40" />
              <p>Generate an app or select a project to see it here.</p>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800">
                <h3 className="font-medium flex-1 truncate">{activeProject.name}</h3>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  {showPreview ? "View Code" : "View Preview"}
                </button>
              </div>

              {showPreview ? (
                previewHtml ? (
                  <iframe
                    srcDoc={previewHtml}
                    className="flex-1 w-full bg-white"
                    style={{ minHeight: "450px" }}
                    title="Preview"
                    sandbox="allow-scripts"
                  />
                ) : (
                  <div className="flex items-center justify-center h-[450px] text-slate-500 text-sm">
                    No HTML file to preview.
                  </div>
                )
              ) : (
                <div className="flex flex-col lg:flex-row flex-1">
                  <div className="lg:w-48 border-r border-slate-800 p-2 overflow-x-auto">
                    {files.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setActiveFile(f)}
                        className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 mb-1 ${
                          activeFile?.id === f.id ? "bg-slate-800" : "hover:bg-slate-800/50"
                        }`}
                      >
                        <FileCode className="w-3 h-3 text-slate-500" />
                        <span className="truncate">{f.path}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 relative">
                    {activeFile && (
                      <button
                        onClick={copyFile}
                        className="absolute top-2 right-2 z-10 p-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    )}
                    <pre className="p-4 text-sm overflow-auto h-[450px] font-mono text-slate-200">
                      <code>{activeFile?.content ?? ""}</code>
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
