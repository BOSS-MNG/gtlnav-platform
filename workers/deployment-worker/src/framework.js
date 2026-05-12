/**
 * GTLNAV deployment-worker — framework detection.
 *
 * Inspects the cloned repo and decides:
 *   - hosting kind: 'static' | 'docker' | 'unsupported'
 *   - which package manager to use (npm / pnpm / yarn / none)
 *   - which install / build commands to run
 *   - where the static output ends up (static kind only)
 *   - how to start the runtime (docker kind only)
 *
 * Detection precedence:
 *   1. Operator override   — projects.runtime_kind ('static' | 'docker').
 *   2. Dockerfile present  — always docker.
 *   3. Next.js with output:'export' or `npm run export` — static.
 *   4. Next.js otherwise   — docker (SSR).
 *   5. Express / Koa / Fastify / Hapi / Nest — docker.
 *   6. Vite / CRA / Astro / Nuxt-generate / plain HTML — static.
 *   7. Anything else with a `start` script and no `build` — docker.
 *   8. Anything else with a `build` script — static (best effort).
 *   9. Plain `index.html` and no package.json — static.
 *   10. Otherwise — unsupported.
 */
import path from "node:path";
import fs from "node:fs/promises";

const STATIC_PUBLISH_CANDIDATES = [
  "out",
  "dist",
  "build",
  "public",
  ".output/public",
];

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p) {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readText(p) {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function detectPackageManager(repoRoot) {
  if (await exists(path.join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(repoRoot, "yarn.lock"))) return "yarn";
  if (await exists(path.join(repoRoot, "package-lock.json"))) return "npm";
  if (await exists(path.join(repoRoot, "package.json"))) return "npm";
  return null;
}

/**
 * Probes next.config.{js,mjs,ts} for `output: 'export'` so we know whether
 * Next will land in `out/` (static) or needs SSR (docker).
 */
async function nextIsStaticExport(repoRoot, pkg) {
  // Explicit script wins.
  if (pkg.scripts?.export) return true;
  if (pkg.scripts?.build && /next\s+export/.test(pkg.scripts.build)) return true;
  for (const file of ["next.config.mjs", "next.config.js", "next.config.ts"]) {
    const txt = await readText(path.join(repoRoot, file));
    if (txt && /output\s*[:=]\s*['"]export['"]/.test(txt)) return true;
  }
  return false;
}

function hasAnyDep(deps, names) {
  for (const n of names) {
    if (deps[n]) return true;
  }
  return false;
}

/**
 * @returns {Promise<{
 *   hostingKind: 'static' | 'docker' | 'unsupported',
 *   framework:
 *     | 'next-static' | 'next-ssr' | 'vite' | 'cra' | 'astro' | 'nuxt-static'
 *     | 'express' | 'fastify' | 'koa' | 'hapi' | 'nest' | 'node-start'
 *     | 'dockerfile' | 'static-site' | 'unsupported',
 *   packageManager: 'npm' | 'pnpm' | 'yarn' | null,
 *   installCommand: string | null,
 *   buildCommand: string | null,
 *   startCommand: string | null,
 *   publishDir: string | null,
 *   nodeVersion: string | null,
 *   dockerfileExists: boolean,
 *   dockerfileTemplate: 'none' | 'next-ssr' | 'node-generic',
 *   internalPortHint: number | null,
 *   notes: string[]
 * }>}
 */
export async function detectFramework(repoRoot, projectOverrides = {}) {
  const notes = [];
  const pkg = await readJson(path.join(repoRoot, "package.json"));
  const pm = await detectPackageManager(repoRoot);
  const dockerfileExists = await exists(path.join(repoRoot, "Dockerfile"));
  const hostingOverride = (projectOverrides.runtimeKindHint ?? "auto")
    .toString()
    .toLowerCase();

  // ---------------------- branch 0: forced operator override ----------------
  // operator → projects.runtime_kind = 'static' | 'docker'
  // (hostingKindHint is intentionally not read here — it's the *persisted*
  // value and runtime_kind is the *operator override*; runtime_kind wins.)
  let operatorForce = null;
  if (hostingOverride === "static") operatorForce = "static";
  else if (hostingOverride === "docker") operatorForce = "docker";

  // ---------------------- branch 1: Dockerfile in repo ----------------------
  if (dockerfileExists && operatorForce !== "static") {
    notes.push("Detected Dockerfile — using docker runtime.");
    return baseDocker({
      framework: "dockerfile",
      pm,
      pkg,
      notes,
      dockerfileTemplate: "none",
      internalPortHint: detectExposedPort(repoRoot, pkg),
      installCommand: null,
      buildCommand: null,
      startCommand: null,
    });
  }

  // ---------------------- branch 2: plain HTML site -------------------------
  if (!pkg && (await exists(path.join(repoRoot, "index.html")))) {
    notes.push("No package.json — serving repo root as a static site.");
    return baseStatic({
      framework: "static-site",
      pm: null,
      notes,
      pkg: null,
      installCommand: null,
      buildCommand: null,
      publishDir: ".",
    });
  }
  if (!pkg) {
    return {
      hostingKind: "unsupported",
      framework: "unsupported",
      packageManager: null,
      installCommand: null,
      buildCommand: null,
      startCommand: null,
      publishDir: null,
      nodeVersion: null,
      dockerfileExists: false,
      dockerfileTemplate: "none",
      internalPortHint: null,
      notes: ["No package.json and no index.html — nothing to publish."],
    };
  }

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts ?? {};

  // ---------------------- branch 3: Next.js ---------------------------------
  if (deps.next) {
    const isStaticNext =
      operatorForce === "static" || (await nextIsStaticExport(repoRoot, pkg));
    if (isStaticNext) {
      notes.push("Detected Next.js static export.");
      return baseStatic({
        framework: "next-static",
        pm,
        pkg,
        notes,
        installCommand: null,
        buildCommand: scripts.export ? "export" : "build",
        publishDir: "out",
      });
    }
    notes.push("Detected Next.js SSR — using docker runtime.");
    return baseDocker({
      framework: "next-ssr",
      pm,
      pkg,
      notes,
      dockerfileTemplate: "next-ssr",
      internalPortHint: 3000,
      installCommand: null,
      buildCommand: "build",
      // We pin start to `npm start` so Next picks the right binary.
      startCommand: scripts.start ? "start" : "build && start",
    });
  }

  // ---------------------- branch 4: Node server frameworks ------------------
  // Apps that need SSR/runtime even if they don't ship a Dockerfile.
  const serverFrameworks = {
    express: "express",
    fastify: "fastify",
    koa: "koa",
    "@hapi/hapi": "hapi",
    "@nestjs/core": "nest",
  };
  for (const [dep, name] of Object.entries(serverFrameworks)) {
    if (deps[dep] && operatorForce !== "static") {
      notes.push(`Detected ${name} — using docker runtime.`);
      return baseDocker({
        framework: name,
        pm,
        pkg,
        notes,
        dockerfileTemplate: "node-generic",
        internalPortHint: detectExposedPort(repoRoot, pkg) ?? 3000,
        installCommand: null,
        buildCommand: scripts.build ? "build" : null,
        startCommand: scripts.start ? "start" : null,
      });
    }
  }

  // ---------------------- branch 5: classic static frameworks ---------------
  if (deps.vite && operatorForce !== "docker") {
    notes.push("Detected Vite.");
    return baseStatic({
      framework: "vite",
      pm,
      pkg,
      notes,
      installCommand: null,
      buildCommand: "build",
      publishDir: "dist",
    });
  }
  if (deps["react-scripts"] && operatorForce !== "docker") {
    notes.push("Detected Create React App.");
    return baseStatic({
      framework: "cra",
      pm,
      pkg,
      notes,
      installCommand: null,
      buildCommand: "build",
      publishDir: "build",
    });
  }
  if (deps.astro && operatorForce !== "docker") {
    notes.push("Detected Astro.");
    return baseStatic({
      framework: "astro",
      pm,
      pkg,
      notes,
      installCommand: null,
      buildCommand: "build",
      publishDir: "dist",
    });
  }
  if (deps.nuxt && operatorForce !== "docker") {
    notes.push("Detected Nuxt — using `nuxt generate` for static output.");
    return baseStatic({
      framework: "nuxt-static",
      pm,
      pkg,
      notes,
      installCommand: null,
      buildCommand: scripts.generate ? "generate" : "build",
      publishDir: ".output/public",
    });
  }

  // ---------------------- branch 6: generic node server ---------------------
  if (
    scripts.start &&
    operatorForce !== "static" &&
    (operatorForce === "docker" || !scripts.build || hasAnyDep(deps, ["http", "node:http"]))
  ) {
    notes.push("Detected `npm start` script — using docker runtime.");
    return baseDocker({
      framework: "node-start",
      pm,
      pkg,
      notes,
      dockerfileTemplate: "node-generic",
      internalPortHint: detectExposedPort(repoRoot, pkg) ?? 3000,
      installCommand: null,
      buildCommand: scripts.build ? "build" : null,
      startCommand: "start",
    });
  }

  // ---------------------- branch 7: generic static build --------------------
  if (scripts.build) {
    notes.push(
      "Unrecognized framework — running `npm run build` and probing common output directories.",
    );
    return baseStatic({
      framework: "static-site",
      pm,
      pkg,
      notes,
      installCommand: null,
      buildCommand: "build",
      publishDir: null,
    });
  }

  // ---------------------- fallback: unsupported -----------------------------
  return {
    hostingKind: "unsupported",
    framework: "unsupported",
    packageManager: pm,
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    publishDir: null,
    nodeVersion: pkg.engines?.node ?? null,
    dockerfileExists: false,
    dockerfileTemplate: "none",
    internalPortHint: null,
    notes: [
      "No recognizable framework, no Dockerfile, no `build`/`start` script.",
    ],
  };

  // -------------------------- helpers ---------------------------------------

  function baseStatic(args) {
    const installCommand =
      projectOverrides.installCommand ??
      args.installCommand ??
      pmInstallCommand(args.pm);
    const buildScript = projectOverrides.buildCommand ?? args.buildCommand;
    const resolvedBuildCommand = buildScript
      ? args.pm === "pnpm"
        ? `pnpm run ${buildScript}`
        : args.pm === "yarn"
          ? `yarn ${buildScript}`
          : `npm run ${buildScript}`
      : null;

    let publishDir = projectOverrides.buildOutputDir ?? args.publishDir;
    return {
      hostingKind: "static",
      framework: args.framework,
      packageManager: args.pm,
      installCommand,
      buildCommand: resolvedBuildCommand,
      startCommand: null,
      publishDir,
      nodeVersion: args.pkg?.engines?.node ?? null,
      dockerfileExists,
      dockerfileTemplate: "none",
      internalPortHint: null,
      notes: args.notes,
    };
  }

  function baseDocker(args) {
    const installCommand =
      projectOverrides.installCommand ??
      args.installCommand ??
      pmInstallCommand(args.pm);
    const buildScript = projectOverrides.buildCommand ?? args.buildCommand;
    const resolvedBuildCommand = buildScript
      ? args.pm === "pnpm"
        ? `pnpm run ${buildScript}`
        : args.pm === "yarn"
          ? `yarn ${buildScript}`
          : `npm run ${buildScript}`
      : null;
    const startScript = args.startCommand;
    const resolvedStartCommand = startScript
      ? args.pm === "pnpm"
        ? `pnpm run ${startScript}`
        : args.pm === "yarn"
          ? `yarn ${startScript}`
          : `npm run ${startScript}`
      : null;
    return {
      hostingKind: "docker",
      framework: args.framework,
      packageManager: args.pm,
      installCommand,
      buildCommand: resolvedBuildCommand,
      startCommand: resolvedStartCommand,
      publishDir: null,
      nodeVersion: args.pkg?.engines?.node ?? null,
      dockerfileExists,
      dockerfileTemplate: args.dockerfileTemplate ?? "node-generic",
      internalPortHint: args.internalPortHint ?? null,
      notes: args.notes,
    };
  }
}

function pmInstallCommand(pm) {
  if (pm === "pnpm") return "pnpm install --frozen-lockfile=false";
  if (pm === "yarn") return "yarn install";
  return "npm install --no-audit --no-fund";
}

/**
 * Look for a `PORT` env declaration in the package.json's start script.
 * Conservative: only matches `PORT=12345` literals.
 */
function detectExposedPort(_repoRoot, pkg) {
  const start = pkg?.scripts?.start;
  if (typeof start === "string") {
    const m = start.match(/PORT=(\d{2,5})/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n < 65536) return n;
    }
  }
  return null;
}

/**
 * Resolve the publish dir for static builds after the build step ran.
 * Falls back to the first existing candidate directory.
 */
export async function resolveStaticPublishDir(repoRoot, configured) {
  if (configured && (await exists(path.join(repoRoot, configured)))) {
    return configured;
  }
  for (const candidate of STATIC_PUBLISH_CANDIDATES) {
    if (await exists(path.join(repoRoot, candidate))) return candidate;
  }
  return configured ?? null;
}
