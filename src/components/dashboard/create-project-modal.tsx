"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/src/lib/supabase";
import {
  PROVIDER_OPTIONS,
  normalizeProvider,
} from "@/src/lib/project-providers";

const FRAMEWORKS = [
  "Next.js",
  "Astro",
  "Remix",
  "SvelteKit",
  "Nuxt",
  "Vite",
  "Static",
  "Custom",
] as const;

const RUNTIME_KINDS = [
  { value: "auto", label: "Auto-detect" },
  { value: "static", label: "Static" },
  { value: "docker", label: "Docker" },
] as const;

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none transition-all focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

type CreateProjectModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [framework, setFramework] = useState<string>(FRAMEWORKS[0]);
  const [provider, setProvider] = useState<string>(PROVIDER_OPTIONS[0].label);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [rootDirectory, setRootDirectory] = useState("");
  const [installCommand, setInstallCommand] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const [runtimeKind, setRuntimeKind] = useState<string>(RUNTIME_KINDS[0].value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedSlug = useMemo(
    () => (slugTouched ? slug : slugify(name)),
    [name, slug, slugTouched],
  );

  const resetForm = useCallback(() => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setFramework(FRAMEWORKS[0]);
    setProvider(PROVIDER_OPTIONS[0].label);
    setRepoUrl("");
    setBranch("main");
    setRootDirectory("");
    setInstallCommand("");
    setBuildCommand("");
    setOutputDirectory("");
    setStartCommand("");
    setRuntimeKind(RUNTIME_KINDS[0].value);
    setSubmitting(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    resetForm();
    onClose();
  }, [onClose, resetForm, submitting]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, open]);

  if (!open) return null;

  async function authHeader(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Your session expired. Please sign in again.");
    }
    return `Bearer ${token}`;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const finalSlug = computedSlug || slugify(name);
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    if (!finalSlug) {
      setError("Slug must contain at least one alphanumeric character.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          name: name.trim(),
          slug: finalSlug,
          framework,
          provider: normalizeProvider(provider),
          repo_url: repoUrl.trim() || null,
          branch: branch.trim() || "main",
          root_directory: rootDirectory.trim() || null,
          install_command: installCommand.trim() || null,
          build_command: buildCommand.trim() || null,
          output_directory: outputDirectory.trim() || null,
          start_command: startCommand.trim() || null,
          runtime_kind: runtimeKind,
          status: "idle",
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Failed to create project.");
        return;
      }

      resetForm();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={handleClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-lg">
        <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/40 via-basil-500/10 to-transparent opacity-80 blur-md" />

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-7 shadow-[0_0_60px_-15px_rgba(111,232,154,0.5)] backdrop-blur-2xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/60 to-transparent" />

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                {"// new-project"}
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Create project
              </h2>
              <p className="mt-1 text-sm text-white/55">
                Provision a new workspace on GTLNAV infrastructure.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-white/60 transition-colors hover:border-basil-400/40 hover:text-white"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error ? (
              <div
                role="alert"
                className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                {error}
              </div>
            ) : null}

            <div>
              <label
                htmlFor="project-name"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
              >
                Project name
              </label>
              <input
                id="project-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-edge-app"
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="project-slug"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
              >
                Slug
              </label>
              <input
                id="project-slug"
                type="text"
                value={computedSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="my-edge-app"
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1 text-[10px] text-white/40">
                Auto-generated from name. Edit to override.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="project-framework"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Framework
                </label>
                <select
                  id="project-framework"
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                  className={inputClass}
                >
                  {FRAMEWORKS.map((f) => (
                    <option key={f} value={f} className="bg-black">
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="project-provider"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Provider
                </label>
                <select
                  id="project-provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className={inputClass}
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p.value} value={p.label} className="bg-black">
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label
                  htmlFor="project-repo-url"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Repository URL
                </label>
                <input
                  id="project-repo-url"
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/GODTECHLABS/gtlnav-platform"
                  className={inputClass}
                />
              </div>

              <div>
                <label
                  htmlFor="project-branch"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Branch
                </label>
                <input
                  id="project-branch"
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label
                  htmlFor="project-runtime-kind"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Runtime mode
                </label>
                <select
                  id="project-runtime-kind"
                  value={runtimeKind}
                  onChange={(e) => setRuntimeKind(e.target.value)}
                  className={inputClass}
                >
                  {RUNTIME_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value} className="bg-black">
                      {kind.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="project-root-directory"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Root directory
                </label>
                <input
                  id="project-root-directory"
                  type="text"
                  value={rootDirectory}
                  onChange={(e) => setRootDirectory(e.target.value)}
                  placeholder="apps/web"
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label
                  htmlFor="project-output-directory"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Output directory
                </label>
                <input
                  id="project-output-directory"
                  type="text"
                  value={outputDirectory}
                  onChange={(e) => setOutputDirectory(e.target.value)}
                  placeholder="out or dist"
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label
                  htmlFor="project-install-command"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Install command
                </label>
                <input
                  id="project-install-command"
                  type="text"
                  value={installCommand}
                  onChange={(e) => setInstallCommand(e.target.value)}
                  placeholder="npm ci"
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label
                  htmlFor="project-build-command"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Build command
                </label>
                <input
                  id="project-build-command"
                  type="text"
                  value={buildCommand}
                  onChange={(e) => setBuildCommand(e.target.value)}
                  placeholder="npm run build"
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="project-start-command"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Start command
                </label>
                <input
                  id="project-start-command"
                  type="text"
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                  placeholder="npm start"
                  className={`${inputClass} font-mono`}
                />
                <p className="mt-1 text-[10px] text-white/40">
                  Used by future Docker runtime workers for SSR and long-running apps.
                </p>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
