// SDK errors cross postMessage as plain objects, not necessarily Error instances.
export function errorMessage(error: unknown): string {
  const seen = new Set<object>();
  function read(value: unknown, depth = 0): string {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object" || depth > 4 || seen.has(value))
      return "";
    seen.add(value);
    const record = value as Record<string, unknown>;
    const issues = record.issues ?? record.errors;
    if (Array.isArray(issues)) {
      const messages = issues
        .slice(0, 5)
        .map((issue) => read(issue, depth + 1))
        .filter(Boolean);
      if (messages.length) return messages.join("；");
    }
    if (typeof record.message === "string" && record.message.trim())
      return record.message.trim();
    return read(record.error, depth + 1) || read(record.cause, depth + 1);
  }
  return read(error) || "操作失败，请重试";
}
