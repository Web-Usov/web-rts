import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEYS = [
  "id",
  "title",
  "component",
  "tags",
  "context",
  "status",
  "issues",
  "prs",
  "commits",
  "sources",
];
const LISTS = ["tags", "issues", "prs", "commits", "sources"];
const SECTIONS = ["Симптом", "Причина", "Решение", "Проверка", "Ограничения"];
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const digest = (text) => createHash("sha256").update(text).digest("hex");
const fail = (message) => {
  throw new Error(message);
};

// A deliberately small YAML subset: JSON-quoted strings and flow string arrays.
// Unsupported YAML is rejected, never heuristically interpreted.
export function parseNote(text) {
  if (Buffer.byteLength(text) > 12 * 1024) fail("note exceeds 12 KiB");
  if (
    /(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s"',]{8,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\/(?:Users|home)\/[^\s/]+)/i.test(
      text,
    )
  )
    fail("secret/PII pattern detected (value redacted)");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(text);
  if (!match) fail("invalid front matter");
  const meta = {};
  for (const line of match[1].split("\n")) {
    const item = /^([a-z]+): (.+)$/.exec(line);
    if (!item || !KEYS.includes(item[1]) || Object.hasOwn(meta, item[1]))
      fail("unknown/duplicate/malformed key");
    let value;
    try {
      value = JSON.parse(item[2]);
    } catch {
      fail("use quoted strings / flow string arrays");
    }
    const isList = LISTS.includes(item[1]);
    if (
      isList
        ? !Array.isArray(value) ||
          !value.length ||
          value.some((v) => typeof v !== "string" || !v.trim()) ||
          new Set(value).size !== value.length
        : typeof value !== "string" || !value.trim()
    )
      fail("invalid field type or empty/duplicate value");
    meta[item[1]] = value;
  }
  if (KEYS.some((k) => !Object.hasOwn(meta, k))) fail("missing required field");
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(meta.id) || !/^[a-z][a-z0-9-]*$/.test(meta.component))
    fail("invalid id/component");
  if (
    meta.title.length > 160 ||
    meta.context.length > 300 ||
    meta.tags.some((t) => !/^[a-z0-9][a-z0-9-]*$/.test(t))
  )
    fail("invalid title/context/tags");
  if (meta.status !== "verified")
    fail("stale/unverified note: reverify or remove from active notes");
  for (const [key, kind] of [
    ["issues", "issues"],
    ["prs", "pull"],
  ]) {
    if (
      meta[key].some(
        (v) => !new RegExp(`^https://github.com/Web-Usov/web-rts/${kind}/[1-9][0-9]*$`).test(v),
      )
    )
      fail("invalid issue/PR source");
  }
  if (
    meta.commits.some(
      (v) => !/^https:\/\/github.com\/Web-Usov\/web-rts\/commit\/[a-f0-9]{40}$/.test(v),
    )
  )
    fail("invalid commit source");
  const sections = [...match[2].matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  for (const name of SECTIONS) {
    const found = sections.filter((s) => s[1] === name);
    if (found.length !== 1 || found[0][2].trim().length < 25)
      fail(`missing/empty/duplicate section: ${name}`);
  }
  if (/FILL IN|TODO|TBD/.test(match[2])) fail("unfilled template");
  return { ...meta, body: match[2], text };
}

export function validateSources(note, root = ROOT, { git = true, online = false } = {}) {
  const paths = new Set();
  for (const source of note.sources) {
    const match = /^([a-zA-Z0-9_./-]+)@([a-f0-9]{64})$/.exec(source);
    if (!match || match[1].startsWith("/") || match[1].split("/").some((p) => p === ".." || !p))
      fail("invalid affected file source");
    const path = match[1];
    if (paths.has(path)) fail("duplicate affected file");
    paths.add(path);
    // Reject symlinks at every level; sources must stay in the checkout.
    let current = root;
    for (const part of path.split("/")) {
      current = resolve(current, part);
      if (lstatSync(current).isSymbolicLink()) fail("symlink source rejected");
    }
    if (digest(readFileSync(current)) !== match[2])
      fail(`stale source: ${path}; reverify note before updating hash`);
  }
  if (git)
    for (const url of note.commits) {
      const sha = url.split("/").at(-1);
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "pipe" });
      execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
        cwd: root,
        stdio: "pipe",
      });
    }
  if (online) {
    for (const url of [...note.issues, ...note.prs]) {
      const endpoint = url.replace("https://github.com/", "repos/").replace("/pull/", "/pulls/");
      const data = JSON.parse(
        execFileSync("gh", ["api", endpoint], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
      if (data.state !== "closed" || (url.includes("/pull/") && !data.merged_at))
        fail("source is not resolved/merged");
    }
  }
}

export function loadNotes(root = ROOT, options = {}) {
  const directory = resolve(root, "docs/knowledge/notes");
  const notes = readdirSync(directory)
    .sort(compare)
    .map((file) => {
      if (!/^[a-z0-9-]+\.md$/.test(file) || lstatSync(resolve(directory, file)).isSymbolicLink())
        fail("invalid note filename/symlink");
      const note = parseNote(readFileSync(resolve(directory, file), "utf8"));
      if (file !== `${note.id}.md`) fail("filename must match id");
      validateSources(note, root, options);
      return { ...note, path: relative(root, resolve(directory, file)).replaceAll("\\", "/") };
    });
  if (!notes.length) fail("empty knowledge base");
  if (
    new Set(notes.map((n) => n.id)).size !== notes.length ||
    new Set(notes.map((n) => n.title.toLowerCase())).size !== notes.length ||
    new Set(notes.map((n) => digest(n.body))).size !== notes.length
  )
    fail("duplicate note");
  return notes;
}
const tokens = (text) => [
  ...new Set(
    text
      .toLowerCase()
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  ),
];
export function buildIndex(notes) {
  return notes
    .map((note) => {
      const weights = new Map();
      for (const [field, weight] of [
        [note.body, 1],
        [note.context, 2],
        [note.component + " " + note.tags.join(" "), 4],
        [note.title + " " + note.id, 5],
      ])
        for (const word of tokens(field))
          weights.set(word, Math.max(weight, weights.get(word) ?? 0));
      const symptom = note.body
        .split("## Симптом\n")[1]
        .split("\n## ")[0]
        .trim()
        .replace(/\s+/g, " ");
      return {
        id: note.id,
        title: note.title,
        component: note.component,
        tags: note.tags,
        path: note.path,
        checksum: digest(note.text),
        snippet: symptom.slice(0, 240),
        terms: Object.fromEntries([...weights].sort(([a], [b]) => compare(a, b))),
      };
    })
    .sort((a, b) => compare(a.id, b.id));
}
export function search(index, query, { component, tags = [], limit = 5 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) fail("limit must be 1..10");
  if (typeof query !== "string" || query.length > 300)
    fail("query must be text of at most 300 characters");
  const words = tokens(query);
  if (!words.length && !component && !tags.length) fail("query or filter required");
  return index
    .filter(
      (row) =>
        (!component || row.component === component) && tags.every((t) => row.tags.includes(t)),
    )
    .map((row) => {
      const matched = words.filter((w) => row.terms[w]);
      return { ...row, score: matched.reduce((sum, w) => sum + row.terms[w], 0), matched };
    })
    .filter((row) => !words.length || row.matched.length === words.length)
    .sort((a, b) => b.score - a.score || compare(a.id, b.id))
    .slice(0, limit)
    .map(({ terms, checksum, ...row }) => row);
}

export function main(args, root = ROOT) {
  const [command, ...rest] = args;
  if (!["index", "search", "show", "check"].includes(command))
    fail(
      "usage: kb index|check [--online]|show <id>|search <query> [--component x] [--tag x] [--limit 1..10]",
    );
  const options = { tags: [] };
  const positional = [];
  let online = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--online" && command === "check" && !online) {
      online = true;
      continue;
    }
    if (arg.startsWith("--")) {
      if (
        command !== "search" ||
        !["--component", "--tag", "--limit"].includes(arg) ||
        !rest[i + 1] ||
        rest[i + 1].startsWith("--")
      )
        fail("invalid option");
      const value = rest[++i];
      if (arg === "--tag") options.tags.push(value);
      else {
        const key = arg.slice(2);
        if (Object.hasOwn(options, key)) fail("duplicate option");
        options[key] = key === "limit" ? Number(value) : value;
      }
    } else positional.push(arg);
  }
  if (
    (["index", "check"].includes(command) && positional.length) ||
    (command === "show" && positional.length !== 1)
  )
    fail("unexpected/missing argument");
  // Validate before emitting any data, including search/show. Never serve stale notes.
  const notes = loadNotes(root, { online });
  if (command === "check")
    return `PASS: ${notes.length} notes; schema, content, file fingerprints, commit ancestry${online ? ", live GitHub sources" : " (GitHub availability not checked; use --online)"}`;
  if (command === "show") {
    const note = notes.find((n) => n.id === positional[0]);
    if (!note) fail("unknown note id");
    return note.text;
  }
  const index = buildIndex(notes);
  if (command === "search")
    return JSON.stringify(search(index, positional.join(" "), options), null, 2);
  const output = resolve(root, ".artifacts/verification/kb/index.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ schemaVersion: 1, notes: index }, null, 2) + "\n");
  return `Indexed ${notes.length} notes: .artifacts/verification/kb/index.json`;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`KB FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
