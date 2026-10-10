/* core.js — unified-diff parsing, change classification, message linting, pre-commit checks, commit splitting and changelogs (pure, unit-tested). */

function parseDiff(text) {
  var out = [], f = null, hunk = null, oldLn = 0, newLn = 0, m;
  var lines = String(text).replace(/\r/g, '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if ((m = l.match(/^diff --git a\/(.+?) b\/(.+)$/))) { f = { from: m[1], path: m[2], status: 'modified', hunks: [], add: 0, del: 0, binary: false }; out.push(f); hunk = null; continue; }
    if (!f && l.indexOf('--- ') === 0) { f = { from: '', path: '', status: 'modified', hunks: [], add: 0, del: 0, binary: false }; out.push(f); }
    if (!f) continue;
    if (l.indexOf('new file mode') === 0) f.status = 'added';
    else if (l.indexOf('deleted file mode') === 0) f.status = 'deleted';
    else if (l.indexOf('rename from ') === 0) { f.status = 'renamed'; f.from = l.slice(12); }
    else if (l.indexOf('rename to ') === 0) f.path = l.slice(10);
    else if (l.indexOf('Binary files') === 0) f.binary = true;
    else if (l.indexOf('--- ') === 0 && !hunk) { var p = l.slice(4).replace(/^a\//, ''); if (p !== '/dev/null') f.from = f.from || p; else f.status = 'added'; }
    else if (l.indexOf('+++ ') === 0 && !hunk) { var q = l.slice(4).replace(/^b\//, ''); if (q !== '/dev/null') f.path = f.path || q; else { f.status = 'deleted'; f.path = f.path || f.from; } }
    else if ((m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/))) { oldLn = +m[1]; newLn = +m[2]; hunk = { header: l, ctx: m[3].trim(), lines: [] }; f.hunks.push(hunk); }
    else if (hunk && /^[+\- \\]/.test(l)) {
      var t = l[0];
      if (t === '+') { hunk.lines.push({ t: 'a', s: l.slice(1), n: newLn++ }); f.add++; }
      else if (t === '-') { hunk.lines.push({ t: 'd', s: l.slice(1), n: oldLn++ }); f.del++; }
      else if (t === ' ') { hunk.lines.push({ t: 'c', s: l.slice(1), n: newLn++ }); oldLn++; }
    }
  }
  return out.filter(function (x) { return x.path || x.from; });
}

/* ---------- classification ---------- */
function isTest(p) { return /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|_test\.(py|go)$|test_\w+\.py$/.test(p); }
function isDoc(p) { return /\.(md|mdx|rst|txt)$|(^|\/)docs?\//i.test(p); }
function isDeps(p) { return /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements(-dev)?\.txt|Pipfile(\.lock)?|poetry\.lock|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?)$/.test(p); }
function isCI(p) { return /^\.github\/|\.gitlab-ci|Jenkinsfile|\.circleci\//.test(p); }
function added(f) { return f.hunks.reduce(function (a, hk) { return a.concat(hk.lines.filter(function (l) { return l.t === 'a'; })); }, []); }
function isStyleOnly(f) {
  return f.hunks.length > 0 && f.hunks.every(function (hk) {
    var a = hk.lines.filter(function (l) { return l.t === 'a'; }).map(function (l) { return l.s.replace(/\s+/g, ''); }).join('');
    var d = hk.lines.filter(function (l) { return l.t === 'd'; }).map(function (l) { return l.s.replace(/\s+/g, ''); }).join('');
    return a === d;
  });
}
function categoryOf(p) { return isTest(p) ? 'test' : isDoc(p) ? 'docs' : isDeps(p) ? 'build' : isCI(p) ? 'ci' : 'code'; }
function commonScope(paths) {
  var dirs = paths.map(function (p) { var s = p.split('/'); return s.length > 1 ? s[s.length - 2] : ''; });
  var c = dirs.every(function (d) { return d && d === dirs[0]; }) ? dirs[0] : '';
  return ['src', 'lib', 'app', 'packages', 'tests', 'test', '__tests__'].indexOf(c) >= 0 ? '' : c;
}
function guessType(fs) {
  if (!fs.length) return { type: 'chore', scope: '' };
  var code = fs.filter(function (f) { return categoryOf(f.path) === 'code'; });
  var type = 'feat';
  var all = function (fn) { return fs.every(function (f) { return fn(f.path); }); };
  if (all(isDoc)) type = 'docs';
  else if (all(isTest)) type = 'test';
  else if (all(isCI)) type = 'ci';
  else if (all(isDeps)) type = 'build';
  else if (code.length && code.every(isStyleOnly)) type = 'style';
  else {
    var adds = code.reduce(function (a, f) { return a + f.add; }, 0), dels = code.reduce(function (a, f) { return a + f.del; }, 0);
    var text = code.reduce(function (a, f) { return a.concat(added(f).map(function (l) { return l.s; })); }, []).join('\n');
    if (code.some(function (f) { return f.status === 'added'; })) type = 'feat';
    else if (/\b(fix|bug|null|undefined|guard|edge case|off.by.one|crash|throw)\b|\?\.|\?\?/i.test(text) && adds < 80) type = 'fix';
    else if (dels > adds * 1.4) type = 'refactor';
    else if (/\b(cache|memo|debounce|throttle|index|batch|lazy)\b/i.test(text)) type = 'perf';
  }
  return { type: type, scope: commonScope(fs.map(function (f) { return f.path; })) };
}
function langOf(p) {
  var ext = (p.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
  return { js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', rb: 'Ruby', css: 'CSS', scss: 'CSS', html: 'HTML', md: 'Markdown', json: 'JSON', yml: 'YAML', yaml: 'YAML', sh: 'Shell', sql: 'SQL', c: 'C', cpp: 'C++', cs: 'C#', php: 'PHP', kt: 'Kotlin', swift: 'Swift' }[ext.toLowerCase()] || (ext ? ext.toUpperCase() : 'Other');
}

/* ---------- message linting ---------- */
var DEFAULT_CONVENTIONS = { types: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'], scopes: [], maxSubject: 72, bodyWidth: 72, requireScope: false, requireIssue: false, issuePattern: '#\\d+|[A-Z][A-Z0-9]+-\\d+' };
function lintMessage(msg, style, conv) {
  conv = Object.assign({}, DEFAULT_CONVENTIONS, conv || {});
  var lines = String(msg).split('\n'), subject = lines[0] || '', blank = lines[1], body = lines.slice(2);
  var desc = subject.replace(/^(\p{Extended_Pictographic}\uFE0F?|:\w+:)\s*/u, '').replace(/^\w+(\([^)]*\))?!?:\s*/, '');
  var first = desc.split(/\s+/)[0] || '';
  var head = subject.match(/^(\w+)(?:\(([\w\-./]+)\))?(!)?: \S/);
  var checks = [
    { id: 'length', ok: subject.length <= conv.maxSubject, text: 'Subject \u2264 ' + conv.maxSubject + ' chars (' + subject.length + ')' },
    { id: 'period', ok: !/\.$/.test(subject.trim()), text: 'No trailing period in subject' },
    { id: 'mood', ok: !/(ed|ing)$/i.test(first) || /^(add|use|fix|update|remove|refactor|release|close|merge|bump|embed|seed|feed|need|shed|speed|bring|ring|string|sing)$/i.test(first), text: 'Imperative mood ("' + first + '": write "add", not "added" or "adding")' },
    { id: 'blank', ok: lines.length < 2 || blank === '', text: 'Blank line between subject and body' },
    { id: 'wrap', ok: body.every(function (l) { return l.length <= conv.bodyWidth || /^\s*(https?:|[-*] \S+:\/\/)/.test(l); }), text: 'Body wrapped at ' + conv.bodyWidth + ' columns' },
    { id: 'specific', ok: !/\b(wip|stuff|misc|changes|update(d)? files?)\b/i.test(subject), text: 'Subject is specific (no "misc", "stuff", "wip")' },
  ];
  if (style === 'conventional') {
    checks.push({ id: 'prefix', ok: !!head, text: 'Conventional prefix like "feat(scope): \u2026"' });
    if (head) {
      checks.push({ id: 'type', ok: conv.types.indexOf(head[1]) >= 0, text: 'Type "' + head[1] + '" is one of: ' + conv.types.join(', ') });
      if (conv.requireScope) checks.push({ id: 'scope', ok: !!head[2], text: 'Has a scope' });
      if (head[2] && conv.scopes.length) checks.push({ id: 'scopes', ok: conv.scopes.indexOf(head[2]) >= 0, text: 'Scope "' + head[2] + '" is one of: ' + conv.scopes.join(', ') });
      if (head[3]) checks.push({ id: 'breaking', ok: /^BREAKING[ -]CHANGE: /m.test(body.join('\n')), text: '"!" is explained by a BREAKING CHANGE: footer' });
    }
  }
  if (conv.requireIssue) checks.push({ id: 'issue', ok: new RegExp(conv.issuePattern).test(msg), text: 'References an issue (' + conv.issuePattern + ')' });
  return checks;
}
function wrapBody(text, width) {
  width = width || 72;
  return String(text).split('\n').map(function (line) {
    if (line.length <= width || /^\s*(https?:|```)/.test(line)) return line;
    var indent = (line.match(/^(\s*[-*] |\s*)/) || [''])[0], words = line.slice(indent.length).split(' '), out = [], cur = indent;
    words.forEach(function (w) {
      if (cur.trim() && (cur + w).length > width) { out.push(cur.replace(/\s+$/, '')); cur = ' '.repeat(indent.length); }
      cur += w + ' ';
    });
    out.push(cur.replace(/\s+$/, ''));
    return out.join('\n');
  }).join('\n');
}

/* ---------- pre-commit checks ---------- */
var CHECKS = [
  { id: 'secret', level: 'high', re: /(AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{16,}|\b(password|passwd|secret|api_?key|token)\s*[:=]\s*["'][^"'\s]{6,}["'])/i, text: 'Possible secret or credential' },
  { id: 'conflict', level: 'high', re: /^(<{7}|={7}|>{7})( |$)/, text: 'Merge-conflict marker' },
  { id: 'debug', level: 'med', re: /\b(console\.(log|debug)|debugger;|print\(|pdb\.set_trace|binding\.pry|var_dump|dd\()/, text: 'Debug statement' },
  { id: 'focus', level: 'med', re: /\b(it|describe|test)\.only\(|\bfit\(|\bfdescribe\(/, text: 'Focused test (.only) would skip the rest of the suite' },
  { id: 'todo', level: 'low', re: /\b(TODO|FIXME|HACK|XXX)\b/, text: 'New TODO/FIXME' },
];
function diffWarnings(files) {
  var out = [];
  files.forEach(function (f) {
    added(f).forEach(function (l) {
      CHECKS.forEach(function (c) { if (c.re.test(l.s) && !(c.id === 'debug' && isTest(f.path))) out.push({ id: c.id, level: c.level, text: c.text, file: f.path, line: l.n, code: l.s.trim().slice(0, 120) }); });
    });
    if (f.add > 800 && !isDeps(f.path)) out.push({ id: 'large', level: 'low', text: 'Very large change (' + f.add + ' lines added): consider splitting', file: f.path, line: null, code: '' });
    if (/\.(env|pem|key|p12|pfx)$|(^|\/)\.env(\.|$)/.test(f.path) && f.status !== 'deleted') out.push({ id: 'secretfile', level: 'high', text: 'Committing a secrets file', file: f.path, line: null, code: '' });
  });
  return out;
}

/* ---------- commit splitting ---------- */
/* Group files into suggested atomic commits: tests travel with the code they test; docs, deps and CI get their own commits; code is grouped by top-level area. */
function splitCommits(files) {
  var groups = {}, order = [];
  var put = function (key, f) { if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push(f); };
  var areaOf = function (p) { var s = p.replace(/^(src|lib|app|packages)\//, '').split('/'); return s.length > 1 ? s[0] : '(root)'; };
  var code = files.filter(function (f) { return categoryOf(f.path) === 'code'; });
  var stem = function (p) { return p.split('/').pop().replace(/\.(test|spec)(?=\.)/, '').replace(/^test_/, '').replace(/_test(?=\.)/, '').replace(/\.[^.]+$/, ''); };
  files.forEach(function (f) {
    var cat = categoryOf(f.path);
    if (cat === 'code') put('code:' + areaOf(f.path), f);
    else if (cat === 'test') {
      var match = code.find(function (c) { return stem(c.path) === stem(f.path); });
      put(match ? 'code:' + areaOf(match.path) : 'test', f);
    } else put(cat, f);
  });
  return order.map(function (k) {
    var fs = groups[k], g = guessType(fs);
    return { key: k, files: fs.map(function (f) { return f.path; }), type: g.type, scope: g.scope || (k.indexOf('code:') === 0 && k !== 'code:(root)' ? k.slice(5) : ''), add: fs.reduce(function (a, f) { return a + f.add; }, 0), del: fs.reduce(function (a, f) { return a + f.del; }, 0) };
  });
}

/* ---------- changelog ---------- */
/* Accepts `git log --oneline` or `git log --pretty=format:"%h|%s|%an|%ad"` output (and full `git log` subjects). */
function parseLog(text) {
  var out = [];
  String(text).replace(/\r/g, '').split('\n').forEach(function (line) {
    var l = line.trim();
    if (!l) return;
    var m = l.match(/^([0-9a-f]{7,40})\|(.*?)(?:\|(.*?))?(?:\|(.*))?$/i) || l.match(/^([0-9a-f]{7,40})\s+(.*)$/i);
    if (!m) return;
    var subject = m[2].trim(), c = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
    out.push({ hash: m[1].slice(0, 7), subject: subject, author: m[3] || '', date: m[4] || '', type: c ? c[1].toLowerCase() : 'other', scope: c ? c[2] || '' : '', breaking: !!(c && c[3]) || /BREAKING CHANGE/.test(subject), desc: c ? c[4] : subject });
  });
  return out;
}
function bumpFor(commits) { return commits.some(function (c) { return c.breaking; }) ? 'major' : commits.some(function (c) { return c.type === 'feat'; }) ? 'minor' : commits.length ? 'patch' : 'none'; }
function nextVersion(v, bump) {
  var m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return v;
  var a = +m[1], b = +m[2], c = +m[3];
  if (bump === 'major') return a === 0 ? a + '.' + (b + 1) + '.0' : a + 1 + '.0.0';
  if (bump === 'minor') return a + '.' + (b + 1) + '.0';
  if (bump === 'patch') return a + '.' + b + '.' + (c + 1);
  return a + '.' + b + '.' + c;
}
var SECTION = { breaking: 'Breaking changes', feat: 'Added', fix: 'Fixed', perf: 'Performance', refactor: 'Changed', docs: 'Documentation', revert: 'Reverted' };
function buildChangelog(commits, version, date, opts) {
  opts = opts || {};
  var sections = {}, keys = ['breaking', 'feat', 'fix', 'perf', 'refactor', 'docs', 'revert'];
  commits.forEach(function (c) {
    var k = c.breaking ? 'breaking' : keys.indexOf(c.type) >= 0 ? c.type : opts.includeOther ? 'other' : null;
    if (!k) return;
    (sections[k] = sections[k] || []).push('- ' + (c.scope ? '**' + c.scope + ':** ' : '') + c.desc.charAt(0).toUpperCase() + c.desc.slice(1) + (opts.hashes ? ' (' + c.hash + ')' : ''));
  });
  var out = ['## [' + version + '] - ' + date];
  keys.concat(['other']).forEach(function (k) { if (sections[k]) out.push('', '### ' + (SECTION[k] || 'Other'), sections[k].join('\n')); });
  if (out.length === 1) out.push('', '_No user-facing changes._');
  return out.join('\n') + '\n';
}

/* ---------- config export ---------- */
function commitlintConfig(conv) {
  conv = Object.assign({}, DEFAULT_CONVENTIONS, conv || {});
  var rules = ["    'type-enum': [2, 'always', " + JSON.stringify(conv.types).replace(/"/g, "'").replace(/,/g, ', ') + '],', "    'header-max-length': [2, 'always', " + conv.maxSubject + '],', "    'body-max-line-length': [2, 'always', " + conv.bodyWidth + '],', "    'subject-full-stop': [2, 'never', '.'],"];
  if (conv.requireScope) rules.push("    'scope-empty': [2, 'never'],");
  if (conv.scopes.length) rules.push("    'scope-enum': [2, 'always', " + JSON.stringify(conv.scopes).replace(/"/g, "'").replace(/,/g, ', ') + '],');
  if (conv.requireIssue) rules.push("    'references-empty': [2, 'never'],");
  return "module.exports = {\n  extends: ['@commitlint/config-conventional'],\n  rules: {\n" + rules.join('\n') + '\n  },\n};\n';
}
function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function gitCommitCommand(msg) {
  var lines = String(msg).split('\n'), subj = lines[0], body = lines.slice(1).join('\n').trim();
  return 'git commit -m ' + shellQuote(subj) + (body ? ' -m ' + shellQuote(body) : '');
}
