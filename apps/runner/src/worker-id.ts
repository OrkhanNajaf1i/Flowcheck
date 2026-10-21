import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

/** `host:pid:random` — lets a restarted runner tell a dead worker from a live one. */
export function newWorkerId(): string {
  return `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
}

/**
 * A worker on this host is alive if its process exists. Workers on other hosts are assumed
 * alive; their runs are only recovered once their heartbeat goes stale.
 */
export function isWorkerAlive(id: string, self: string, probe: (pid: number) => void = (pid) => process.kill(pid, 0)): boolean {
  if (id === self) return true;
  const [host, pid] = id.split(':');
  if (host !== hostname()) return true;
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  if (numericPid === process.pid) return false; // same pid, different id: a previous incarnation
  try {
    probe(numericPid);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
