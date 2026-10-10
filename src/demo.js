/* demo.js — a sample staged diff and a sample git log used on first load. */
var SAMPLE_DIFF = `diff --git a/src/upload/retry.js b/src/upload/retry.js
new file mode 100644
index 0000000..3b18bc1
--- /dev/null
+++ b/src/upload/retry.js
@@ -0,0 +1,18 @@
+const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
+
+export async function withRetry(fn, { attempts = 4, baseMs = 300, onAttempt } = {}) {
+  let lastErr;
+  for (let i = 1; i <= attempts; i++) {
+    try {
+      onAttempt?.(i);
+      return await fn();
+    } catch (err) {
+      lastErr = err;
+      if (i === attempts) break;
+      const jitter = Math.random() * baseMs;
+      await sleep(baseMs * 2 ** (i - 1) + jitter);
+    }
+  }
+  // TODO: only retry network errors and 5xx
+  throw lastErr;
+}
+
diff --git a/src/upload/uploadFile.js b/src/upload/uploadFile.js
index 9c1d2e4..a7f0b55 100644
--- a/src/upload/uploadFile.js
+++ b/src/upload/uploadFile.js
@@ -1,14 +1,19 @@
 import { api } from '../api.js';
+import { withRetry } from './retry.js';

-export async function uploadFile(file, onProgress) {
+export async function uploadFile(file, onProgress, onAttempt) {
   const form = new FormData();
   form.append('file', file);
-  const res = await api.post('/uploads', form, { onUploadProgress: onProgress });
-  if (!res.ok) {
-    throw new Error('Upload failed');
-  }
-  return res.data;
+  return withRetry(async () => {
+    const res = await api.post('/uploads', form, { onUploadProgress: onProgress });
+    if (!res.ok) {
+      const err = new Error(\`Upload failed: \${res.status}\`);
+      err.status = res.status;
+      throw err;
+    }
+    return res.data;
+  }, { onAttempt });
 }
diff --git a/src/upload/retry.test.js b/src/upload/retry.test.js
new file mode 100644
--- /dev/null
+++ b/src/upload/retry.test.js
@@ -0,0 +1,12 @@
+import { withRetry } from './retry.js';
+
+test('retries until success', async () => {
+  let n = 0;
+  const out = await withRetry(async () => { if (++n < 3) throw new Error('x'); return 'ok'; }, { baseMs: 1 });
+  expect(out).toBe('ok');
+  expect(n).toBe(3);
+});
+
+test('gives up after the last attempt', async () => {
+  await expect(withRetry(async () => { throw new Error('nope'); }, { attempts: 2, baseMs: 1 })).rejects.toThrow('nope');
+});
`;

var SAMPLE_LOG = `9c41d2e|feat(upload): retry failed uploads with exponential backoff|Sam Lee|2026-10-06
7b2a913|fix(auth): refresh the token before it expires instead of after|Priya Raman|2026-10-05
51f0ac7|docs: document the retry options in the README|Sam Lee|2026-10-05
e08c6b4|chore(deps): bump vite from 5.2.0 to 5.4.1|dependabot|2026-10-04
3d9e2f0|feat(search)!: return paginated results from /search|Alex Kim|2026-10-03
a6c3b18|perf(list): virtualize the file list for large folders|Alex Kim|2026-10-02
f1e7d55|refactor(api): extract the request client into its own module|Priya Raman|2026-10-01
0bb2c41|test(upload): cover give-up behaviour|Sam Lee|2026-09-30`;
