const PBKDF2_ITERATIONS = 200_000;
const SALT_LEN = 16;
const IV_LEN   = 12;

async function deriveKey(passphrase, salt) {
  const enc         = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

export async function encryptConnections(connections, passphrase) {
  const salt      = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv        = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key       = await deriveKey(passphrase, salt);
  const payload   = new TextEncoder().encode(JSON.stringify({ connections }));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return JSON.stringify({ v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(encrypted) });
}

export async function decryptConnections(fileText, passphrase) {
  let parsed;
  try   { parsed = JSON.parse(fileText); }
  catch { throw new Error('Invalid file format'); }
  if (parsed.v !== 1) throw new Error('Unsupported file version');

  const salt = fromB64(parsed.salt);
  const iv   = fromB64(parsed.iv);
  const data = fromB64(parsed.data);
  const key  = await deriveKey(passphrase, salt);

  let plain;
  try   { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data); }
  catch { throw new Error('Wrong passphrase or corrupted file'); }

  const { connections } = JSON.parse(new TextDecoder().decode(plain));
  if (!Array.isArray(connections)) throw new Error('Invalid file contents');
  return connections;
}
