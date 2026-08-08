import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function atomicWrite(filePath: string, content: string, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  fs.writeFileSync(temp, content, mode === undefined ? undefined : { mode });
  fs.renameSync(temp, filePath);
}

export function atomicWriteJson(filePath: string, value: unknown, mode?: number): void {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export type LockHandle = { path: string; token: string };

export function acquireLock(
  lockPath: string,
  opts: { staleMs?: number; now?: number } = {},
): LockHandle {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const staleMs = opts.staleMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now();
  const token = randomUUID();
  const body = `${JSON.stringify({ token, pid: process.pid, host: process.env.HOSTNAME || "local", startedAt: new Date(now).toISOString() })}\n`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(fd, body);
      fs.closeSync(fd);
      return { path: lockPath, token };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      const stat = fs.statSync(lockPath);
      if (now - stat.mtimeMs <= staleMs) {
        throw new Error(`run_locked: ${lockPath}`);
      }
      fs.unlinkSync(lockPath);
    }
  }
  throw new Error(`run_locked: ${lockPath}`);
}

export function releaseLock(handle: LockHandle): void {
  if (!fs.existsSync(handle.path)) return;
  try {
    const current = JSON.parse(fs.readFileSync(handle.path, "utf8")) as {
      token?: string;
    };
    if (current.token !== handle.token) return;
  } catch {
    return;
  }
  fs.unlinkSync(handle.path);
}

export function withLock<T>(lockPath: string, fn: () => T): T {
  const lock = acquireLock(lockPath);
  try {
    return fn();
  } finally {
    releaseLock(lock);
  }
}
