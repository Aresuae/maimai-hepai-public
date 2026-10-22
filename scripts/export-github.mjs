import { createHash, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit source roots also work in a downloaded ZIP without Git or node_modules.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirs = new Set(["app", "build", "components", "db", "docs", "drizzle", "examples", "hooks", "lib", "public", "scripts", "src", "tests", "vendor", ".github"]);
const rootFiles = new Set(["README.md", "CONTEST_DECLARATION.md", "MCP_INTEGRATION.md", "THIRD_PARTY_NOTICES.md", "workbuddy.md", "LICENSE", "LICENSE.md", ".env.example", ".gitignore", ".gitattributes", ".npmrc", "package.json", "package-lock.json", "mcp-config.example.json", "tsconfig.json", "cloudflare-env.d.ts", "components.json", "drizzle.config.ts", "eslint.config.mjs", "next.config.ts", "postcss.config.mjs", "share.html", "vite.config.ts", "vite.share.config.ts", "本机持续运行.cmd", "远程分享启动.cmd"]);
const excludedSegments = /^(?:node_modules|data|dist|artifacts|coverage|\.git|\.next|\.vinext|\.wrangler|\.sites-runtime|\.agents|\.codex|outputs|work)$/i;
const excludedFile = /(?:^\.env(?!\.example$)|\.(?:sqlite|db)(?:-wal|-shm|-journal)?$|\.(?:pem|key|p12|pfx|log|zip|exe|dll|tsbuildinfo)$)/i;
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2"]);
const textExtensions = new Set([".md", ".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".json", ".css", ".svg", ".html", ".sh", ".cmd", ".yml", ".yaml", ".sql", ".license"]);
const files = [];
function collect(path) {
  const absolute = join(root, path);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`不打包符号链接：${path}`);
  if (path.split(/[\\/]/).some(part => excludedSegments.test(part)) || excludedFile.test(basename(path))) return;
  if (stat.isDirectory()) { for (const child of readdirSync(absolute).sort()) collect(`${path}/${child}`); return; }
  if (!stat.isFile()) throw new Error(`不支持的文件类型：${path}`);
  const extension = extname(path).toLowerCase();
  if (!rootFiles.has(path) && !binaryExtensions.has(extension) && !textExtensions.has(extension)) throw new Error(`未审阅的文件类型：${path}`);
  if (binaryExtensions.has(extension) && !/^(?:public\/|docs\/images\/)/.test(path)) throw new Error(`图片/字体仅从 public 或 docs/images 发布：${path}`);
  if (stat.size > 5 * 1024 * 1024) throw new Error(`请先审阅超过 5 MiB 的文件：${path}`);
  files.push(path);
}
for (const name of readdirSync(root).sort()) {
  if (rootFiles.has(name) || sourceDirs.has(name)) collect(name);
}
const hostingPath = ".openai/hosting.json";
const hosting = JSON.parse(readFileSync(join(root, hostingPath), "utf8"));
if (Object.keys(hosting).sort().join(",") !== "d1,r2" || hosting.d1 !== null || hosting.r2 !== null) throw new Error("请先审阅 .openai/hosting.json 的非空托管配置。");
collect(hostingPath);
files.sort();
for (const required of ["README.md", "CONTEST_DECLARATION.md", "MCP_INTEGRATION.md", "mcp-config.example.json", "package.json", "package-lock.json", "vite.config.ts", "app/page.tsx", "src/server/shared-tables.ts", ".github/workflows/ci.yml", hostingPath]) {
  if (!files.includes(required)) throw new Error(`缺少必要源码：${required}`);
}

const knownSecrets = [];
if (existsSync(join(root, ".env.local"))) {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!match || !/(?:TOKEN|SECRET|PASSWORD|API_?KEY)/i.test(match[1])) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    if (value.length >= 12) knownSecrets.push(Buffer.from(value));
  }
}
const rules = [
  ["私钥", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["访问令牌", /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{30,})/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b/],
  ["URL 内嵌凭证", /https?:\/\/[^\s/"']+:[^\s/@"']+@/],
  ["有效格式的餐桌邀请", /#table=[a-f0-9]{24}&invite=[A-Za-z0-9_-]{32}/],
];
const records = files.map(path => {
  const bytes = readFileSync(join(root, path));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Preserve the official template byte-for-byte, pinned to upstream commit
  // c51074fde6a12786b6fe76091aefbb69acdffd5b. Do not edit the declaration itself.
  if (path === "CONTEST_DECLARATION.md" && sha256 !== "cd28101bcb29cc8fb24b372fe91ce6b42c4a1487a54e01f7ade0c8c6a84241b7") {
    throw new Error("CONTEST_DECLARATION.md 与官方原文不一致，请恢复原文件；来源见 README 参赛材料索引。");
  }
  if (knownSecrets.some(secret => bytes.includes(secret))) throw new Error(`停止打包：${path} 命中本机敏感配置值。`);
  if (!binaryExtensions.has(extname(path).toLowerCase())) {
    const content = bytes.toString("utf8");
    for (const [label, pattern] of rules) if (pattern.test(content)) throw new Error(`停止打包：${path} 命中${label}检查，请审阅。`);
  }
  return { path, bytes, sha256 };
});

// Small, dependency-free ZIP writer: DEFLATE, UTF-8 names, CRC32, no ZIP64 needed.
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let n = 0; n < 8; n++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(`maimai-hepai/${entry.path}`, "utf8");
    const compressed = deflateRawSync(entry.bytes, { level: 9 });
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); // Fixed 1980-01-01 timestamp for stable archives.
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(entry.bytes.length, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8); header.writeUInt16LE(8, 10); header.writeUInt16LE(33, 14);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(entry.bytes.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); central.push(header, name); offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = join(root, "artifacts", "github", `${stamp}-${randomBytes(3).toString("hex")}`);
const packageRoot = join(destination, "maimai-hepai");
mkdirSync(packageRoot, { recursive: true });
for (const record of records) {
  const target = resolve(packageRoot, record.path);
  if (relative(packageRoot, target).startsWith("..")) throw new Error("非法导出路径。");
  mkdirSync(dirname(target), { recursive: true });
  // Use the exact bytes already scanned, not a second read of a changing source.
  writeFileSync(target, record.bytes, { flag: "wx" });
}
const archive = zip(records);
writeFileSync(join(destination, "maimai-hepai-source.zip"), archive, { flag: "wx" });
writeFileSync(join(destination, "manifest.json"), JSON.stringify({
  createdAt: new Date().toISOString(), fileCount: records.length, sourceBytes: records.reduce((n, r) => n + r.bytes.length, 0), zipBytes: archive.length,
  zipSha256: createHash("sha256").update(archive).digest("hex"),
  files: records.map(({ path, bytes, sha256 }) => ({ path, bytes: bytes.length, sha256 })),
}, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ directory: packageRoot, zip: join(destination, "maimai-hepai-source.zip"), manifest: join(destination, "manifest.json"), files: records.length, zipBytes: archive.length }, null, 2));
