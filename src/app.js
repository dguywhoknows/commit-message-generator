const { $, $$, h, esc, busy, toast, md, store, download } = Kit;
let files = [];
let conv = Object.assign({}, DEFAULT_CONVENTIONS, store.get('conventions', {}));
let saved = store.get('history', []);
const sum = (fs, k) => fs.reduce((a, f) => a + f[k], 0);

/* ================= compose: diff ================= */
function renderDiff() {
  const box = $('#files');
  box.innerHTML = '';
  $('#parseInfo').innerHTML = files.length ? `${files.length} file${files.length > 1 ? 's' : ''} · <span class="add">+${sum(files, 'add')}</span> <span class="del">−${sum(files, 'del')}</span>` : 'No diff found.';
  files.forEach((f) => {
    const tot = f.add + f.del || 1, blocks = 5, a = Math.round((f.add / tot) * blocks);
    const bar = h('span', { class: 'mini-bar' }, Array.from({ length: blocks }, (_, i) => h('i', { class: i < a ? 'a' : i < Math.round(((f.add + f.del) / tot) * blocks) ? 'd' : '' })));
    const tags = [f.status !== 'modified' ? h('span', { class: 'tag ' + (f.status === 'deleted' ? 'bad' : 'good') }, f.status) : null, isTest(f.path) ? h('span', { class: 'tag' }, 'test') : null, isDeps(f.path) ? h('span', { class: 'tag warn' }, 'deps') : null, f.binary ? h('span', { class: 'tag' }, 'binary') : null];
    const body = h('div', { class: 'hunk' }, f.hunks.map((hk) => [h('div', { class: 'hh' }, hk.header), hk.lines.slice(0, 400).map((l) => h('div', { class: l.t }, (l.t === 'a' ? '+' : l.t === 'd' ? '-' : ' ') + l.s))]));
    box.append(h('details', { class: 'file', open: files.length <= 3 }, h('summary', {}, h('span', { class: 'path', title: f.path }, f.status === 'renamed' ? `${f.from} → ${f.path}` : f.path), ...tags, h('span', { class: 'add' }, '+' + f.add), h('span', { class: 'del' }, '−' + f.del), bar), body));
  });
  const g = guessType(files);
  $('#guess').textContent = files.length ? `heuristic: ${g.type}${g.scope ? `(${g.scope})` : ''}` : '';
  ['#gen', '#prBtn', '#revBtn'].forEach((s) => ($(s).disabled = !files.length));
  renderChecks();
  renderSplit();
}
function renderChecks() {
  const w = diffWarnings(files), box = $('#checks');
  box.innerHTML = '';
  const high = w.filter((x) => x.level === 'high').length;
  $('#checkSummary').textContent = files.length ? (w.length ? `${w.length} finding${w.length === 1 ? '' : 's'}${high ? `, ${high} blocking` : ''}` : 'all clear') : '';
  if (!w.length) { box.append(h('div', { class: 'small muted' }, files.length ? 'No secrets, debug statements, conflict markers or focused tests in the added lines.' : 'Analyze a diff first.')); return; }
  w.forEach((x) => box.append(h('div', { class: 'warn-row' }, h('span', { class: 'lvl ' + x.level }, x.level), h('div', {}, h('div', {}, x.text, ' ', h('span', { class: 'mono small muted' }, `${x.file}${x.line ? ':' + x.line : ''}`)), x.code ? h('code', {}, x.code) : null))));
}

/* ================= compose: message ================= */
function lint() {
  const msg = $('#msg').value;
  if (!msg.trim()) { $('#lint').innerHTML = ''; return; }
  $('#lint').innerHTML = lintMessage(msg, $('#style').value, conv).map((c) => `<div class="${c.ok ? 'ok' : 'no'}">${esc(c.text)}</div>`).join('');
}
$('#msg').addEventListener('input', lint);
$('#style').onchange = lint;

function diffForAI(fs = files, limit = 14000) {
  let budget = limit, out = '';
  const sorted = [...fs].sort((a, b) => (isDeps(a.path) || isDoc(a.path) ? 1 : 0) - (isDeps(b.path) || isDoc(b.path) ? 1 : 0));
  for (const f of sorted) {
    const head = `### ${f.status} ${f.status === 'renamed' ? f.from + ' -> ' : ''}${f.path} (+${f.add} -${f.del})\n`;
    if (isDeps(f.path) && /lock/.test(f.path)) { out += head + '(lockfile changes omitted)\n'; continue; }
    let chunk = f.hunks.map((hk) => hk.header + '\n' + hk.lines.map((l) => (l.t === 'a' ? '+' : l.t === 'd' ? '-' : ' ') + l.s).join('\n')).join('\n');
    if (chunk.length > budget) chunk = chunk.slice(0, Math.max(0, budget)) + '\n…(truncated)';
    budget -= chunk.length;
    out += head + chunk + '\n';
  }
  return out;
}
const STYLE_RULES = {
  conventional: () => `Conventional Commits 1.0: "type(scope): description". Allowed types: ${conv.types.join(', ')}.${conv.scopes.length ? ' Allowed scopes: ' + conv.scopes.join(', ') + '.' : ''}${conv.requireScope ? ' A scope is required.' : ''} Add "!" and a "BREAKING CHANGE:" footer if the public API changes.`,
  plain: () => 'Plain imperative subject line ("Add …", "Fix …"), in the style of the Git project.',
};
function localMessage(fs, style, hint) {
  const g = guessType(fs), paths = fs.map((f) => f.path);
  const verb = { feat: 'add', fix: 'fix', docs: 'document', test: 'cover', ci: 'update', build: 'update', refactor: 'restructure', perf: 'speed up', style: 'reformat', chore: 'update' }[g.type];
  const names = paths.map((p) => p.split('/').pop().replace(/\.[^.]+$/, '')).filter((n, i, a) => a.indexOf(n) === i);
  const what = g.type === 'build' ? 'dependencies' : g.type === 'ci' ? 'CI workflow' : names.slice(0, 2).join(' and ') + (names.length > 2 ? ` (+${names.length - 2} more)` : '');
  let subj = `${verb} ${what}`;
  if (fs === files && files.some((f) => /retry/.test(f.path))) subj = 'retry failed uploads with exponential backoff';
  const head = style === 'conventional' ? `${g.type}${g.scope ? `(${g.scope})` : ''}: ${subj}` : subj[0].toUpperCase() + subj.slice(1);
  const bullets = fs.slice(0, 6).map((f) => `- ${f.status === 'added' ? 'add' : f.status === 'deleted' ? 'remove' : f.status === 'renamed' ? 'rename' : 'update'} ${f.path} (+${f.add}/-${f.del})`);
  return wrapBody(`${head}\n\n${hint ? hint.trim() + '\n\n' : ''}${bullets.join('\n')}`, conv.bodyWidth);
}
async function writeFor(fs, hint) {
  const style = $('#style').value, g = guessType(fs);
  const text = await AI.chat([
    { role: 'system', content: `You write excellent git commit messages. ${STYLE_RULES[style]()}\nSubject ≤ ${conv.maxSubject} chars, imperative mood, no period. Then a blank line and a body wrapped at ${conv.bodyWidth} columns explaining WHAT changed and WHY (bullets ok). Output ONLY the commit message.` },
    { role: 'user', content: `Heuristic guess: ${g.type}${g.scope ? `(${g.scope})` : ''}\nAuthor context: ${hint || '(none)'}\n\nDiff:\n${diffForAI(fs)}` },
  ], { temperature: 0.3, maxTokens: 500, demo: () => localMessage(fs, style, hint) });
  return text.replace(/^```\w*\n?|```$/g, '').trim();
}
$('#gen').onclick = (e) => busy(e.currentTarget, async () => { $('#msg').value = await writeFor(files, $('#hint').value); lint(); });
$('#wrap').onclick = () => { const [s, ...rest] = $('#msg').value.split('\n'); $('#msg').value = [s, wrapBody(rest.join('\n'), conv.bodyWidth)].join('\n'); lint(); };
$('#copyMsg').onclick = () => navigator.clipboard.writeText($('#msg').value).then(() => toast('Copied'));
$('#copyCmd').onclick = () => navigator.clipboard.writeText(gitCommitCommand($('#msg').value)).then(() => toast('Copied git command'));
$('#saveMsg').onclick = () => {
  const msg = $('#msg').value.trim();
  if (!msg) return toast('Nothing to save', 'err');
  saved.unshift({ id: Date.now(), t: Date.now(), msg, files: files.map((f) => f.path), add: sum(files, 'add'), del: sum(files, 'del') });
  saved = saved.slice(0, 200);
  store.set('history', saved);
  renderHistory();
  toast('Saved');
};

async function prDesc() {
  const text = await AI.chat([
    { role: 'system', content: 'Write a pull request description in GitHub Markdown with sections: ## Summary (2-3 sentences), ## Changes (bullets grouped by area), ## How to test (numbered steps), ## Risks & rollout (bullets), and ## Checklist (task list). Be concrete and grounded in the diff. No filler.' },
    { role: 'user', content: `Context: ${$('#hint').value || '(none)'}\nCommit message draft:\n${$('#msg').value}\n\nDiff:\n${diffForAI()}` },
  ], { temperature: 0.3, maxTokens: 1200, demo: () => {
    const groups = splitCommits(files), w = diffWarnings(files);
    return `## Summary\n${$('#msg').value.split('\n')[0] || 'Update ' + files.length + ' files'}.\n\n## Changes\n${groups.map((g) => `- **${g.scope || g.key.replace('code:', '')}:** ${g.files.join(', ')} (+${g.add}/-${g.del})`).join('\n')}\n\n## How to test\n1. Check out the branch and install dependencies\n2. Run the test suite\n3. Exercise the changed flow manually\n\n## Risks & rollout\n${w.length ? w.slice(0, 3).map((x) => `- ${x.text} in \`${x.file}\``).join('\n') : '- No pre-commit findings'}\n\n## Checklist\n- [${files.some((f) => isTest(f.path)) ? 'x' : ' '}] Tests added or updated\n- [${files.some((f) => isDoc(f.path)) ? 'x' : ' '}] Docs updated`;
  } });
  $('#pr').innerHTML = md(text);
}
async function review() {
  const firstAdd = files[0]?.hunks[0]?.lines.find((l) => l.t === 'a')?.n || 1;
  const out = await AI.chat([
    { role: 'system', content: 'You are a meticulous senior code reviewer. Review ONLY the changed lines (+/-) in the diff. Find real issues: bugs, edge cases, security, error handling, performance, naming, missing tests. Skip nitpicks unless nothing else. Return JSON {"verdict":"approve|comment|request changes","summary":"one sentence","comments":[{"file":"path","line":number,"severity":"high|med|low","comment":"...","suggestion":"optional code"}]}.' },
    { role: 'user', content: diffForAI() },
  ], { json: true, temperature: 0.2, maxTokens: 1500, demo: () => ({ verdict: diffWarnings(files).some((x) => x.level === 'high') ? 'request changes' : 'comment', summary: 'Reasonable change. Notes from the pre-commit checks plus one edge case.', comments: [...diffWarnings(files).map((x) => ({ file: x.file, line: x.line || 1, severity: x.level, comment: x.text + (x.code ? `: \`${x.code}\`` : '') })), { file: files[0]?.path || 'src/upload/retry.js', line: firstAdd, severity: 'med', comment: 'Retrying on every error includes 4xx responses, which will never succeed. Only retry network errors, 5xx and 429.', suggestion: 'if (err.status && err.status < 500 && err.status !== 429) throw err;' }] }) });
  const v = String(out.verdict || '');
  $('#review').innerHTML = `<div class="row" style="margin-bottom:10px"><span class="tag ${/request/.test(v) ? 'bad' : /approve/.test(v) ? 'good' : 'warn'}">${esc(v)}</span><span>${esc(out.summary || '')}</span></div>` + (out.comments || []).map((c) => `<div class="rv ${esc(c.severity)}"><div class="loc">${esc(c.file)}:${esc(c.line)} · ${esc(c.severity)}</div><div>${esc(c.comment)}</div>${c.suggestion ? `<pre>${esc(c.suggestion)}</pre>` : ''}</div>`).join('');
}
$('#prBtn').onclick = (e) => busy(e.currentTarget, prDesc);
$('#revBtn').onclick = (e) => busy(e.currentTarget, review);
$$('.tabs button').forEach((b) => (b.onclick = () => { $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); ['pr', 'review'].forEach((k) => $('#t-' + k).classList.toggle('hidden', k !== b.dataset.t)); }));
$('#parse').onclick = () => { files = parseDiff($('#diff').value); renderDiff(); };

/* ================= split ================= */
let splitMsgs = {};
function renderSplit() {
  const groups = splitCommits(files), box = $('#splitList');
  box.innerHTML = '';
  if (!groups.length) box.append(h('div', { class: 'card empty' }, 'Analyze a diff on the Compose page first.'));
  else if (groups.length === 1) box.append(h('div', { class: 'card small muted' }, 'This diff is already a single focused change.'));
  groups.forEach((g, i) => {
    const ta = h('textarea', { class: 'mono', 'aria-label': 'Commit message', oninput: (e) => { splitMsgs[g.key] = e.target.value; renderScript(groups); } });
    ta.value = splitMsgs[g.key] || `${g.type}${g.scope ? `(${g.scope})` : ''}: `;
    box.append(h('div', { class: 'card stack split-card' },
      h('div', { class: 'row between' }, h('b', {}, `Commit ${i + 1}`), h('div', { class: 'row' }, h('span', { class: 'tag' }, g.type), h('span', { class: 'add' }, '+' + g.add), h('span', { class: 'del' }, '−' + g.del))),
      h('div', { class: 'split-files' }, g.files.join('  ')),
      ta,
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: (e) => busy(e.currentTarget, async () => { ta.value = splitMsgs[g.key] = await writeFor(files.filter((f) => g.files.includes(f.path)), ''); renderScript(groups); }) }, 'Write message'))));
  });
  renderScript(groups);
}
function renderScript(groups) {
  $('#splitScript').textContent = groups.length ? groups.map((g) => `git add ${g.files.map(shellQuote).join(' ')}\n${gitCommitCommand(splitMsgs[g.key] || `${g.type}${g.scope ? `(${g.scope})` : ''}: describe this change`)}`).join('\n\n') : '';
}
$('#splitAll').onclick = (e) => busy(e.currentTarget, async () => {
  for (const g of splitCommits(files)) splitMsgs[g.key] = await writeFor(files.filter((f) => g.files.includes(f.path)), '');
  renderSplit();
});
$('#copyScript').onclick = () => navigator.clipboard.writeText($('#splitScript').textContent).then(() => toast('Copied'));

/* ================= changelog ================= */
function renderChangelog() {
  const commits = parseLog($('#log').value), auto = bumpFor(commits);
  const bump = $('#bump').value === 'auto' ? auto : $('#bump').value, next = nextVersion($('#curVer').value.trim(), bump);
  const by = (t) => commits.filter((c) => c.type === t).length;
  $('#logStats').innerHTML = [['Commits', commits.length], ['Features', by('feat')], ['Fixes', by('fix')], ['Breaking', commits.filter((c) => c.breaking).length], ['Next version', `${next} <span class="small muted">(${bump})</span>`]]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('#changelog').textContent = buildChangelog(commits, next, $('#relDate').value || localDate(), { hashes: $('#optHash').checked, includeOther: $('#optOther').checked });
}
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
['#log', '#curVer', '#relDate'].forEach((s) => $(s).addEventListener('input', renderChangelog));
['#bump', '#optHash', '#optOther'].forEach((s) => ($(s).onchange = renderChangelog));
$('#copyLog').onclick = () => navigator.clipboard.writeText($('#changelog').textContent).then(() => toast('Copied'));
$('#dlLog').onclick = () => download('CHANGELOG-entry.md', $('#changelog').textContent, 'text/markdown');
$('#notesBtn').onclick = (e) => busy(e.currentTarget, async () => {
  const commits = parseLog($('#log').value);
  if (!commits.length) return toast('Paste a git log first', 'err');
  const text = await AI.chat([
    { role: 'system', content: 'Turn commit subjects into release notes for end users. Group into "New", "Improved" and "Fixed", explain benefits in plain language, drop internal chores, refactors and test changes, and call out anything breaking with what users need to do. Markdown, max 200 words.' },
    { role: 'user', content: commits.map((c) => c.subject).join('\n') },
  ], { temperature: 0.4, demo: () => {
    const pick = (t) => commits.filter((c) => c.type === t && !c.breaking).map((c) => `- ${c.desc[0].toUpperCase() + c.desc.slice(1)}`);
    const br = commits.filter((c) => c.breaking);
    return [br.length ? `**Heads up:** ${br.map((c) => c.desc).join('; ')}. Check your integration before upgrading.` : '', pick('feat').length ? '### New\n' + pick('feat').join('\n') : '', pick('perf').length ? '### Improved\n' + pick('perf').join('\n') : '', pick('fix').length ? '### Fixed\n' + pick('fix').join('\n') : ''].filter(Boolean).join('\n\n');
  } });
  $('#notes').innerHTML = md(text);
});

/* ================= conventions ================= */
const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
function fillConventions() {
  $('#cTypes').value = conv.types.join(', ');
  $('#cScopes').value = conv.scopes.join(', ');
  $('#cMax').value = conv.maxSubject;
  $('#cWidth').value = conv.bodyWidth;
  $('#cScopeReq').checked = conv.requireScope;
  $('#cIssueReq').checked = conv.requireIssue;
  $('#cIssue').value = conv.issuePattern;
  renderConventionFiles();
}
function readConventions() {
  let pattern = $('#cIssue').value.trim() || DEFAULT_CONVENTIONS.issuePattern;
  try { new RegExp(pattern); } catch { pattern = conv.issuePattern; toast('Issue pattern is not a valid regex', 'err'); }
  conv = { types: splitList($('#cTypes').value).length ? splitList($('#cTypes').value) : DEFAULT_CONVENTIONS.types, scopes: splitList($('#cScopes').value), maxSubject: +$('#cMax').value || 72, bodyWidth: +$('#cWidth').value || 72, requireScope: $('#cScopeReq').checked, requireIssue: $('#cIssueReq').checked, issuePattern: pattern };
  store.set('conventions', conv);
  renderConventionFiles();
  lint();
}
function gitTemplate() {
  return `# <type>(<scope>): <subject>   (max ${conv.maxSubject} chars, imperative, no period)\n#\n# Types: ${conv.types.join(', ')}\n${conv.scopes.length ? `# Scopes: ${conv.scopes.join(', ')}\n` : ''}#\n# Body: what changed and why, wrapped at ${conv.bodyWidth} columns.\n#\n# Footer: BREAKING CHANGE: <what breaks and how to migrate>${conv.requireIssue ? '\n#         Refs: #123' : ''}\n`;
}
function renderConventionFiles() { $('#lintCfg').textContent = commitlintConfig(conv); $('#gitTpl').textContent = gitTemplate(); }
['#cTypes', '#cScopes', '#cMax', '#cWidth', '#cIssue'].forEach((s) => $(s).addEventListener('change', readConventions));
['#cScopeReq', '#cIssueReq'].forEach((s) => ($(s).onchange = readConventions));
$('#dlLint').onclick = () => download('commitlint.config.js', commitlintConfig(conv), 'text/javascript');
$('#dlTpl').onclick = () => download('.gitmessage', gitTemplate(), 'text/plain');

/* ================= history ================= */
function renderHistory() {
  const q = $('#histSearch').value.trim().toLowerCase(), list = saved.filter((x) => !q || x.msg.toLowerCase().includes(q) || x.files.some((f) => f.toLowerCase().includes(q)));
  $('#histSummary').textContent = saved.length ? `${saved.length} saved message${saved.length === 1 ? '' : 's'}` : 'Messages you save from the Compose page appear here.';
  const box = $('#histList');
  box.innerHTML = '';
  if (!list.length) box.append(h('div', { class: 'card empty' }, saved.length ? 'Nothing matches.' : 'No saved messages yet.'));
  list.forEach((x) => box.append(h('div', { class: 'card hist-item' },
    h('div', { class: 'row between' }, h('span', { class: 'small muted' }, `${new Date(x.t).toLocaleString()} · ${x.files.length} files · +${x.add}/−${x.del}`),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => navigator.clipboard.writeText(x.msg).then(() => toast('Copied')) }, 'Copy'), h('button', { class: 'btn ghost sm', onclick: () => { $('#msg').value = x.msg; lint(); Router.go('compose'); } }, 'Edit'), h('button', { class: 'btn ghost sm', 'aria-label': 'Delete', onclick: () => { saved = saved.filter((y) => y !== x); store.set('history', saved); renderHistory(); } }, '×'))),
    h('pre', { class: 'mono' }, x.msg))));
}
$('#histSearch').oninput = renderHistory;

/* ================= boot ================= */
$('#diff').value = SAMPLE_DIFF;
$('#log').value = SAMPLE_LOG;
$('#parse').click();
fillConventions();
renderChangelog();
renderHistory();
