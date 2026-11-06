// Auxiliary records never consume the room's shared metadata allowance.
export function localKey(scope: string, kind: string) {
  return `team-journal.local.v1:${encodeURIComponent(scope)}:${kind}`;
}
export function readLocal<T>(scope: string, kind: string, fallback: T): T {
  const raw = localStorage.getItem(localKey(scope, kind));
  return raw ? (JSON.parse(raw) as T) : fallback;
}
export function writeLocal(scope: string, kind: string, value: unknown) {
  try {
    localStorage.setItem(localKey(scope, kind), JSON.stringify(value));
  } catch {
    throw Error(
      "本机保存失败，请检查浏览器存储空间或网站权限。原共享资料尚未移除。",
    );
  }
}
export function clearLocal(scope: string, kind: string) {
  localStorage.removeItem(localKey(scope, kind));
}
