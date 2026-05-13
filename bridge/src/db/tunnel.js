import { Client } from 'ssh2';
import net from 'net';
import crypto from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const DATA_DIR       = resolve(fileURLToPath(import.meta.url), '../../../../data');
const KNOWN_HOSTS    = resolve(DATA_DIR, 'known_hosts.json');

export function expandPath(p) {
  return p ? p.replace(/^~/, homedir()) : p;
}

// ── TOFU host verification ────────────────────────────────────────────────────
// First connection to a host: accept and persist the fingerprint.
// Subsequent connections: verify fingerprint matches — mismatch = hard error.

function fingerprint(keyBuf) {
  return 'SHA256:' + crypto.createHash('sha256').update(keyBuf).digest('base64');
}

function verifyOrStore(host, port, keyBuf) {
  const hostKey = `${host}:${port}`;
  const fp      = fingerprint(keyBuf);

  let store = {};
  try { if (existsSync(KNOWN_HOSTS)) store = JSON.parse(readFileSync(KNOWN_HOSTS, 'utf8')); }
  catch { store = {}; }

  if (hostKey in store) {
    if (store[hostKey] !== fp) {
      throw new Error(
        `SSH host key mismatch for ${hostKey}.\n` +
        `Stored : ${store[hostKey]}\n` +
        `Received: ${fp}\n\n` +
        `If the server key legitimately changed, delete bridge/data/known_hosts.json ` +
        `(or just the entry for ${hostKey}) and reconnect.`,
      );
    }
    return; // verified OK
  }

  // TOFU: first time seeing this host — accept and persist
  store[hostKey] = fp;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(KNOWN_HOSTS, JSON.stringify(store, null, 2));
  console.log(`[ssh] Trusted new host ${hostKey}  fingerprint: ${fp}`);
}

// ── Tunnel ────────────────────────────────────────────────────────────────────

/**
 * Verifies SSH connectivity without opening a port-forward tunnel.
 * Used by the "Test SSH" button in the extension settings.
 */
export function testSsh(sshCfg) {
  return new Promise((resolve, reject) => {
    const conn    = new Client();
    const sshPort = sshCfg.port || 22;

    conn.on('ready', () => { conn.end(); resolve(); });
    conn.on('error', reject);

    let privateKey;
    if (sshCfg.privateKeyContent) {
      privateKey = Buffer.from(sshCfg.privateKeyContent);
    } else {
      try { privateKey = readFileSync(expandPath(sshCfg.privateKeyPath)); }
      catch (err) { return reject(new Error(`Cannot read SSH private key "${sshCfg.privateKeyPath}": ${err.message}`)); }
    }

    conn.connect({
      host: sshCfg.host, port: sshPort, username: sshCfg.user,
      privateKey, passphrase: sshCfg.passphrase || undefined,
      hostVerifier: (keyBuf, callback) => {
        try { verifyOrStore(sshCfg.host, sshPort, keyBuf); callback(true); }
        catch (err) { reject(err); callback(false); }
      },
    });
  });
}

/**
 * Opens an SSH tunnel and returns a local port that forwards to
 * remoteHost:remotePort from the perspective of the SSH server.
 *
 * Returns { localPort, close() }.
 */
export function openTunnel(sshCfg, remoteHost, remotePort) {
  return new Promise((res, rej) => {
    const conn    = new Client();
    const sshPort = sshCfg.port || 22;

    conn.on('ready', () => {
      // Local TCP server — each incoming socket gets its own SSH channel
      const server = net.createServer((socket) => {
        // Must attach before forwardOut — destroy(err) emits 'error' synchronously
        socket.on('error', () => {});
        conn.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
          if (err) { socket.destroy(); return; }
          socket.pipe(stream).pipe(socket);
          stream.on('close', () => socket.destroy());
          socket.on('close', () => stream.destroy());
          stream.on('error', () => socket.destroy());
        });
      });

      server.listen(0, '127.0.0.1', () => {
        const localPort = server.address().port;
        console.log(`[ssh] Tunnel open: 127.0.0.1:${localPort} → ${remoteHost}:${remotePort} via ${sshCfg.host}`);
        res({
          localPort,
          close() {
            server.close();
            conn.end();
            console.log(`[ssh] Tunnel closed (port ${localPort})`);
          },
        });
      });

      server.on('error', (err) => { conn.end(); rej(err); });
    });

    conn.on('error', rej);

    let privateKey;
    if (sshCfg.privateKeyContent) {
      privateKey = Buffer.from(sshCfg.privateKeyContent);
    } else {
      try {
        privateKey = readFileSync(expandPath(sshCfg.privateKeyPath));
      } catch (err) {
        return rej(new Error(`Cannot read SSH private key "${sshCfg.privateKeyPath}": ${err.message}`));
      }
    }

    conn.connect({
      host:              sshCfg.host,
      port:              sshPort,
      username:          sshCfg.user,
      privateKey,
      passphrase:        sshCfg.passphrase || undefined,
      keepaliveInterval: 30_000,
      hostVerifier:      (keyBuf, callback) => {
        try {
          verifyOrStore(sshCfg.host, sshPort, keyBuf);
          callback(true);
        } catch (err) {
          rej(err);
          callback(false);
        }
      },
    });
  });
}
