const MAX_FILE_BYTES = 10 * 1024 * 1024;
const API_VERSION = "2022-11-28";
const ALLOWED_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "pdf", "png", "jpg", "jpeg", "gif", "webp",
  "svg", "zip", "docx", "xlsx", "pptx", "log", "yaml", "yml", "html",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.pathname === "/api/upload" && request.method === "POST") return upload(request, env);
    return cors(Response.json({ error: "Not found" }, { status: 404 }));
  },
};

async function upload(request, env) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  if (!env.UPLOAD_KEY || !env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_BRANCH) {
    return Response.json({ error: "Service is not configured" }, { status: 503 });
  }
  if (!constantTimeEqual(request.headers.get("authorization") || "", `Bearer ${env.UPLOAD_KEY}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_FILE_BYTES + 128 * 1024) return Response.json({ error: "File exceeds the 10 MiB limit" }, { status: 413 });
  let form;
  try { form = await request.formData(); } catch { return Response.json({ error: "Expected multipart form data" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a non-empty file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: "File exceeds the 10 MiB limit" }, { status: 413 });
  const filename = safeFilename(file.name);
  const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(ext)) return Response.json({ error: "This file type is not allowed" }, { status: 415 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const content = btoa(binary);
  const id = crypto.randomUUID();
  const path = `uploads/${id}/${filename}`;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  let githubResponse;
  try {
    githubResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: githubHeaders(env),
      body: JSON.stringify({ message: `Upload ${filename} (${id})`, content, branch: env.GITHUB_BRANCH }),
    });
  } catch {
    return Response.json({ error: "Could not reach GitHub" }, { status: 502 });
  }
  if (!githubResponse.ok) {
    const status = githubResponse.status;
    return Response.json({ error: status === 401 || status === 403 ? "GitHub rejected the configured token or repository access" : status === 409 ? "GitHub branch changed; retry the upload" : "GitHub could not store this file" }, { status: status === 422 ? 413 : 502 });
  }
  const directUrl = `https://raw.githubusercontent.com/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/${encodeURIComponent(env.GITHUB_BRANCH)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return Response.json({ name: filename, size: file.size, url: directUrl }, { status: 201 });
}

function githubHeaders(env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "content-type": "application/json",
    "user-agent": "file-drop-worker",
  };
}

function safeFilename(name) {
  const normalized = name.normalize("NFKC").replace(/[\\/\0\r\n]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim().replace(/^\.+/, "").slice(0, 120);
  return normalized || "upload.bin";
}

function constantTimeEqual(actual, expected) {
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

const PAGE = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>File Drop</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#20242a;font:16px system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}.card{background:white;width:min(100%,520px);padding:32px;border:1px solid #e1e4e8;border-radius:16px;box-shadow:0 8px 30px #20242a0d}h1{margin:0 0 8px;font-size:28px}p{color:#5b6470;line-height:1.5}.field{display:block;margin:20px 0 8px;font-weight:600}input[type=password],input[type=file]{width:100%;padding:12px;border:1px solid #c9ced6;border-radius:8px;background:white}button{margin-top:20px;width:100%;border:0;border-radius:8px;background:#1769e0;color:white;padding:13px;font-weight:700;font-size:16px;cursor:pointer}button:disabled{opacity:.6;cursor:wait}#result{margin-top:20px;overflow-wrap:anywhere}a{color:#145ac0}small{color:#697381}</style>
<main class="card"><h1>File Drop</h1><p>Upload a file and get a direct link. Links work for anyone who can access the public GitHub repository.</p>
<form id="form"><label class="field" for="key">Upload key</label><input id="key" type="password" autocomplete="current-password" required>
<label class="field" for="file">File</label><input id="file" type="file" required><small>Maximum 10 MiB. Files are stored in the configured GitHub repository.</small><button id="submit">Upload file</button></form><div id="result" aria-live="polite"></div></main>
<script>const form=document.querySelector('#form'),button=document.querySelector('#submit'),result=document.querySelector('#result');form.addEventListener('submit',async e=>{e.preventDefault();const file=document.querySelector('#file').files[0];if(!file)return;button.disabled=true;result.textContent='Uploading…';try{const data=new FormData();data.append('file',file);const res=await fetch('/api/upload',{method:'POST',headers:{authorization:'Bearer '+document.querySelector('#key').value},body:data});const body=await res.json();if(!res.ok)throw Error(body.error||'Upload failed');result.replaceChildren(document.createTextNode('Uploaded. Direct link: '));const a=document.createElement('a');a.href=body.url;a.textContent=body.url;a.target='_blank';a.rel='noopener';result.append(a)}catch(err){result.textContent=err.message}finally{button.disabled=false}});</script></html>`;
