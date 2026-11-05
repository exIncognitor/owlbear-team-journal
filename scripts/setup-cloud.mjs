import { webcrypto, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
const keyFolder = join(process.env.LOCALAPPDATA, "TeamJournal", "connections");
const defaultEndpoint = "https://owlbear-twisted-moon.pages.dev/api";
const endpoint = new URL(process.argv[2] ?? defaultEndpoint);
if (
  endpoint.protocol !== "https:" ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash
)
  throw Error("请输入有效的 HTTPS 云端接口地址");
const endpointText = endpoint.href.replace(/\/$/, "");
const keyPath = join(
  keyFolder,
  endpointText === defaultEndpoint
    ? "team-journal-cloud.json"
    : `team-journal-${createHash("sha256").update(endpointText).digest("hex").slice(0, 12)}.json`,
);
await mkdir(keyFolder, { recursive: true });
let profile;
try {
  profile = JSON.parse(await readFile(keyPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  profile = {
    id: webcrypto.randomUUID(),
    name: process.argv[3] ?? "我的 Cloudflare D1",
    endpoint: endpointText,
    privateKey: await webcrypto.subtle.exportKey("jwk", keys.privateKey),
  };
  await writeFile(keyPath, JSON.stringify(profile, null, 2), "utf8");
}
const { d, key_ops, ...publicKey } = profile.privateKey;
await writeFile(
  "server/admin-public.json",
  JSON.stringify({ ...publicKey, key_ops: ["verify"] }, null, 2) + "\n",
);
process.stdout.write(
  `管理连接配置已保存在 ${keyPath}\n仅包含应用管理身份，不是 Cloudflare 账号令牌。请勿提交或公开该文件。\n`,
);
