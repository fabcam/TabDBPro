import { spawn } from 'child_process';
import { getDumpConnectionParams } from './pool.js';

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
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
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
