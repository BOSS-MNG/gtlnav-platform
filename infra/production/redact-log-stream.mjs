#!/usr/bin/env node
/**
 * Redacts secret values from deploy logs.
 *
 * Sources:
 * - current process environment
 * - optional .env.local path passed as argv[2]
 *
 * This is intentionally additive and conservative: it redacts only values we
 * can confidently identify as sensitive, and leaves public values untouched.
 */

import fs from "node:fs";
import readline from "node:readline";

const envFile = process.argv[2] ?? "";

function collectSecrets() {
  const values = new Set();

  const add = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed.length < 8) return;
    values.add(trimmed);
  };

  const isSensitiveKey = (key) =>
    /(^|_)(SECRET|TOKEN|KEY|PASSWORD|PASS|WEBHOOK|SUPABASE_SERVICE_ROLE|GITHUB_OAUTH_CLIENT_SECRET)/i.test(
      key,
    );

  for (const [key, value] of Object.entries(process.env)) {
    if (isSensitiveKey(key)) {
      add(value);
    }
  }

  if (envFile && fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (isSensitiveKey(key)) {
        add(value);
      }
    }
  }

  return [...values].sort((a, b) => b.length - a.length);
}

const secrets = collectSecrets();

function redact(line) {
  let out = line;
  for (const secret of secrets) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  process.stdout.write(`${redact(line)}\n`);
});
