// Puente panel → popup de auth. El panel (devtools://) no puede hacer WebAuthn,
// así que abre una ventana de la extensión (chrome-extension://) que hace el Touch ID
// y devuelve el resultado por chrome.runtime. Resuelve true/false.
let _seq = 0;

export function requestUnlock() {
  return new Promise((resolve) => {
    const reqId = `bio-${++_seq}-${Date.now()}`;
    let done = false;
    let winId = null;

    const finish = (ok) => {
      if (done) return;
      done = true;
      try { chrome.runtime.onMessage.removeListener(onMsg); } catch {}
      try { chrome.windows?.onRemoved?.removeListener(onClosed); } catch {}
      resolve(ok);
    };
    const onMsg = (msg) => {
      if (msg && msg.type === 'tabdb-biometric-result' && msg.reqId === reqId) finish(!!msg.ok);
    };
    const onClosed = (id) => { if (id === winId) finish(false); };   // cerró el popup sin autenticar

    try { chrome.runtime.onMessage.addListener(onMsg); } catch { return resolve(false); }

    const url = chrome.runtime.getURL('auth.html') + '?reqId=' + encodeURIComponent(reqId);
    try {
      chrome.windows.create({ url, type: 'popup', width: 380, height: 340, focused: true }, (win) => {
        if (chrome.runtime.lastError || !win) {
          // Fallback si chrome.windows no está disponible en este contexto
          try { window.open(url, 'tabdb-bio', 'width=380,height=340'); }
          catch { finish(false); }
          return;
        }
        winId = win.id;
        try { chrome.windows.onRemoved.addListener(onClosed); } catch {}
      });
    } catch {
      try { window.open(url, 'tabdb-bio', 'width=380,height=340'); } catch { finish(false); }
    }

    setTimeout(() => finish(false), 90000);   // timeout de seguridad
  });
}
