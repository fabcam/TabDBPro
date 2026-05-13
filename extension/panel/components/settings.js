import { encryptConnections, decryptConnections } from './crypto.js';

const STORAGE_KEY = 'bridge_config';

export const CONN_COLORS = [
  '#58a6ff', // blue
  '#3fb950', // green
  '#bc8cff', // purple
  '#e8834d', // orange
  '#e3b341', // yellow
  '#39d0a0', // teal
  '#f85149', // red
  '#f778ba', // pink
];

export class Settings {
  constructor({ modalEl, bodyEl, onApply, onTestSsh, onTestDb }) {
    this._modal = modalEl;
    this._body = bodyEl;
    this._onApply  = onApply;
    this._onTestSsh = onTestSsh;
    this._onTestDb  = onTestDb;
    this._config = { connections: [] };
    this._editIdx = null; // null=list, 'export', 'import', -1=new, >=0=editing
    this._draft = null;
    this._importFileContent = null;
    this._importFileName    = '';

    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) this.close(); });
  }

  get config() { return { connections: this._config.connections }; }

  async load() {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    if (r[STORAGE_KEY]) this._config = r[STORAGE_KEY];
  }

  open() {
    this._editIdx = null;
    this._render();
    this._modal.classList.remove('hidden');
  }

  close() {
    this._modal.classList.add('hidden');
  }

  async _save() {
    await chrome.storage.local.set({ [STORAGE_KEY]: this._config });
    this.close();
    await this._onApply({ connections: this._config.connections });
  }

  _render() {
    this._body.innerHTML = '';
    if      (this._editIdx === null)     this._renderList();
    else if (this._editIdx === 'export') this._renderExport();
    else if (this._editIdx === 'import') this._renderImport();
    else                                 this._renderForm();
  }

  _renderList() {
    const { connections } = this._config;

    // ── Connections section ──
    const section = el('div', 'settings-section');

    const header = el('div', 'settings-section-header');
    header.append(text('span', 'Connections', 'settings-section-title'));
    const addBtn = btn('+ Add', 'btn-sm', () => {
      this._editIdx = -1;
      this._draft = { name: '', type: 'postgres', host: 'localhost', port: 5432, database: '', user: '', password: '', readOnly: false, color: CONN_COLORS[0] };
      this._render();
    });
    header.appendChild(addBtn);
    section.appendChild(header);

    if (connections.length === 0) {
      const empty = el('div', 'settings-empty');
      empty.textContent = 'No connections yet. Click "+ Add" to configure one.';
      section.appendChild(empty);
    } else {
      for (let i = 0; i < connections.length; i++) {
        const c = connections[i];
        const row = el('div', 'settings-conn-row');

        const info = el('div', 'settings-conn-info');
        const dot = el('span', 'conn-dot');
        dot.style.background = c.color ?? CONN_COLORS[0];
        const nameEl = text('span', c.name, 'settings-conn-name');
        const roTag = c.readOnly ? ' · read-only' : '';
        const sub = text('span', `${c.type} · ${c.host}:${c.port} / ${c.database}${roTag}`, 'settings-conn-sub');
        info.append(dot, nameEl, sub);

        const actions = el('div', 'settings-conn-actions');

        const upBtn = btn('↑', 'btn-sm', () => {
          if (i === 0) return;
          [connections[i - 1], connections[i]] = [connections[i], connections[i - 1]];
          this._render();
        });
        upBtn.disabled = i === 0;
        upBtn.title = 'Move up';

        const downBtn = btn('↓', 'btn-sm', () => {
          if (i === connections.length - 1) return;
          [connections[i], connections[i + 1]] = [connections[i + 1], connections[i]];
          this._render();
        });
        downBtn.disabled = i === connections.length - 1;
        downBtn.title = 'Move down';

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(btn('Edit', 'btn-sm', () => {
          this._editIdx = i;
          this._draft = { ...this._config.connections[i] };
          this._render();
        }));
        actions.appendChild(btn('Delete', 'btn-sm btn-danger', () => {
          if (confirm(`Delete "${c.name}"?`)) {
            this._config.connections.splice(i, 1);
            this._render();
          }
        }));

        row.append(info, actions);
        section.appendChild(row);
      }
    }
    this._body.appendChild(section);

    // ── Footer ──
    const footer = el('div', 'settings-footer settings-footer-split');

    const leftBtns = el('div', 'settings-footer-left');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.tabdbpro,.json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      this._importFileContent = await file.text();
      this._importFileName = file.name;
      this._editIdx = 'import';
      this._render();
    });
    const importBtn = btn('Import…', 'btn-sm', () => fileInput.click());
    const exportBtn = btn('Export…', 'btn-sm', () => { this._editIdx = 'export'; this._render(); });
    exportBtn.disabled = connections.length === 0;
    exportBtn.title    = connections.length === 0 ? 'Add a connection first' : 'Export all connections encrypted';
    leftBtns.append(fileInput, importBtn, exportBtn);

    const saveBtn = btn('Save & Apply', 'btn-primary', () => this._save());
    saveBtn.disabled = connections.length === 0;

    footer.append(leftBtns, saveBtn);
    this._body.appendChild(footer);
  }

  _renderForm() {
    const isNew = this._editIdx === -1;
    const d = this._draft;

    const form = el('div', 'settings-form');

    const nameEl   = input('text',     d.name,     'My Postgres');
    const typeEl   = this._typeSelect(d.type);
    const hostEl   = input('text',     d.host,     'localhost');
    const portEl   = input('number',   d.port,     '5432');
    const dbEl     = input('text',     d.database, 'mydb');
    const userEl   = input('text',     d.user,     'postgres');
    const pwEl     = input('password', d.password, '');

    // Show/hide password
    const pwWrap = el('div', 'settings-pw-wrap');
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = 'icon-btn pw-eye-btn';
    eyeBtn.title = 'Show/hide password';
    eyeBtn.innerHTML = SVG_EYE;
    eyeBtn.addEventListener('click', () => {
      const show = pwEl.type === 'password';
      pwEl.type = show ? 'text' : 'password';
      eyeBtn.innerHTML = show ? SVG_EYE_OFF : SVG_EYE;
    });
    pwWrap.append(pwEl, eyeBtn);

    // Update default port when type changes
    typeEl.addEventListener('change', () => {
      portEl.value = typeEl.value === 'mysql' ? '3306' : '5432';
    });

    const roLabel = el('label', 'settings-ro-label');
    const roCheck = document.createElement('input');
    roCheck.type = 'checkbox';
    roCheck.checked = d.readOnly ?? false;
    roLabel.append(roCheck, ' Read-only mode');

    // Color picker
    let selectedColor = d.color ?? CONN_COLORS[0];
    const colorWrap = el('div', 'color-swatch-row');
    const renderSwatches = () => {
      colorWrap.innerHTML = '';
      for (const c of CONN_COLORS) {
        const sw = el('button', 'color-swatch' + (c === selectedColor ? ' selected' : ''));
        sw.type = 'button';
        sw.style.background = c;
        sw.title = c;
        sw.addEventListener('click', () => { selectedColor = c; renderSwatches(); });
        colorWrap.appendChild(sw);
      }
    };
    renderSwatches();

    // SSH tunnel section
    const sshCheck = document.createElement('input');
    sshCheck.type = 'checkbox';
    sshCheck.checked = !!d.ssh;
    const sshToggleLabel = el('label', 'settings-ro-label');
    sshToggleLabel.append(sshCheck, ' Connect via SSH tunnel');

    const sshFields = el('div', 'ssh-fields' + (d.ssh ? '' : ' hidden'));
    const sshHostEl = input('text',   d.ssh?.host           ?? '', 'bastion.example.com');
    const sshPortEl = input('number', d.ssh?.port           ?? 22, '22');
    const sshUserEl = input('text',   d.ssh?.user           ?? '', 'deploy');
    const sshKeyEl  = input('text',   d.ssh?.privateKeyPath ?? '', '~/.ssh/id_ed25519');
    const sshPassEl = input('password', d.ssh?.passphrase   ?? '', 'passphrase (optional)');

    // Track loaded key content (from file picker); null = use path instead
    let sshKeyContent = d.ssh?.privateKeyContent ?? null;

    // File picker for SSH key
    const sshKeyFileInput = document.createElement('input');
    sshKeyFileInput.type = 'file';
    sshKeyFileInput.style.display = 'none';
    sshKeyFileInput.addEventListener('change', async () => {
      const file = sshKeyFileInput.files[0];
      if (!file) return;
      sshKeyContent = await file.text();
      sshKeyEl.value = file.name;
      sshKeyEl.title = file.name;
    });

    const sshKeyBrowseBtn = document.createElement('button');
    sshKeyBrowseBtn.type = 'button';
    sshKeyBrowseBtn.className = 'btn-sm';
    sshKeyBrowseBtn.textContent = 'Browse…';
    sshKeyBrowseBtn.addEventListener('click', () => sshKeyFileInput.click());
    // Clear stored content when user edits the path field manually
    sshKeyEl.addEventListener('input', () => { sshKeyContent = null; });

    const sshKeyWrap = el('div', 'settings-key-wrap');
    sshKeyWrap.append(sshKeyEl, sshKeyBrowseBtn, sshKeyFileInput);

    sshFields.append(
      field('SSH Host',    sshHostEl),
      field('SSH Port',    sshPortEl),
      field('SSH User',    sshUserEl),
      field('Key',         sshKeyWrap),
      field('Passphrase',  sshPassEl),
    );

    sshCheck.addEventListener('change', () => sshFields.classList.toggle('hidden', !sshCheck.checked));

    // Test SSH button (inside sshFields)
    const sshTestRow = el('div', 'test-row');
    const sshTestBtn = btn('Test SSH', 'btn-sm', async () => {
      const status = sshTestRow.querySelector('.test-status');
      setTestStatus(status, 'loading', 'Connecting…');
      try {
        await this._onTestSsh?.({
          host:              sshHostEl.value.trim(),
          port:              parseInt(sshPortEl.value, 10) || 22,
          user:              sshUserEl.value.trim(),
          privateKeyPath:    sshKeyContent ? undefined : sshKeyEl.value.trim(),
          privateKeyContent: sshKeyContent || undefined,
          passphrase:        sshPassEl.value || undefined,
        });
        setTestStatus(status, 'ok', '✓ SSH connection successful');
      } catch (err) {
        setTestStatus(status, 'error', '✗ ' + err.message);
      }
    });
    const sshStatusEl = el('span', 'test-status');
    sshTestRow.append(sshTestBtn, sshStatusEl);
    sshFields.appendChild(sshTestRow);

    form.append(
      field('Name',      nameEl),
      field('Type',      typeEl),
      field('Host',      hostEl),
      field('Port',      portEl),
      field('Database',  dbEl),
      field('Username',  userEl),
      field('Password',  pwWrap),
      field('Color',     colorWrap),
      field('',          roLabel),
      field('',          sshToggleLabel),
      sshFields,
    );
    this._body.appendChild(form);

    const errEl = el('div', 'save-modal-error settings-form-error');
    this._body.appendChild(errEl);

    const footer = el('div', 'settings-footer');
    footer.appendChild(btn('← Back', 'btn-sm', () => { this._editIdx = null; this._render(); }));

    // Test full DB connection button
    const dbTestRow = el('div', 'test-row');
    const dbStatusEl = el('span', 'test-status');
    const dbTestBtn = btn('Test connection', 'btn-sm', async () => {
      setTestStatus(dbStatusEl, 'loading', 'Connecting…');
      try {
        const connSnap = {
          type:     typeEl.value,
          host:     hostEl.value.trim() || 'localhost',
          port:     parseInt(portEl.value, 10) || (typeEl.value === 'mysql' ? 3306 : 5432),
          database: dbEl.value.trim(),
          user:     userEl.value.trim(),
          password: pwEl.value,
          ssh: sshCheck.checked ? {
            host:              sshHostEl.value.trim(),
            port:              parseInt(sshPortEl.value, 10) || 22,
            user:              sshUserEl.value.trim(),
            privateKeyPath:    sshKeyContent ? undefined : sshKeyEl.value.trim(),
            privateKeyContent: sshKeyContent || undefined,
            passphrase:        sshPassEl.value || undefined,
          } : undefined,
        };
        await this._onTestDb?.(connSnap);
        setTestStatus(dbStatusEl, 'ok', '✓ Connected successfully');
      } catch (err) {
        setTestStatus(dbStatusEl, 'error', '✗ ' + err.message);
      }
    });
    dbTestRow.append(dbTestBtn, dbStatusEl);
    footer.appendChild(dbTestRow);

    footer.appendChild(btn(isNew ? 'Add connection' : 'Save', 'btn-primary', () => {
      const conn = {
        name:     nameEl.value.trim(),
        type:     typeEl.value,
        host:     hostEl.value.trim() || 'localhost',
        port:     parseInt(portEl.value, 10) || (typeEl.value === 'mysql' ? 3306 : 5432),
        database: dbEl.value.trim(),
        user:     userEl.value.trim(),
        password: pwEl.value,
        color:    selectedColor,
        readOnly: roCheck.checked,
        ssh: sshCheck.checked ? {
          host:              sshHostEl.value.trim(),
          port:              parseInt(sshPortEl.value, 10) || 22,
          user:              sshUserEl.value.trim(),
          privateKeyPath:    sshKeyContent ? undefined : sshKeyEl.value.trim(),
          privateKeyContent: sshKeyContent || undefined,
          passphrase:        sshPassEl.value || undefined,
        } : undefined,
      };
      if (!conn.name) { errEl.textContent = 'Name is required.'; return; }
      if (!conn.user) { errEl.textContent = 'Username is required.'; return; }
      if (conn.ssh) {
        if (!conn.ssh.host) { errEl.textContent = 'SSH Host is required.'; return; }
        if (!conn.ssh.user) { errEl.textContent = 'SSH User is required.'; return; }
        if (!conn.ssh.privateKeyContent && !conn.ssh.privateKeyPath) { errEl.textContent = 'SSH Key is required.'; return; }
      }

      if (isNew) this._config.connections.push(conn);
      else       this._config.connections[this._editIdx] = conn;

      this._editIdx = null;
      this._render();
    }));
    this._body.appendChild(footer);
  }

  _renderExport() {
    const { connections } = this._config;
    const form = el('div', 'settings-form');

    // ── Connection checkboxes ──
    const pickSection = el('div', 'export-conn-list');
    const checks = connections.map((c) => {
      const row  = el('label', 'export-conn-row');
      const chk  = document.createElement('input');
      chk.type    = 'checkbox';
      chk.checked = true;
      const dot  = el('span', 'conn-dot');
      dot.style.background = c.color ?? CONN_COLORS[0];
      const name = text('span', c.name, 'export-conn-name');
      const sub  = text('span', `${c.type} · ${c.host}`, 'settings-conn-sub');
      row.append(chk, dot, name, sub);
      pickSection.appendChild(row);
      return { chk, conn: c };
    });

    // Select all / none toggle
    const toggleRow = el('div', 'export-toggle-row');
    const toggleAll = btn('Select all', 'btn-sm', () => {
      const allOn = checks.every(({ chk }) => chk.checked);
      checks.forEach(({ chk }) => { chk.checked = !allOn; });
      toggleAll.textContent = allOn ? 'Select all' : 'Select none';
      updateInfo();
    });
    toggleRow.appendChild(toggleAll);
    pickSection.prepend(toggleRow);

    // ── Passphrase ──
    const pw1El   = input('password', '', 'Passphrase');
    const pw1Wrap = el('div', 'settings-pw-wrap');
    pw1Wrap.append(pw1El, _eyeBtn(pw1El));

    const pw2El   = input('password', '', 'Confirm passphrase');
    const pw2Wrap = el('div', 'settings-pw-wrap');
    pw2Wrap.append(pw2El, _eyeBtn(pw2El));

    // ── Info box (updates with selection) ──
    const info = el('div', 'settings-info-box');
    const updateInfo = () => {
      const selected = checks.filter(({ chk }) => chk.checked);
      const hasKeys  = selected.some(({ conn }) => conn.ssh?.privateKeyContent);
      info.innerHTML =
        `<strong>${selected.length}</strong> of ${connections.length} connection${connections.length !== 1 ? 's' : ''} selected` +
        (hasKeys ? ', including stored SSH keys' : '') +
        '.<br>Share the <code>.tabdbpro</code> file freely — share the passphrase through a separate secure channel (Signal, phone call).';
    };
    checks.forEach(({ chk }) => chk.addEventListener('change', updateInfo));
    updateInfo();

    form.append(
      field('Connections', pickSection),
      field('Passphrase',  pw1Wrap),
      field('Confirm',     pw2Wrap),
      field('',            info),
    );
    this._body.appendChild(form);

    const errEl = el('div', 'save-modal-error settings-form-error');
    this._body.appendChild(errEl);

    const footer = el('div', 'settings-footer');
    footer.appendChild(btn('← Back', 'btn-sm', () => { this._editIdx = null; this._render(); }));
    footer.appendChild(btn('Download .tabdbpro', 'btn-primary', async () => {
      const selected = checks.filter(({ chk }) => chk.checked).map(({ conn }) => conn);
      if (selected.length === 0)      { errEl.textContent = 'Select at least one connection.'; return; }
      const passphrase = pw1El.value;
      if (!passphrase)                { errEl.textContent = 'Passphrase is required.'; return; }
      if (passphrase !== pw2El.value) { errEl.textContent = 'Passphrases do not match.'; return; }
      errEl.textContent = '';
      try {
        const blob = new Blob([await encryptConnections(selected, passphrase)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(blob),
          download: 'connections.tabdbpro',
        });
        a.click();
        URL.revokeObjectURL(a.href);
        this._editIdx = null;
        this._render();
      } catch (err) {
        errEl.textContent = '✗ ' + err.message;
      }
    }));
    this._body.appendChild(footer);
  }

  _renderImport() {
    const form = el('div', 'settings-form');

    const fileInfo = el('div', 'settings-info-box');
    fileInfo.innerHTML = `<strong>File:</strong> ${this._importFileName}`;

    const pwEl  = input('password', '', 'Passphrase');
    const pwWrap = el('div', 'settings-pw-wrap');
    pwWrap.append(pwEl, _eyeBtn(pwEl));

    const info = el('div', 'settings-info-box');
    info.textContent = 'Connections with the same name will be updated. New connections will be added.';

    form.append(field('', fileInfo), field('Passphrase', pwWrap), field('', info));
    this._body.appendChild(form);

    const errEl = el('div', 'save-modal-error settings-form-error');
    this._body.appendChild(errEl);

    const footer = el('div', 'settings-footer');
    footer.appendChild(btn('← Back', 'btn-sm', () => { this._editIdx = null; this._render(); }));
    footer.appendChild(btn('Import', 'btn-primary', async () => {
      const passphrase = pwEl.value;
      if (!passphrase) { errEl.textContent = 'Passphrase is required.'; return; }
      try {
        const imported = await decryptConnections(this._importFileContent, passphrase);
        for (const conn of imported) {
          const idx = this._config.connections.findIndex(c => c.name === conn.name);
          if (idx >= 0) this._config.connections[idx] = conn;
          else          this._config.connections.push(conn);
        }
        this._importFileContent = null;
        this._importFileName    = '';
        this._editIdx = null;
        this._render();
      } catch (err) {
        errEl.textContent = '✗ ' + err.message;
      }
    }));
    this._body.appendChild(footer);
  }

  _typeSelect(current) {
    const sel = document.createElement('select');
    sel.className = 'modal-input';
    for (const t of ['postgres', 'mysql']) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t; o.selected = current === t;
      sel.appendChild(o);
    }
    return sel;
  }
}

// ── Icons ──
const SVG_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

const SVG_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

// ── DOM helpers ──
function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
function text(tag, content, className) {
  const e = el(tag, className);
  e.textContent = content;
  return e;
}
function btn(label, className, onClick) {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
function input(type, value, placeholder) {
  const i = document.createElement('input');
  i.type = type;
  i.className = 'modal-input';
  i.value = value ?? '';
  i.placeholder = placeholder ?? '';
  return i;
}
function field(label, control) {
  const row = el('div', 'settings-field');
  const lbl = text('label', label, 'settings-field-label');
  row.append(lbl, control);
  return row;
}

function setTestStatus(el, state, message) {
  el.className = `test-status test-status-${state}`;
  el.textContent = message;
}

function _eyeBtn(inputEl) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn pw-eye-btn';
  b.title = 'Show/hide';
  b.innerHTML = SVG_EYE;
  b.addEventListener('click', () => {
    const show = inputEl.type === 'password';
    inputEl.type = show ? 'text' : 'password';
    b.innerHTML  = show ? SVG_EYE_OFF : SVG_EYE;
  });
  return b;
}
