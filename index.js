// dsh-plugin-skills-manager — 服务端
// 路由（注册于 DSH webServer）：
//   GET  /api/skills-manager/index                     → 已安装技能索引 JSON（含 description_zh）
//   GET  /api/skills-manager/dashboard                 → 管理台 HTML
//   GET  /api/skills-manager/market/sources            → 技能市场源列表
//   GET  /api/skills-manager/market/list?source&path&q → 浏览市场源目录（GitHub）
//   GET  /api/skills-manager/market/search?source&q    → 搜索（ClawdHub）
//   POST /api/skills-manager/market/install            → 安装技能到 ~/.dsh/skills
//   POST /api/skills-manager/uninstall                 → 卸载技能（默认移入回收目录）
import { readFile, readdir, stat, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-plugin-skills-manager";
export const inject = ["webServer"];

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const NS = "dsh-plugin-skills-manager";
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function dshHome() {
  const env = process.env.DSH_HOME;
  return env !== undefined && env !== "" ? resolvePath(env) : join(homedir(), ".dsh");
}
function skillsDir() { return join(dshHome(), "skills"); }
function provenanceFile() { return join(skillsDir(), ".skills-manager", "provenance.json"); }

// ---------- 分类（与工作区 build_index.py 保持一致） ----------
const CATEGORY_MAP = {
  "开发工作流": ["using-superpowers","brainstorming","writing-plans","executing-plans","subagent-driven-development","dispatching-parallel-agents","test-driven-development","systematic-debugging","requesting-code-review","receiving-code-review","verification-before-completion","finishing-a-development-branch","using-git-worktrees","writing-skills","diagnosing-superpowers","ontoly-software-graph"],
  "视频与数字人": ["video-creation-suite","video-creation-pro","video-creation-collaborator","product-video-creator","three-body-video-creator","video-recreation","video-frame-extractor","video-transcript-downloader","remotion-video-enhancer","infinitetalk","infinitetalk-shopping-avatar","dream-video-prompt-generator","historical-science-video-prod","pet-commerce-creator","agentkit-multimedia-shopping","digital-avatar-shopping-video"],
  "语音与音频": ["qwen3-asr-assistant","qwen3-tts-local","tts-voice-synthesis","bedtime-story"],
  "内容写作": ["baoyu-url-to-markdown","baoyu-format-markdown","content-research-writer","article-illustrator","historical-interview-scripts","poetry-music-visual","viral-video-copywriting"],
  "发布分发": ["baoyu-post-to-wechat","baoyu-post-to-x","x-article-publisher","wechatsync-publisher","wechat-hotspot-publisher","content-creation-publisher","intelligent-content-system","moltbook"],
  "电商与营销": ["ecommerce-copywriter","ecommerce-full-pipeline","ecommerce-video-marketing","product-marketing-copywriter","jd-price-collector","xiaohongshu-makeup","atutun-xhs-cover"],
  "文档法律金融": ["antinet-doc-parse","antinet-four-color-cards","antinet-provenance","antinet-security-scan","law-to-markdown","contract-review","pdf-processing-pro","stock-analysis"],
  "设计与图像": ["frontend-design","icon-generator","gpt-image-2-prompt-engine","pop-up-book-illustration","web-design-analyzer","archify","nanobanana-ppt-visualizer"],
  "PPT与演示": ["ppt-generator","pptx-generator","ppt-roadshow-generator","data-storytelling"],
  "知识管理": ["obsidian-markdown","obsidian-bases","obsidian-skills-integrated","json-canvas"],
  "浏览器自动化": ["ego-browser","chrome-automation"],
  "工具与效率": ["agent-team","multi-agent-meeting","product-manager-toolkit","tailored-resume-generator","paper-analysis-assistant","media-processor","ass2srt","web-to-app"],
};
const CAT_OF = {};
for (const [cat, names] of Object.entries(CATEGORY_MAP)) for (const n of names) CAT_OF[n] = cat;
const KEYWORD_FALLBACK = [
  ["视频与数字人", /video|infinitetalk|avatar|数字人|分镜/i],
  ["语音与音频", /tts|asr|语音|配音|audio/i],
  ["电商与营销", /ecommerce|电商|带货|营销|copywriter|商品/i],
  ["发布分发", /publish|post-to|发布|分发/i],
  ["文档法律金融", /pdf|法律|contract|法条|finance|stock/i],
  ["设计与图像", /design|icon|image|illustrat|生图/i],
  ["PPT与演示", /ppt|演示|slide/i],
  ["知识管理", /obsidian|canvas|笔记|知识库/i],
  ["浏览器自动化", /browser|浏览器/i],
  ["开发工作流", /code|debug|review|git|plan/i],
];
function classify(name2, desc) {
  if (CAT_OF[name2]) return CAT_OF[name2];
  const text = `${name2} ${desc}`;
  for (const [cat, re] of KEYWORD_FALLBACK) if (re.test(text)) return cat;
  return "工具与效率";
}

// ---------- frontmatter 解析 ----------
function parseFrontmatter(text) {
  const fm = { metadata: {}, dependency: {} };
  const lines = text.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") return fm;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
  if (end < 0) return fm;
  let section = null;
  const descBuf = [];
  for (const raw of lines.slice(1, end)) {
    const line = raw.replace(/\s+$/, "");
    const stripped = line.trim();
    if (!stripped) continue;
    const indent = line.length - line.replace(/^\s+/, "").length;
    const m = stripped.match(/^([A-Za-z_-]+):\s*(.*)$/);
    const key = m ? m[1] : null;
    const val = m ? m[2].trim() : "";
    if (indent === 0) {
      section = null;
      if (key === "name") fm.name = val.replace(/^['"]|['"]$/g, "");
      else if (key === "license") fm.license = val.replace(/^['"]|['"]$/g, "");
      else if (key === "description") { descBuf.push(val.replace(/^['"]|['"]$/g, "")); section = "description"; }
      else if (key === "metadata") section = "metadata";
      else if (key === "dependency" || key === "dependencies") section = "dependency";
      continue;
    }
    if (section === "description") {
      if (descBuf.length && !/^[A-Za-z_-]+:/.test(stripped)) descBuf[descBuf.length - 1] += " " + stripped.replace(/^[>|][+-]?\s*/, "");
    } else if (section === "metadata") {
      if (["version","author","date","license","based_on"].includes(key)) fm.metadata[key] = val.replace(/^['"]|['"]$/g, "");
    } else if (section === "dependency") {
      if (["python","node","system","npm"].includes(key)) { section = `dep-${key}`; fm.dependency[key] = fm.dependency[key] || []; }
      else if (stripped.startsWith("- ") && section && section.startsWith("dep-")) {
        const lang = section.slice(4);
        (fm.dependency[lang] = fm.dependency[lang] || []).push(stripped.slice(2).trim());
      }
    }
  }
  if (descBuf.length) fm.description = descBuf.filter(Boolean).join(" ").trim();
  return fm;
}

function firstParagraph(body) {
  for (const para of body.split(/\n\s*\n/)) {
    const p = para.trim();
    if (p && !p.startsWith("#") && !p.startsWith("---")) return p.replace(/\s+/g, " ").slice(0, 300);
  }
  return "";
}

async function dirStats(folder) {
  let files = 0, size = 0;
  const top = [];
  let entries = [];
  try { entries = await readdir(folder, { withFileTypes: true }); } catch { return { files, size, top }; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    top.push({ name: e.name, dir: e.isDirectory() });
    try {
      if (e.isDirectory()) {
        const subs = await readdir(join(folder, e.name), { withFileTypes: true });
        for (const s of subs) if (s.isFile()) { files++; size += (await stat(join(folder, e.name, s.name))).size; }
      } else if (e.isFile()) { files++; size += (await stat(join(folder, e.name))).size; }
    } catch { /* ignore */ }
  }
  return { files, size, top };
}

async function loadTranslations() {
  try {
    const parsed = JSON.parse(await readFile(join(PLUGIN_DIR, "translations", "zh.json"), "utf8"));
    return parsed.translations || {};
  } catch { return {}; }
}

async function loadProvenance() {
  try { return JSON.parse(await readFile(provenanceFile(), "utf8")); } catch { return {}; }
}
async function saveProvenance(p) {
  await mkdir(dirname(provenanceFile()), { recursive: true });
  await writeFile(provenanceFile(), JSON.stringify(p, null, 1), "utf8");
}

export async function scanSkills() {
  const sd = skillsDir();
  const zh = await loadTranslations();
  const prov = await loadProvenance();
  const skills = [];
  let folders = [];
  try { folders = (await readdir(sd, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { /* 目录不存在 */ }
  for (const folder of folders) {
    const skillMd = join(sd, folder, "SKILL.md");
    let text;
    try { text = await readFile(skillMd, "utf8"); } catch { continue; }
    const fm = parseFrontmatter(text);
    const description = fm.description || firstParagraph(text.split("---").slice(2).join("---"));
    const stats = await dirStats(join(sd, folder));
    let mtime = "";
    try { mtime = new Date((await stat(skillMd)).mtime).toISOString().slice(0, 10); } catch { /* ignore */ }
    skills.push({
      name: fm.name || folder,
      folder,
      description,
      description_zh: zh[folder] || "",
      category: classify(folder, description || ""),
      version: fm.metadata.version || "",
      author: fm.metadata.author || "",
      date: fm.metadata.date || "",
      license: fm.license || "",
      dependency: fm.dependency || {},
      path: join(sd, folder),
      files: stats.files,
      size: stats.size,
      top: stats.top,
      mtime,
      origin: prov[folder] || null,
    });
  }
  return { built: new Date().toISOString().slice(0, 16).replace("T", " "), skillsDir: sd, total: skills.length, skills };
}

// ---------- 技能市场 ----------
const GH_API = "https://api.github.com";
const MARKET_SOURCES = [
  { id: "anthropics", name: "Anthropic 官方技能库", type: "github", repo: "anthropics/skills", rootPath: "skills", desc: "Anthropic 官方维护的高质量技能（文档处理/设计/开发等）" },
  { id: "clawdhub", name: "ClawdHub 社区市场", type: "clawdhub", api: "https://clawdhub.com", desc: "OpenClaw 生态社区技能市场，数千个技能可搜索安装" },
  { id: "github", name: "任意 GitHub 仓库", type: "github-custom", desc: "输入 owner/repo[/子路径]，安装任何含 SKILL.md 的仓库目录" },
];

function ghHeaders() {
  const h = { "User-Agent": "dsh-plugin-skills-manager", "Accept": "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: ghHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// 树缓存：避免 GitHub 匿名限流（60 次/小时）。key = repo@branch → { tree, ts }
const treeCache = new Map();
const TREE_TTL_MS = 10 * 60 * 1000;

async function getRepoTree(repo, ref) {
  const key = `${repo}@${ref}`;
  const hit = treeCache.get(key);
  if (hit && Date.now() - hit.ts < TREE_TTL_MS) return hit.tree;
  const meta = await fetchJson(`${GH_API}/repos/${repo}`);
  const branch = ref || meta.default_branch || "main";
  const data = await fetchJson(`${GH_API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!Array.isArray(data.tree)) throw new Error("仓库树读取失败");
  treeCache.set(key, { tree: data.tree, ts: Date.now() });
  return data.tree;
}

// 用整棵树在本地计算目录列表；SKILL.md 所在目录标记为可安装技能。
// 每次浏览只消耗 1 次 API 配额（树缓存命中时 0 次）。
async function githubList(repo, ref, relPath, q) {
  const tree = await getRepoTree(repo, ref);
  const norm = (p) => p.replace(/\/+$/, "");
  const target = norm(relPath || "");
  const skillDirs = new Set();
  for (const node of tree) {
    if (node.type !== "blob" || node.path.split("/").pop() !== "SKILL.md") continue;
    skillDirs.add(norm(node.path.slice(0, node.path.lastIndexOf("/"))));
  }
  const prefix = target ? target + "/" : "";
  const seen = new Map();
  for (const node of tree) {
    if (node.type === "tree" && node.path === target) continue;
    if (target && !node.path.startsWith(prefix)) continue;
    const rest = node.path.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    seen.set(rest, { name: rest, type: node.type === "tree" ? "dir" : "file", path: node.path, isSkill: skillDirs.has(norm(node.path)) });
  }
  // 目录条目本身可能不在 tree 里（GitHub 只返回 blob+部分 tree），从 SKILL.md 路径推导补齐
  for (const dir of skillDirs) {
    if (target && !dir.startsWith(prefix)) continue;
    const rest = target ? dir.slice(prefix.length) : dir;
    if (!rest || rest.includes("/")) continue;
    if (!seen.has(rest)) seen.set(rest, { name: rest, type: "dir", path: dir, isSkill: true });
  }
  let items = [...seen.values()];
  // 计算目录子项数（来自整棵树，无额外 API 消耗）
  for (const item of items) {
    if (item.type !== "dir") continue;
    const p = item.path + "/";
    item.files = tree.filter(n => n.path.startsWith(p)).length;
  }
  if (q) items = items.filter(i => i.name.toLowerCase().includes(q.toLowerCase()));
  items.sort((a, b) => (b.isSkill ? 1 : 0) - (a.isSkill ? 1 : 0) || a.name.localeCompare(b.name));
  const branch = ref || "main";
  return { repo, branch, path: target, items };
}

async function clawdhubSearch(api, q) {
  const data = await fetchJson(`${api}/api/v1/search?q=${encodeURIComponent(q)}&limit=30`);
  const items = (data.results || data.items || []).map(x => ({
    slug: x.slug || ((x.install && x.install.reference) || "").split("/").pop(),
    ownerHandle: x.ownerHandle || ((x.install && x.install.reference) || "").split("/")[0],
    name: x.displayName || x.slug,
    summary: x.summary || x.description || "",
    downloads: x.downloads ?? (x.metrics && x.metrics.downloads) ?? 0,
    featured: !!x.featured,
    reference: (x.install && x.install.reference) || `${x.ownerHandle || ""}/${x.slug || ""}`,
  }));
  return { items };
}

// 在解压结果中定位技能目录（含 SKILL.md 的一层）
async function findSkillDir(base) {
  const candidates = [base, ...(await readdir(base, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => join(base, d.name))];
  for (const dir of candidates) {
    try {
      const f = join(dir, "SKILL.md");
      const st = await stat(f);
      if (st.isFile()) return { dir, fm: parseFrontmatter(await readFile(f, "utf8")) };
    } catch { /* next */ }
  }
  throw new Error("下载内容中未找到 SKILL.md，不是有效的技能包");
}

function checkTarSafe(members) {
  for (const member of members) {
    const rel = member.replace(/^[^/]+\//, ""); // 去掉 tar 顶层目录
    if (rel && (rel.startsWith("/") || rel.split("/").includes(".."))) throw new Error(`压缩包含不安全路径: ${member}`);
  }
}

async function downloadTo(url, destFile) {
  const r = await fetch(url, { headers: { "User-Agent": NS } });
  if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}: ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(destFile, buf);
  return buf.length;
}

function runTar(args) {
  const r = spawnSync("tar", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tar 执行失败: ${r.stderr || r.stdout || "未知错误"}`);
  return r;
}

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const e of await readdir(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await writeFile(d, await readFile(s));
  }
}

// 安装：kind = github（tarball）| clawdhub（zip）
async function marketInstall(body) {
  const force = !!body.force;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const tmp = join(tmpdir(), `${NS}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
  try {
    let srcDir, provenance, fallbackName;
    if (body.kind === "github") {
      const repo = String(body.repo || "").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repo 格式应为 owner/repo");
      const ref = String(body.ref || "main");
      const subPath = String(body.subPath || "").replace(/^\/+|\/+$/g, "");
      const tgz = join(tmp, "repo.tgz");
      const size = await downloadTo(`https://codeload.github.com/${repo}/tar.gz/refs/heads/${encodeURIComponent(ref)}`, tgz);
      if (size < 100) throw new Error("下载内容异常（过小），ref 是否正确？");
      const list = runTar(["-tzf", tgz]).stdout.split("\n").filter(Boolean);
      checkTarSafe(list);
      const src = join(tmp, "src");
      await mkdir(src, { recursive: true });
      runTar(["-xzf", tgz, "-C", src, "--strip-components", "1"]);
      srcDir = subPath ? join(src, subPath) : src;
      provenance = { source: `github:${repo}`, ref, subPath };
      fallbackName = norm(subPath ? subPath.split("/").pop() : repo.split("/")[1]);
    } else if (body.kind === "clawdhub") {
      const slug = String(body.slug || "");
      if (!/^[\w.-]+$/.test(slug)) throw new Error("slug 不合法");
      const api = MARKET_SOURCES.find(s => s.id === "clawdhub").api;
      let url = `${api}/api/v1/download?slug=${encodeURIComponent(slug)}`;
      if (body.ownerHandle) url += `&ownerHandle=${encodeURIComponent(body.ownerHandle)}`;
      const zip = join(tmp, "skill.zip");
      await downloadTo(url, zip);
      const list = spawnSync("unzip", ["-Z1", zip], { encoding: "utf8" });
      if (list.status !== 0) throw new Error(`zip 读取失败: ${list.stderr}`);
      checkTarSafe(list.stdout.split("\n").filter(Boolean));
      const dest = join(tmp, "unzip");
      await mkdir(dest, { recursive: true });
      const uz = spawnSync("unzip", ["-q", "-o", zip, "-d", dest]);
      if (uz.status !== 0) throw new Error(`zip 解压失败: ${uz.stderr}`);
      srcDir = dest;
      provenance = { source: `clawdhub:${body.ownerHandle || ""}/${slug}`, ref: body.ownerHandle || "", subPath: slug };
      fallbackName = norm(slug);
    } else {
      throw new Error("kind 必须是 github 或 clawdhub");
    }

    const st = await stat(srcDir).catch(() => null);
    if (!st || !st.isDirectory()) throw new Error("指定的技能路径不存在或不是目录");
    const found = await findSkillDir(srcDir);
    let name = norm(body.name) || norm(found.fm.name) || fallbackName || "unnamed-skill";
    if (!SKILL_NAME_RE.test(name)) throw new Error(`技能名不合法: ${name}`);

    const destDir = join(skillsDir(), name);
    const exists = await stat(destDir).then(() => true).catch(() => false);
    if (exists && !force) {
      return { status: 409, body: { error: `技能目录已存在: ${name}`, needsForce: true, name } };
    }
    if (exists) await rm(destDir, { recursive: true, force: true });
    await copyDir(found.dir, destDir);
    const prov = await loadProvenance();
    prov[name] = { ...provenance, installedAt: new Date().toISOString() };
    await saveProvenance(prov);
    return { status: 200, body: { ok: true, name, path: destDir, description: found.fm.description || "" } };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// 卸载：默认移入 ~/.dsh/skills/.skills-manager/trash/（可手动找回）；permanent=true 时彻底删除
async function marketUninstall(body) {
  const name = String(body.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!SKILL_NAME_RE.test(name)) throw new Error("技能名不合法");
  const dir = join(skillsDir(), name);
  const st = await stat(dir).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error(`技能不存在: ${name}`);
  // 防误删：只允许卸载含 SKILL.md 的技能目录
  const hasSkill = await stat(join(dir, "SKILL.md")).then(s => s.isFile()).catch(() => false);
  if (!hasSkill) throw new Error("目标目录不含 SKILL.md，拒绝删除");
  if (body.permanent) {
    await rm(dir, { recursive: true, force: true });
  } else {
    const trashDir = join(skillsDir(), ".skills-manager", "trash");
    await mkdir(trashDir, { recursive: true });
    const dest = join(trashDir, `${name}@${Date.now()}`);
    await rename(dir, dest).catch(async (e) => {
      // 跨设备 rename 失败时退化为复制+删除
      if (String(e).includes("EXDEV")) { await copyDir(dir, dest); await rm(dir, { recursive: true, force: true }); }
      else throw e;
    });
  }
  const prov = await loadProvenance();
  delete prov[name];
  await saveProvenance(prov);
  return { status: 200, body: { ok: true, name, permanent: !!body.permanent } };
}

// ---------- HTTP ----------
function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": data.length });
  res.end(data);
}
async function sendFile(res, filePath, type) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "Content-Length": data.length });
    res.end(data);
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) });
  }
}

async function readBody(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  if (!text) return {};
  return JSON.parse(text);
}

export function createHandler() {
  return async function handler(req, res) {
    let pathname = "/";
    try { pathname = decodeURIComponent(new URL(req.url || "/", "http://local").pathname); } catch { /* keep "/" */ }
    const marker = "/api/skills-manager";
    const idx = pathname.indexOf(marker);
    const route = (idx >= 0 ? pathname.slice(idx + marker.length) : pathname) || "/";
    const q = Object.fromEntries(new URL(req.url || "/", "http://local").searchParams);

    try {
      if (route === "/index") return sendJson(res, 200, await scanSkills());
      if (route === "/" || route === "/dashboard" || route === "/index.html") {
        return sendFile(res, join(PLUGIN_DIR, "dashboard", "index.html"), "text/html");
      }
      if (route === "/market/sources") return sendJson(res, 200, { sources: MARKET_SOURCES });
      if (route === "/market/list") {
        const source = MARKET_SOURCES.find(s => s.id === q.source);
        if (!source) return sendJson(res, 400, { error: "未知市场源" });
        if (source.type !== "github") return sendJson(res, 400, { error: "该源不支持目录浏览，请用搜索" });
        const repo = q.repo || source.repo;
        const path = q.path !== undefined ? q.path : (source.rootPath || "");
        return sendJson(res, 200, await githubList(repo, q.ref, path, q.q || ""));
      }
      if (route === "/market/search") {
        const source = MARKET_SOURCES.find(s => s.id === q.source);
        if (!source) return sendJson(res, 400, { error: "未知市场源" });
        if (source.type !== "clawdhub") return sendJson(res, 400, { error: "该源不支持搜索，请用浏览" });
        return sendJson(res, 200, await clawdhubSearch(source.api, q.q || ""));
      }
      if (route === "/market/install" && req.method === "POST") {
        const body = await readBody(req);
        const r = await marketInstall(body);
        return sendJson(res, r.status, r.body);
      }
      if (route === "/uninstall" && req.method === "POST") {
        const body = await readBody(req);
        const r = await marketUninstall(body);
        return sendJson(res, r.status, r.body);
      }
      return sendJson(res, 404, { error: `unknown route: ${route}` });
    } catch (e) {
      return sendJson(res, 500, { error: String(e && e.message || e) });
    }
  };
}

export async function apply(ctx) {
  const webServer = ctx.webServer;
  if (webServer === void 0) {
    ctx.logger?.warn?.(`[${NS}] webServer 服务不可用，跳过路由注册`);
    return;
  }
  const handler = createHandler();
  ctx.effect?.(
    () => webServer.register({ kind: "prefix", path: "/api/skills-manager", handler }),
    `${NS}: api routes`
  );
  ctx.logger?.info?.(`[${NS}] 技能管理台就绪：/api/skills-manager/dashboard（含技能市场）`);
}
