import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { getDumpConnectionParams } from './pool.js';

// Como servicio (launchd) el PATH es mínimo y no incluye mysqldump/pg_dump.
// Buscamos el binario en ubicaciones comunes y ampliamos el PATH del proceso hijo.
const EXTRA_DIRS = [
  '/usr/local/mysql/bin',
  '/opt/homebrew/bin', '/usr/local/bin',
  '/opt/homebrew/opt/mysql-client/bin', '/usr/local/opt/mysql-client/bin',
  '/opt/homebrew/opt/libpq/bin', '/usr/local/opt/libpq/bin',
  '/Applications/Postgres.app/Contents/Versions/latest/bin',
  '/Applications/MAMP/Library/bin',
];

function resolveCmd(cmd) {
  for (const dir of EXTRA_DIRS) {
    const p = `${dir}/${cmd}`;
    if (existsSync(p)) return p;
  }
  return cmd;   // si no, que lo resuelva el PATH (o falle con ENOENT)
}

export async function dumpDatabase(dbName) {
  const params = getDumpConnectionParams();
  if (!params) throw new Error('No active connection');

  const database = dbName || params.database;
  if (!database) throw new Error('No database selected');

  if (params.type === 'postgres') {
    return runDump('pg_dump', [
      '-h', params.host,
      '-p', String(params.port),
      '-U', params.user,
      database,
    ], { PGPASSWORD: params.password ?? '' });
  } else {
    return runDump('mysqldump', [
      '-h', params.host,
      '-P', String(params.port),
      '-u', params.user,
      '--no-tablespaces',
      database,
    ], { MYSQL_PWD: params.password ?? '' });
  }
}

function runDump(cmd, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const augmentedPath = [...EXTRA_DIRS, process.env.PATH || ''].join(':');
    const proc = spawn(resolveCmd(cmd), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: augmentedPath, ...extraEnv },
    });

    const chunks = [];
    const errChunks = [];
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (chunk) => errChunks.push(chunk));

    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString().trim();
        reject(new Error(stderr || `${cmd} exited with code ${code}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`${cmd} not found — make sure it is installed and in PATH`));
      } else {
        reject(err);
      }
    });
  });
}
