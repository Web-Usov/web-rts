import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from "node:fs";
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
// Search fixtures must not turn real source drift into a required-CI failure.
const catalog = loadNotes();
const notes = catalog.map((note) => ({ ...note, status: "verified", staleReasons: [] }));
const index = buildIndex(notes);

test("real KB validates, deterministic index independent of discovery order", () => {
  assert.ok(catalog.length >= 3);
  assert.deepEqual(buildIndex(catalog), buildIndex([...catalog].reverse()));
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
  assert.deepEqual(search(index, "constructor"), []); // Object prototype is not an indexed term
  assert.deepEqual(search(index, "blokced"), []); // no silent fuzzy "correction"
  assert.deepEqual(search(index, "BLOCKED"), search(index, "blocked"));
  for (const limit of [0, 11, 1.5, NaN]) assert.throws(() => search(index, "x", { limit }));
  assert.throws(() => search(index, ""));
  assert.throws(() => search(index, "x".repeat(301)));
});
test("show only selected note; invalid CLI arguments fail closed", () => {
  withCatalog((root, id) => {
    const expected = readFileSync(resolve(root, `docs/knowledge/notes/${id}.md`), "utf8");
    assert.equal(main(["show", id], root), expected);
  });
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
test("malformed YAML, unsupported YAML, empty content, invalid status and duplicate keys rejected", () => {
  for (const text of [
    raw.replace("---", "oops"),
    raw.replace('status: "verified"', 'status: "unknown"'),
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
test("changed/missing files are stale; unsafe and duplicate sources still fail", () => {
  const root = mkdtempSync(resolve(tmpdir(), "web-rts-kb-"));
  try {
    writeFileSync(resolve(root, "file.txt"), "source");
    const candidate = { ...note, sources: [`file.txt@${digest("source")}`] };
    validateSources(candidate, root, { git: false });
    writeFileSync(resolve(root, "file.txt"), "changed");
    assert.deepEqual(validateSources(candidate, root, { git: false }), [
      "changed source: file.txt",
    ]);
    assert.deepEqual(
      validateSources({ ...candidate, sources: [`missing.txt@${digest("source")}`] }, root, {
        git: false,
      }),
      ["missing source: missing.txt"],
    );
    for (const sources of [
      [`../file.txt@${digest("source")}`],
      [`./file.txt@${digest("source")}`],
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
    writeFileSync(resolve(root, "file.txt"), "changed"); // duplicate detection includes stale notes
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
        if (existsSync(resolve(ROOT, path)))
          writeFileSync(resolve(root, path), readFileSync(resolve(ROOT, path)));
        else rmSync(resolve(root, path), { force: true });
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
    assert.deepEqual(JSON.parse(first).notes, buildIndex(loadNotes(root)));
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

function withCatalog(run) {
  const root = mkdtempSync(resolve(tmpdir(), "web-rts-kb-policy-"));
  try {
    mkdirSync(resolve(root, "docs/knowledge/notes"), { recursive: true });
    for (const file of ["one.txt", "two.txt"]) writeFileSync(resolve(root, file), "original");
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=KB Test",
        "-c",
        "user.email=kb@test.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    for (const [i, file] of ["one.txt", "two.txt"].entries()) {
      const text = notes[i].text
        .replace(/^status: .*$/m, 'status: "verified"')
        .replace(/^sources: .*$/m, `sources: ["${file}@${digest("original")}"]`)
        .replace(
          /^commits: .*$/m,
          `commits: ["https://github.com/Web-Usov/web-rts/commit/${sha}"]`,
        );
      writeFileSync(resolve(root, notes[i].path), text);
    }
    mkdirSync(resolve(root, "scripts"));
    writeFileSync(
      resolve(root, "scripts/knowledge-base.mjs"),
      readFileSync(resolve(ROOT, "scripts/knowledge-base.mjs")),
    );
    run(root, notes[0].id, notes[1].id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("one stale note never blocks healthy retrieval; check warns and CLI exits zero", () => {
  withCatalog((root, staleId, validId) => {
    writeFileSync(resolve(root, "one.txt"), "api_key: fake_do_not_echo_credential");
    const messages = [];
    const run = (args) => main(args, root, { warn: (message) => messages.push(message) });
    const results = JSON.parse(run(["search", "MOVE"]));
    assert.deepEqual(
      results.map((row) => row.id),
      [validId],
    );
    assert.equal(results[0].status, "verified");
    assert.equal(loadNotes(root).find((row) => row.id === staleId).status, "stale");
    assert.match(run(["check"]), /2 notes validated; 1 verified, 1 stale/);
    const shown = run(["show", staleId]);
    assert.match(shown, /STALE:.*reverification required/);
    assert.match(shown, /changed source: one.txt/);
    assert.doesNotMatch(shown, /status: "verified"|fake_do_not_echo/);
    assert.match(run(["show", validId]), /status: "verified"/);
    run(["index"]);
    const built = JSON.parse(
      readFileSync(resolve(root, ".artifacts/verification/kb/index.json"), "utf8"),
    );
    assert.deepEqual(
      built.notes.map((row) => row.id),
      [validId],
    );
    assert.deepEqual(
      built.stale.map((row) => row.id),
      [staleId],
    );
    assert.ok(messages.some((message) => /stale note.*excluded/.test(message)));
    const invoke = (args) =>
      spawnSync(process.execPath, ["scripts/knowledge-base.mjs", ...args], {
        cwd: root,
        encoding: "utf8",
      });
    const checked = invoke(["check"]);
    assert.equal(checked.status, 0);
    assert.match(checked.stdout, /1 stale/);
    const searched = invoke(["search", "MOVE"]);
    assert.equal(searched.status, 0);
    assert.match(searched.stderr, /KB WARNING/);
    assert.deepEqual(
      JSON.parse(searched.stdout).map((row) => row.id),
      [validId],
    );
    assert.equal(invoke(["show", staleId]).status, 0);
    rmSync(resolve(root, "one.txt"));
    assert.match(run(["show", staleId]), /missing source/);
    assert.deepEqual(
      JSON.parse(run(["search", "MOVE"])).map((row) => row.id),
      [validId],
    );
    rmSync(resolve(root, "two.txt"));
    assert.deepEqual(JSON.parse(run(["search", "MOVE"])), []);
    assert.match(run(["check"]), /0 verified, 2 stale/);
    writeFileSync(resolve(root, "one.txt"), "original");
    assert.match(run(["show", staleId]), /status: "verified"/);
  });
});

test("declared stale note is excluded, but invalid content/provenance remains fatal", () => {
  withCatalog((root, staleId, validId) => {
    const path = resolve(root, notes[0].path);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace('status: "verified"', 'status: "stale"'));
    assert.match(main(["show", staleId], root), /note marked stale/);
    assert.equal(
      buildIndex(loadNotes(root)).some((row) => row.id === staleId),
      false,
    );
    writeFileSync(resolve(root, "one.txt"), "changed");
    for (const bad of [
      original + "\napi_key: fake_test_key_12345",
      original.replace("component:", "unknown:"),
      original.replace(
        /https:\/\/github.com\/Web-Usov\/web-rts\/commit\/[a-f0-9]{40}/,
        "https://github.com/Web-Usov/web-rts/commit/" + "0".repeat(40),
      ),
      original.replace(
        /^sources: .*$/m,
        `sources: ["one.txt@${digest("original")}", "../escape@${digest("original")}"]`,
      ),
    ]) {
      writeFileSync(path, bad);
      for (const args of [["search", "MOVE"], ["show", validId], ["check"], ["index"]])
        assert.throws(() => main(args, root));
      const result = spawnSync(process.execPath, ["scripts/knowledge-base.mjs", "check"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.doesNotMatch(result.stderr, /fake_test_key_12345/);
    }
    writeFileSync(path, original);
    rmSync(resolve(root, "one.txt"));
    symlinkSync(resolve(root, "two.txt"), resolve(root, "one.txt"));
    assert.throws(() => main(["search", "MOVE"], root), /symlink/);
  });
});

test("online missing source is stale; authentication/request errors remain fatal and redacted", () => {
  withCatalog((root) => {
    const bin = resolve(root, "bin");
    mkdirSync(bin);
    const gh = resolve(bin, "gh");
    const invoke = () =>
      spawnSync(process.execPath, ["scripts/knowledge-base.mjs", "check", "--online"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
    writeFileSync(
      gh,
      '#!/bin/sh\necho "gh: Not Found (HTTP 404) fake_sensitive_detail" >&2\nexit 1\n',
      { mode: 0o755 },
    );
    const missing = invoke();
    assert.equal(missing.status, 0);
    assert.match(missing.stdout, /2 stale/);
    assert.match(missing.stdout, /unavailable GitHub source/);
    assert.doesNotMatch(missing.stdout + missing.stderr, /fake_sensitive_detail/);
    writeFileSync(gh, '#!/bin/sh\necho "authentication error fake_sensitive_detail" >&2\nexit 1\n');
    const error = invoke();
    assert.equal(error.status, 1);
    assert.equal(error.stdout, "");
    assert.match(error.stderr, /verification failed.*redacted/);
    assert.doesNotMatch(error.stderr, /fake_sensitive_detail/);
  });
});
