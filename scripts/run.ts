/**
 * Starts several FlowCheck processes in one terminal with prefixed output.
 *   node scripts/run.ts start [--demo]   build UI if missing or outdated, then server + runner (UI at http://127.0.0.1:4310)
 *   node scripts/run.ts dev [--demo]     Vite (UI at http://127.0.0.1:5173) + server + runner with --watch
 * Ctrl+C stops all of them; if one exits, the others are stopped too.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2] === 'dev' ? 'dev' : 'start';
const withDemo = process.argv.includes('--demo');
const envFile = resolve(root, '.env');
const nodeFlags = [...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), ...(mode === 'dev' ? ['--watch'] : [])];

/** Newest modification time below a directory (files only). */
function newest(dir: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return latest;
}

/** No build yet, or the UI sources or shared contracts changed after it (e.g. after "git pull"). */
function webBuildOutdated(): boolean {
  const built = resolve(root, 'apps/web/dist/index.html');
  if (!existsSync(built)) return true;
  const sources = ['apps/web/src', 'apps/web/index.html', 'packages/shared/src'].map((p) => resolve(root, p));
  const changed = Math.max(...sources.filter(existsSync).map((p) => (statSync(p).isDirectory() ? newest(p) : statSync(p).mtimeMs)));
  return changed > statSync(built).mtimeMs;
}

interface Proc {
  name: string;
  color: number;
  command: string;
  args: string[];
  cwd: string;
}

const procs: Proc[] = [
  { name: 'server', color: 36, command: process.execPath, args: [...nodeFlags, 'src/main.ts'], cwd: resolve(root, 'apps/server') },
  { name: 'runner', color: 35, command: process.execPath, args: [...nodeFlags, 'src/main.ts'], cwd: resolve(root, 'apps/runner') },
];
if (withDemo)
  procs.push({ name: 'demo', color: 33, command: process.execPath, args: [...nodeFlags, 'src/main.ts'], cwd: resolve(root, 'apps/demo') });

const viteBin = resolve(root, 'apps/web/node_modules/vite/bin/vite.js');
if (mode === 'dev') {
  procs.push({ name: 'web', color: 32, command: process.execPath, args: [viteBin], cwd: resolve(root, 'apps/web') });
} else if (webBuildOutdated()) {
  console.log('Building the web UI (first start, or the UI changed since the last build)…');
  const build = spawnSync(process.execPath, [viteBin, 'build'], { cwd: resolve(root, 'apps/web'), stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const children: ChildProcess[] = [];
let stopping = false;

function stopAll(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGINT');
  setTimeout(() => process.exit(code), 3000).unref();
}

for (const proc of procs) {
  // In dev mode the UI is served by Vite, so the server prints its access link with Vite's port.
  const env = proc.name === 'server' && mode === 'dev' ? { ...process.env, FLOWCHECK_UI_PORT: '5173' } : process.env;
  const child = spawn(proc.command, proc.args, { cwd: proc.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const prefix = `\x1b[${proc.color}m[${proc.name}]\x1b[0m `;
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(`${prefix}${line}\n`);
    });
  };
  if (child.stdout) pipe(child.stdout, process.stdout);
  if (child.stderr) pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${prefix}exited with code ${code}; stopping the others`);
      stopAll(code ?? 1);
    } else if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) {
      process.exit(0);
    }
  });
}

const port = process.env.FLOWCHECK_SERVER_PORT ?? '4310';
console.log(
  `\nFlowCheck UI: http://127.0.0.1:${mode === 'dev' ? '5173' : port} (first time in a browser: open the "Open FlowCheck" link printed by [server])${withDemo ? '   ·   Demo shop: http://127.0.0.1:4320' : ''}\n`,
);

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
