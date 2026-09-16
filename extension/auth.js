// Popup de desbloqueo biométrico. Corre en origen chrome-extension:// (WebAuthn
// permitido), hace el Touch ID y le manda el resultado al panel por chrome.runtime.
const CRED_KEY = 'biometric_credential';
const reqId = new URLSearchParams(location.search).get('reqId');

const btn = document.getElementById('unlock');
const cancelBtn = document.getElementById('cancel');
const statusEl = document.getElementById('status');
const promptEl = document.getElementById('prompt');

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function getStoredCred() {
  try { const r = await chrome.storage.local.get(CRED_KEY); return r[CRED_KEY] || null; }
  catch { return null; }
}
async function storeCred(id) {
  try { await chrome.storage.local.set({ [CRED_KEY]: { id } }); } catch {}
}

// Registra (primera vez) o verifica una credencial de plataforma → dispara Touch ID.
async function authenticate() {
  const stored = await getStoredCred();
  if (!stored) {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'TabDB Pro' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'tabdb', displayName: 'TabDB Pro' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
      },
    });
    await storeCred(b64(cred.rawId));
  } else {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64(stored.id) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
  }
}

function finish(ok) {
  try { chrome.runtime.sendMessage({ type: 'tabdb-biometric-result', reqId, ok }); } catch {}
  window.close();
}

async function run() {
  btn.disabled = true;
  statusEl.className = '';
  statusEl.textContent = 'Esperando Touch ID…';
  try {
    await authenticate();
    finish(true);
  } catch (e) {
    btn.disabled = false;
    statusEl.className = 'err';
    statusEl.textContent = e.name === 'NotAllowedError'
      ? '✗ Cancelado o sin verificación. Probá de nuevo.'
      : '✗ ' + (e.message || e.name);
    // Si la credencial guardada ya no existe (p.ej. borraste el ítem del llavero),
    // limpiamos para re-registrar en el próximo intento.
    if (e.name === 'InvalidStateError' || /not.*found/i.test(e.message || '')) {
      try { await chrome.storage.local.remove(CRED_KEY); promptEl.textContent = 'Registrá Touch ID de nuevo.'; } catch {}
    }
  }
}

btn.addEventListener('click', run);
cancelBtn.addEventListener('click', () => finish(false));
btn.focus();
