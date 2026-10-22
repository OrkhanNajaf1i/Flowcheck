import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { type FlowDb, pruneArtifacts } from '@flowcheck/db';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerConfig } from './config.ts';

const EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Applies artifact retention (PROJECT_RULES §16): rows first, then files. A file that cannot be
 * deleted is logged, never hidden; paths are server-generated and checked to stay inside the
 * artifacts root.
 */
export function runArtifactRetention(db: FlowDb, config: ServerConfig, log: FastifyBaseLogger): number {
  const pruned = pruneArtifacts(db, config.retention);
  const root = resolve(config.artifactsDir);
  for (const artifact of pruned) {
    const file = resolve(root, artifact.relativePath);
    if (!file.startsWith(root + sep)) {
      log.error({ artifactId: artifact.id }, 'artifact path outside the artifacts directory; file not deleted');
      continue;
    }
    try {
      rmSync(file, { force: true });
    } catch (error) {
      log.error({ err: error, file }, 'failed to delete artifact file');
    }
  }
  if (pruned.length > 0) {
    const bytes = pruned.reduce((sum, a) => sum + a.size, 0);
    log.info({ count: pruned.length, bytes, byAge: pruned.filter((a) => a.reason === 'age').length }, 'old artifacts removed');
  }
  return pruned.length;
}

/** Runs retention now and every 6 hours; the timer never keeps the process alive. */
export function scheduleArtifactRetention(db: FlowDb, config: ServerConfig, log: FastifyBaseLogger): () => void {
  const tick = () => {
    try {
      runArtifactRetention(db, config, log);
    } catch (error) {
      log.error({ err: error }, 'artifact retention failed');
    }
  };
  tick();
  const timer = setInterval(tick, EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
