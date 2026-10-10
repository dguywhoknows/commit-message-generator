const SAMPLE = `diff --git a/a.js b/a.js
new file mode 100644
--- /dev/null
+++ b/a.js
@@ -0,0 +1,2 @@
+one
+two
diff --git a/b.js b/b.js
--- a/b.js
+++ b/b.js
@@ -3,2 +3,2 @@ function f()
 keep
--- old
+new
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
diff --git a/gone.js b/gone.js
deleted file mode 100644
--- a/gone.js
+++ /dev/null
@@ -1 +0,0 @@
-bye`;
const mk = (path, adds = [], dels = [], status = 'modified') => ({ path, from: path, status, binary: false, add: adds.length, del: dels.length, hunks: [{ header: '@@', lines: [...dels.map((s, i) => ({ t: 'd', s, n: i + 1 })), ...adds.map((s, i) => ({ t: 'a', s, n: i + 1 }))] }] });

test('parseDiff reads added, modified, renamed, binary and deleted files', () => {
  const f = parseDiff(SAMPLE);
  assert.deepEq(f.map((x) => x.status), ['added', 'modified', 'renamed', 'modified', 'deleted']);
  assert.eq(f[0].add, 2);
  assert.eq(f[1].hunks[0].ctx, 'function f()');
  assert.deepEq(f[1].hunks[0].lines.map((l) => [l.t, l.s, l.n]), [['c', 'keep', 3], ['d', '-- old', 4], ['a', 'new', 4]]);
  assert.eq(f[2].from, 'old.txt'); assert.eq(f[2].path, 'new.txt');
  assert.ok(f[3].binary);
  assert.eq(f[4].path, 'gone.js'); assert.eq(f[4].del, 1);
});

test('guessType classifies by file kind and content', () => {
  assert.eq(guessType([mk('README.md', ['x'])]).type, 'docs');
  assert.eq(guessType([mk('src/a.test.js', ['x'])]).type, 'test');
  assert.eq(guessType([mk('.github/workflows/ci.yml', ['x'])]).type, 'ci');
  assert.eq(guessType([mk('package.json', ['x'])]).type, 'build');
  assert.eq(guessType([mk('src/up/new.js', ['x'], [], 'added')]).type, 'feat');
  assert.eq(guessType([mk('src/up/a.js', ['return user?.name;'], ['return user.name;'])]).type, 'fix');
  assert.eq(guessType([mk('src/up/a.js', ['a'], ['a', 'b', 'c', 'd'])]).type, 'refactor');
  assert.eq(guessType([mk('src/up/a.js', ['if (x) {  y(); }'], ['if (x) { y(); }'])]).type, 'style');
  assert.eq(guessType([mk('src/upload/a.js', ['x'], [], 'added'), mk('src/upload/b.js', ['y'])]).scope, 'upload');
  assert.eq(guessType([mk('src/a.js', ['x'], [], 'added')]).scope, '');
});

test('lintMessage accepts a good conventional message', () => {
  const checks = lintMessage('feat(upload): retry failed uploads\n\nWrap the request in a retry loop.', 'conventional');
  assert.ok(checks.every((c) => c.ok), checks.filter((c) => !c.ok).map((c) => c.text).join('; '));
});

test('lintMessage flags common mistakes', () => {
  const bad = lintMessage('Added stuff.\nno blank line', 'conventional');
  const failed = bad.filter((c) => !c.ok).map((c) => c.id).sort();
  assert.deepEq(failed, ['blank', 'mood', 'period', 'prefix', 'specific']);
  assert.ok(!lintMessage('feat!: drop node 14', 'conventional').find((c) => c.id === 'breaking').ok);
  assert.ok(lintMessage('feat!: drop node 14\n\nBREAKING CHANGE: needs node 18', 'conventional').every((c) => c.ok));
});

test('lintMessage applies custom conventions', () => {
  const conv = { types: ['feat', 'fix'], scopes: ['api', 'ui'], requireScope: true, requireIssue: true, maxSubject: 50 };
  const failed = (m) => lintMessage(m, 'conventional', conv).filter((c) => !c.ok).map((c) => c.id).sort();
  assert.deepEq(failed('chore: tidy'), ['issue', 'scope', 'type']);
  assert.deepEq(failed('fix(db): handle null (#12)'), ['scopes']);
  assert.deepEq(failed('fix(api): handle null rows from the reporting endpoint (#12)'), ['length']);
  assert.deepEq(failed('fix(api): handle null rows PROJ-81'), []);
});

test('wrapBody wraps long lines and keeps bullet indentation', () => {
  const out = wrapBody('- ' + 'word '.repeat(30).trim(), 40).split('\n');
  assert.ok(out.length > 1);
  assert.ok(out.every((l) => l.length <= 40));
  assert.ok(out[1].startsWith('  word'));
  assert.eq(wrapBody('https://example.com/' + 'x'.repeat(90), 72).split('\n').length, 1);
});

test('diffWarnings finds secrets, debug code, conflicts and focused tests', () => {
  const w = diffWarnings([
    mk('src/a.js', ['console.log(user)', 'const key = "AKIAABCDEFGHIJKLMNOP"', '<<<<<<< HEAD', '// TODO: remove']),
    mk('src/a.test.js', ['console.log(x)', 'it.only("works", () => {})']),
    mk('.env', ['DB=1'], [], 'added'),
  ]);
  const ids = w.map((x) => x.id + '@' + x.file).sort();
  assert.deepEq(ids, ['conflict@src/a.js', 'debug@src/a.js', 'focus@src/a.test.js', 'secret@src/a.js', 'secretfile@.env', 'todo@src/a.js']);
  assert.eq(w.find((x) => x.id === 'secret').level, 'high');
});

test('splitCommits keeps tests with their code and separates docs, deps and CI', () => {
  const groups = splitCommits([mk('src/upload/retry.js', ['x'], [], 'added'), mk('src/ui/button.js', ['y']), mk('src/upload/retry.test.js', ['t'], [], 'added'), mk('README.md', ['d']), mk('package.json', ['p']), mk('.github/workflows/ci.yml', ['c'])]);
  assert.deepEq(groups.map((g) => g.key), ['code:upload', 'code:ui', 'docs', 'build', 'ci']);
  assert.deepEq(groups[0].files, ['src/upload/retry.js', 'src/upload/retry.test.js']);
  assert.eq(groups[0].scope, 'upload'); assert.eq(groups[0].type, 'feat');
  assert.eq(groups[2].type, 'docs');
});

test('parseLog reads oneline and pipe formats', () => {
  const c = parseLog('a1b2c3d feat(api): add search\n9f8e7d6|fix!: drop legacy auth|Sam|2026-10-01\nbadline\n1234567 Update readme');
  assert.eq(c.length, 3);
  assert.deepEq([c[0].type, c[0].scope, c[0].desc], ['feat', 'api', 'add search']);
  assert.ok(c[1].breaking); assert.eq(c[1].author, 'Sam'); assert.eq(c[1].date, '2026-10-01');
  assert.eq(c[2].type, 'other');
});

test('bumpFor and nextVersion follow semver', () => {
  assert.eq(bumpFor(parseLog('aaaaaaa fix: a')), 'patch');
  assert.eq(bumpFor(parseLog('aaaaaaa fix: a\nbbbbbbb feat: b')), 'minor');
  assert.eq(bumpFor(parseLog('aaaaaaa feat!: b')), 'major');
  assert.eq(nextVersion('1.4.2', 'minor'), '1.5.0');
  assert.eq(nextVersion('v1.4.2', 'major'), '2.0.0');
  assert.eq(nextVersion('0.3.1', 'major'), '0.4.0', 'pre-1.0 breaking bumps minor');
  assert.eq(nextVersion('1.4.2', 'patch'), '1.4.3');
});

test('buildChangelog groups commits into Keep a Changelog sections', () => {
  const md = buildChangelog(parseLog('aaaaaaa feat(api): add search\nbbbbbbb fix: handle empty query\nccccccc chore: bump deps\nddddddd feat!: remove v1 endpoints'), '2.0.0', '2026-10-08', { hashes: true });
  assert.ok(md.startsWith('## [2.0.0] - 2026-10-08'));
  assert.ok(md.indexOf('### Breaking changes') < md.indexOf('### Added'));
  assert.ok(md.includes('- **api:** Add search (aaaaaaa)'));
  assert.ok(md.includes('### Fixed\n- Handle empty query (bbbbbbb)'));
  assert.ok(!md.includes('bump deps'));
  assert.ok(buildChangelog([], '1.0.1', 'x').includes('No user-facing changes'));
});

test('commitlintConfig and gitCommitCommand', () => {
  const cfg = commitlintConfig({ types: ['feat', 'fix'], scopes: ['api'], requireScope: true });
  assert.ok(cfg.includes("'type-enum': [2, 'always', ['feat', 'fix']]"));
  assert.ok(cfg.includes("'scope-enum'")); assert.ok(cfg.includes("'scope-empty': [2, 'never']"));
  assert.eq(gitCommitCommand("fix: it's done\n\nbody"), "git commit -m 'fix: it'\\''s done' -m 'body'");
  assert.eq(langOf('a/b.tsx'), 'TypeScript'); assert.eq(categoryOf('docs/x.md'), 'docs');
});
