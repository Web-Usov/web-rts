import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  ROOT,
  parseNote,
  validateSources,
  loadNotes,
  buildIndex,
  search,
  main,
  digest,
} from "./knowledge-base.mjs";

const raw = readFileSync(resolve(ROOT, "docs/knowledge/notes/permanent-leave-queue.md"), "utf8");
const note = parseNote(raw);
const notes = loadNotes();
const index = buildIndex(notes);

test("real KB validates, deterministic index independent of discovery order", () => {
  assert.equal(notes.length, 3);
  assert.deepEqual(index, buildIndex([...notes].reverse()));
  assert.equal(main(["check"]).startsWith("PASS"), true);
});
test("weighted exact-token ranking, AND query, filters, bounded output and stable ties", () => {
  assert.equal(search(index, "blocked target")[0].id, "navigation-component-cache");
  assert.equal(
    search(index, "pending MOVE", { component: "runtime", tags: ["leave"] })[0].id,
    "permanent-leave-queue",
  );
  assert.deepEqual(search(index, "pending MOVE", { component: "navigation" }), []);
  assert.deepEqual(search(index, "pending MOVE", { tags: ["cache"] }), []);
  assert.equal(search(index, "", { tags: ["ci"] })[0].id, "branch-naming-gate");
  const repeated = Array.from({ length: 15 }, (_, i) => ({
    ...index.find((row) => row.id === "navigation-component-cache"),
    id: `item-${String(i).padStart(2, "0")}`,
  }));
  assert.equal(search(repeated, "blocked").length, 5);
  assert.equal(search(repeated, "blocked", { limit: 10 }).length, 10);
  assert.equal(search(repeated.reverse(), "blocked")[0].id, "item-00");
  assert.deepEqual(search(index, "quantum-rutabaga"), []);
  assert.deepEqual(search(index, "blokced"), []); // no silent fuzzy "correction"
  assert.deepEqual(search(index, "BLOCKED"), search(index, "blocked"));
  for (const limit of [0, 11, 1.5, NaN]) assert.throws(() => search(index, "x", { limit }));
  assert.throws(() => search(index, ""));
  assert.throws(() => search(index, "x".repeat(301)));
});
test("show only selected note; invalid CLI arguments fail closed", () => {
  assert.equal(main(["show", note.id]), raw);
  for (const args of [
    [],
    ["unknown"],
    ["check", "extra"],
    ["show"],
    ["show", "../README"],
    ["search", "--unknown"],
    ["search", "--limit"],
    ["index", "--online"],
    ["search", "x", "--limit", "2", "--limit", "3"],
  ])
    assert.throws(() => main(args));
});
test("malformed YAML, unsupported YAML, empty content, stale and duplicate keys rejected", () => {
  for (const text of [
    raw.replace("---", "oops"),
    raw.replace('status: "verified"', 'status: "stale"'),
    raw.replace('id: "permanent-leave-queue"', "id: unquoted"),
    raw.replace("tags: [", "tags: &anchor ["),
    raw.replace('component: "runtime"', 'component: "runtime"\ncomponent: "runtime"'),
    raw.replace('component: "runtime"', 'unknown: "runtime"'),
    raw.replace("## Причина", "## Missing"),
    raw.replace(/## Причина[\s\S]*?## Решение/, "## Причина\n\n## Решение"),
    raw.replace('"queue",', '"queue", "queue",'),
    raw + "\nTODO",
    raw + "x".repeat(13000),
  ])
    assert.throws(() => parseNote(text));
});
test("fake secrets and PII rejected without leaking values", () => {
  for (const secret of [
    "sk-" + "A".repeat(25),
    "ghp_" + "B".repeat(25),
    "AKIA" + "C".repeat(16),
    "api_key: fake_test_credential_123",
    "password = example_password_123",
    "-----BEGIN PRIVATE KEY-----",
    "person@example.com",
    "/Users/example/private",
  ]) {
    assert.throws(
      () => parseNote(raw + "\n" + secret),
      /secret\/PII pattern detected \(value redacted\)/,
    );
  }
});
test("missing, modified, traversal, symlink and duplicate file sources fail", () => {
  const root = mkdtempSync(resolve(tmpdir(), "web-rts-kb-"));
  try {
    writeFileSync(resolve(root, "file.txt"), "source");
    const candidate = { ...note, sources: [`file.txt@${digest("source")}`] };
    validateSources(candidate, root, { git: false });
    writeFileSync(resolve(root, "file.txt"), "changed");
    assert.throws(() => validateSources(candidate, root, { git: false }), /stale source/);
    for (const sources of [
      [`missing.txt@${digest("source")}`],
      [`../file.txt@${digest("source")}`],
      [`/file.txt@${digest("source")}`],
    ])
      assert.throws(() => validateSources({ ...note, sources }, root, { git: false }));
    writeFileSync(resolve(root, "file.txt"), "source");
    assert.throws(
      () =>
        validateSources(
          { ...candidate, sources: [...candidate.sources, ...candidate.sources] },
          root,
          { git: false },
        ),
      /duplicate affected/,
    );
    symlinkSync(resolve(root, "file.txt"), resolve(root, "alias.txt"));
    assert.throws(
      () =>
        validateSources({ ...candidate, sources: [`alias.txt@${digest("source")}`] }, root, {
          git: false,
        }),
      /symlink/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("duplicate titles/body and filename mismatch rejected", () => {
  const root = mkdtempSync(resolve(tmpdir(), "web-rts-kb-"));
  try {
    mkdirSync(resolve(root, "docs/knowledge/notes"), { recursive: true });
    writeFileSync(resolve(root, "file.txt"), "source");
    const fixture = (id) =>
      raw
        .replace('id: "permanent-leave-queue"', `id: "${id}"`)
        .replace(/^sources: .*$/m, `sources: ["file.txt@${digest("source")}"]`);
    writeFileSync(resolve(root, "docs/knowledge/notes/one.md"), fixture("one"));
    writeFileSync(resolve(root, "docs/knowledge/notes/two.md"), fixture("two"));
    assert.throws(() => loadNotes(root, { git: false }), /duplicate note/);
    rmSync(resolve(root, "docs/knowledge/notes/two.md"));
    writeFileSync(resolve(root, "docs/knowledge/notes/two.md"), fixture("one"));
    assert.throws(() => loadNotes(root, { git: false }), /filename must match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("missing commit and malformed source URL rejected", () => {
  assert.throws(() =>
    validateSources({
      ...note,
      commits: ["https://github.com/Web-Usov/web-rts/commit/" + "0".repeat(40)],
    }),
  );
  assert.throws(() => parseNote(raw.replace("/issues/54", "/issues/not-an-issue")));
  assert.throws(() =>
    parseNote(raw.replace("/commit/5443b18d9e475a47291ea2a23dd7e00b1275cefd", "/commit/short")),
  );
});
test("index CLI reproducible on clean source archive, unknown id exit 1", () => {
  // Temporary checkout retains only committed history and candidate source files.
  const root = mkdtempSync(resolve(tmpdir(), "web-rts-kb-"));
  try {
    execFileSync("git", ["clone", "--quiet", "--no-hardlinks", ROOT, root]);
    mkdirSync(resolve(root, "docs/knowledge/notes"), { recursive: true });
    for (const n of notes) {
      writeFileSync(resolve(root, n.path), n.text);
      for (const source of n.sources) {
        const path = source.split("@")[0];
        mkdirSync(resolve(root, path, ".."), { recursive: true });
        writeFileSync(resolve(root, path), readFileSync(resolve(ROOT, path)));
      }
    }
    assert.equal(main(["check"], root).startsWith("PASS"), true);
    main(["index"], root);
    const first = readFileSync(resolve(root, ".artifacts/verification/kb/index.json"), "utf8");
    main(["index"], root);
    assert.equal(
      readFileSync(resolve(root, ".artifacts/verification/kb/index.json"), "utf8"),
      first,
    );
    assert.deepEqual(JSON.parse(first).notes, index);
    const result = spawnSync(process.execPath, ["scripts/knowledge-base.mjs", "show", "missing"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
