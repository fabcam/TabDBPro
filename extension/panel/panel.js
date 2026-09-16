import { BridgeClient } from './components/bridge.js';
import { ResultsTable } from './components/results.js';
import { QueryHistory } from './components/history.js';
import { SchemaTree } from './components/schema.js';
import { ContextMenu } from './components/context-menu.js';
import { ConnectionSelector } from './components/connection-selector.js';
import { EditorTabs } from './components/editor-tabs.js';
import { SavedQueries } from './components/saved-queries.js';
import { Settings, CONN_COLORS } from './components/settings.js';
import { NetworkRequests } from './components/network-requests.js';
import { makeResizable }     from './components/resize.js';
import { SqlAutocomplete }  from './components/autocomplete.js';
import { ERDiagram }        from './components/erd.js';
import { EXPORT_META, guessTableName } from './components/export-results.js';
import { buildPivot, guessValueField } from './components/pivot.js';
import { requestUnlock } from './components/biometric.js';

const BRIDGE_URL = 'http://127.0.0.1:47321';
const bridge = new BridgeClient(BRIDGE_URL);

const LAST_CONN_KEY = 'last_connection';

// ── Theme (sigue al sistema por defecto; si el usuario elige, se persiste) ──
const THEME_KEY = 'tabdb_theme';
const systemTheme = () => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
const effectiveTheme = () => storedTheme() || systemTheme();
function applyTheme() {
  const t = storedTheme();
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;   // sin override → sigue al sistema
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = effectiveTheme() === 'light' ? '☀️' : '🌙';
}
applyTheme();
document.getElementById('btn-theme').addEventListener('click', () => {
  const next = effectiveTheme() === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme();
});
// Cambios del sistema solo afectan si no hay override manual guardado.
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (!storedTheme()) applyTheme();
});

// ── DOM refs ──
const editor = document.getElementById('editor');
const btnRun = document.getElementById('btn-run');
const btnRunAll = document.getElementById('btn-run-all');
const btnSaveQuery = document.getElementById('btn-save-query');
const selectLimit = document.getElementById('select-limit');
const statusDot = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const resultsMeta     = document.getElementById('results-meta');
const resultsMetaText = document.getElementById('results-meta-text');
const btnPivot        = document.getElementById('btn-pivot');
const pivotBar        = document.getElementById('pivot-bar');
const pivotRowSel     = document.getElementById('pivot-row');
const pivotRow2Sel    = document.getElementById('pivot-row2');
const pivotRow3Sel    = document.getElementById('pivot-row3');
const pivotColSel     = document.getElementById('pivot-col');
const pivotValSel     = document.getElementById('pivot-val');
const pivotAggSel     = document.getElementById('pivot-agg');
const resultsEmpty = document.getElementById('results-empty');
const resultsLoading = document.getElementById('results-loading');
const resultsError = document.getElementById('results-error');
const resultsTabs = document.getElementById('results-tabs');
const btnRefreshSchema = document.getElementById('btn-refresh-schema');
const btnClearHistory = document.getElementById('btn-clear-history');
const errorModal = document.getElementById('error-modal');
const modalMessage = document.getElementById('modal-message');
const saveModal = document.getElementById('save-modal');
const saveQueryName = document.getElementById('save-query-name');
const saveQueryConfirm = document.getElementById('save-query-confirm');
const saveModalError = document.getElementById('save-modal-error');
const btnSettings = document.getElementById('btn-settings');
const connBadge   = document.getElementById('conn-badge');
const btnNetwork  = document.getElementById('btn-network');
const editorTabsEl = document.getElementById('editor-tabs');
const networkPanel = document.getElementById('network-panel');

// ── Error modal ──
document.getElementById('modal-close').addEventListener('click', () => errorModal.classList.add('hidden'));
errorModal.addEventListener('click', (e) => { if (e.target === errorModal) errorModal.classList.add('hidden'); });

function showErrorModal(message) {
  modalMessage.textContent = message;
  errorModal.classList.remove('hidden');
}

// ── Save query modal ──
document.getElementById('save-modal-close').addEventListener('click', () => saveModal.classList.add('hidden'));
saveModal.addEventListener('click', (e) => { if (e.target === saveModal) saveModal.classList.add('hidden'); });

function openSaveModal() {
  editorTabs.syncFromEditor();
  if (!editor.value.trim()) return;

  const savedId = editorTabs.activeSavedId;
  if (savedId) {
    savedQueries.update(savedId, editor.value.trim());
    const orig = btnSaveQuery.textContent;
    btnSaveQuery.textContent = '✓';
    setTimeout(() => { btnSaveQuery.textContent = orig; }, 1200);
    return;
  }

  saveQueryName.value = editorTabs.activeTab?.label ?? '';
  saveModalError.textContent = '';
  saveModal.classList.remove('hidden');
  saveQueryName.focus();
  saveQueryName.select();
}

btnSaveQuery.addEventListener('click', openSaveModal);

const doSaveQuery = async () => {
  const name = saveQueryName.value.trim();
  if (!name) { saveQueryName.focus(); return; }
  if (!currentConnection || !currentDatabase) {
    saveModalError.textContent = 'Select a database first to save queries.';
    return;
  }
  const savedId = await savedQueries.save(name, editor.value.trim());
  if (savedId) editorTabs.updateActiveTab(name, savedId);
  saveModal.classList.add('hidden');
};

saveQueryConfirm.addEventListener('click', doSaveQuery);
saveQueryName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); doSaveQuery(); }
});

// ── Editor tabs ──
const editorTabs = new EditorTabs({
  containerEl: document.getElementById('editor-tabs'),
  editor,
});

// ── Results table ──
const resultsTable = new ResultsTable(
  document.getElementById('results-head'),
  document.getElementById('results-body')
);

// ── Query history ──
const history = new QueryHistory(
  document.getElementById('history-list'),
  (sql) => { editor.value = sql; editorTabs.syncFromEditor(); editor.focus(); }
);

// ── Saved queries ──
const savedQueries = new SavedQueries({
  listEl: document.getElementById('saved-query-list'),
  onLoad: (sql, name, savedId) => editorTabs.openQuery(sql, name, savedId),
});

// ── Settings ──
const settings = new Settings({
  modalEl: document.getElementById('settings-modal'),
  bodyEl: document.getElementById('settings-body'),
  onTestSsh: (ssh)        => bridge.testSsh(ssh),
  onTestDb:  (connection) => bridge.testDb(connection),
  onApply: async (cfg) => {
    bridgeWasConnected = false;
    clearTableMetaCache();
    showState('empty');
    resultsMeta.classList.add('hidden');
    try { await bridge.configure(cfg); } catch {}
    await checkHealth();
  },
});
document.getElementById('settings-modal-close').addEventListener('click', () => settings.close());
btnSettings.addEventListener('click', () => settings.open());
await settings.load();

// ── Network requests ──
const nqModal = document.getElementById('nq-modal');
document.getElementById('nq-cancel-x').addEventListener('click', () => nqModal.classList.add('hidden'));

const networkRequests = new NetworkRequests({
  panelEl:        networkPanel,
  modalEl:        nqModal,
  getTableNames:  () => schema.tableNames,
  getTableSchema: (name) => bridge.tableSchema(name),
  getDbType:      () => dbType,
  onOpenQuery:    (sql, autoRun) => {
    editorTabs.openQuery(sql, 'Network query');
    if (autoRun) runQuery();
  },
});

btnNetwork.addEventListener('click', () => {
  const hidden = networkPanel.classList.toggle('hidden');
  btnNetwork.classList.toggle('active', !hidden);
});

const netPrefixEl = document.getElementById('net-prefix');
netPrefixEl.addEventListener('input', () => networkRequests.setPrefix(netPrefixEl.value));

if (typeof chrome !== 'undefined' && chrome.devtools?.network) {
  chrome.devtools.network.onRequestFinished.addListener((entry) => {
    networkRequests.add(entry);
  });
}

// ── Write mode state ──
let isReadOnly = true;
let dbType = 'postgres';
let lastSql = '';
let currentConnection = '';
let currentDatabase = '';
const tableMetaCache = new Map();

// ── Desbloqueo biométrico (Touch ID) opt-in por conexión ──
const unlockedConnections = new Set();   // conexiones desbloqueadas en esta sesión
function connRequiresBio(name) {
  return !!settings.config.connections.find(c => c.name === name)?.requireBiometric;
}
// Garantiza que la conexión esté desbloqueada (una vez por sesión). Devuelve bool.
async function ensureUnlocked(name) {
  if (!name || !connRequiresBio(name)) return true;
  if (unlockedConnections.has(name)) return true;
  const ok = await requestUnlock();
  if (ok) unlockedConnections.add(name);
  return ok;
}

function clearTableMetaCache() { tableMetaCache.clear(); }

async function getTableMeta(tableName) {
  if (tableMetaCache.has(tableName)) return tableMetaCache.get(tableName);
  try {
    const { indexes } = await bridge.tableIndexes(tableName);
    const pk = indexes.find(i => i.type === 'PRIMARY KEY');
    const pkCols = pk ? pk.columns.split(',').map(s => s.trim()) : [];

    // Mapa de columnas enum → opciones (para mostrar <select> al editar/insertar).
    const enumMap = new Map();
    try {
      const { columns } = await bridge.tableSchema(tableName);
      for (const c of columns) if (c.enumValues?.length) enumMap.set(c.column_name, c.enumValues);
    } catch { /* sin schema → sin enums */ }

    const fkMap = new Map();
    for (const idx of indexes) {
      if (idx.type !== 'FOREIGN KEY') continue;
      const m = idx.index_type.match(/→\s*(\w+)\s*\(([^)]+)\)/);
      if (!m) continue;
      const localCols = idx.columns.split(',').map(s => s.trim());
      const refTable = m[1];
      const refCols = m[2].split(',').map(s => s.trim());
      localCols.forEach((col, i) => {
        if (!pkCols.includes(col))
          fkMap.set(col, { refTable, refCol: refCols[i] ?? refCols[0] });
      });
    }

    const meta = { pkCols, fkMap, enumMap };
    tableMetaCache.set(tableName, meta);
    return meta;
  } catch { return { pkCols: [], fkMap: new Map(), enumMap: new Map() }; }
}

// ── Tab system (results) ──
const tabStore = [];
let activeTabId = null;
let tabIdSeq = 0;

function _setMainTab(fields, rows, editable, callbacks, fkMap, metaText, keepFkTabs = false) {
  const fkTabs = keepFkTabs ? tabStore.filter(t => t.id !== 0) : [];
  tabStore.length = 0;
  tabStore.push({ id: 0, label: 'Main', fields, rows, editable, callbacks, fkMap, metaText });
  tabStore.push(...fkTabs);
  activeTabId = 0;
  _refreshTabBar();
  _renderActiveTab();
}

function _switchTab(id) {
  _pivotOff();
  activeTabId = id;
  _refreshTabBar();
  _renderActiveTab();
}

function _closeTab(id) {
  const idx = tabStore.findIndex(t => t.id === id);
  if (idx < 0) return;
  tabStore.splice(idx, 1);
  if (activeTabId === id)
    activeTabId = tabStore[Math.max(0, idx - 1)]?.id ?? tabStore[0]?.id ?? null;
  _refreshTabBar();
  _renderActiveTab();
}

function _refreshTabBar() {
  const hasFkTabs = tabStore.some(t => t.id !== 0);
  resultsTabs.classList.toggle('hidden', !hasFkTabs);
  resultsTabs.innerHTML = '';
  if (!hasFkTabs) return;

  for (const tab of tabStore) {
    const el = document.createElement('div');
    el.className = 'results-tab' + (tab.id === activeTabId ? ' active' : '');

    const labelEl = document.createElement('span');
    labelEl.textContent = tab.label;
    labelEl.addEventListener('click', () => _switchTab(tab.id));
    el.appendChild(labelEl);

    if (tab.id !== 0) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); _closeTab(tab.id); });
      el.appendChild(closeBtn);
    }

    resultsTabs.appendChild(el);
  }
}

function _renderActiveTab() {
  const tab = tabStore.find(t => t.id === activeTabId);
  if (!tab) { showState('empty'); resultsMeta.classList.add('hidden'); return; }

  // Pivot mode (vista de solo lectura; funciona también sobre resultados editables)
  if (pivotActive) {
    const result = buildPivot(tab.fields, tab.rows, {
      rowCol:   [...new Set([pivotRowSel.value, pivotRow2Sel.value, pivotRow3Sel.value].filter(Boolean))],
      colCol:   pivotColSel.value,
      valueCol: pivotValSel.value,
      agg:      pivotAggSel.value,
    });
    if (result) {
      resultsTable.render(result.pivotFields, result.pivotRows, { blankRepeatCols: result.rowColCount });
      resultsMetaText.textContent = `${tab.metaText} · pivot ${result.stats}`;
      resultsMeta.classList.remove('hidden');
      showState('table');
      return;
    }
  }

  if (tab.editable && tab.callbacks) {
    resultsTable.renderEditable(tab.fields, tab.rows, tab.callbacks);
  } else {
    resultsTable.render(tab.fields, tab.rows, { fkMap: tab.fkMap, onFkClick: handleFkClick });
  }
  resultsMetaText.textContent = tab.metaText;
  btnPivot.disabled = false;
  resultsMeta.classList.remove('hidden');
  showState('table');
}

async function handleFkClick(refTable, refCol, value) {
  try {
    const fkSql = `SELECT * FROM ${quoteId(refTable)} WHERE ${quoteId(refCol)} = ${placeholder(1)}`;
    const result = await bridge.query(fkSql, [value]);
    const { pkCols, fkMap, enumMap } = await getTableMeta(refTable);

    const tabId = ++tabIdSeq;
    const rowCount = (r) => `${r.rowCount} row${r.rowCount !== 1 ? 's' : ''} · ${r.durationMs}ms`;

    const reloadFkTab = async () => {
      try {
        const r = await bridge.query(fkSql, [value]);
        const tab = tabStore.find(t => t.id === tabId);
        if (!tab) return;
        tab.fields = r.fields;
        tab.rows = r.rows;
        tab.metaText = tab.editable ? `${rowCount(r)} · ✎ editable` : rowCount(r);
        if (activeTabId === tabId) _renderActiveTab();
      } catch {}
    };

    let editable = false;
    let callbacks = null;
    let metaText = rowCount(result);

    if (!isReadOnly) {
      editable = true;
      metaText = `${metaText} · ✎ editable`;
      callbacks = {
        onUpdate: (fieldName, parsed, snapshot) =>
          handleUpdate(refTable, result.fields, fieldName, parsed, snapshot, pkCols),
        onInsert: (fields, values) => handleInsert(refTable, fields, values, reloadFkTab),
        onError: handleWriteError,
        onReload: reloadFkTab,
        onFkClick: handleFkClick,
        fkMap,
        enumMap,
      };
    }

    tabStore.push({ id: tabId, label: `${refTable} · ${value}`, fields: result.fields, rows: result.rows, editable, callbacks, fkMap, metaText });
    activeTabId = tabId;
    _refreshTabBar();
    _renderActiveTab();
  } catch (err) {
    showErrorModal(err.message);
  }
}

// ── Context menu ──
const contextMenu = new ContextMenu(document.getElementById('table-context-menu'));

// Al abrir una tabla, si tiene una columna de fecha de creación, ordenar por ella desc.
const CREATED_COLS = ['created_at', 'createdat', 'created'];
async function buildTableSelect(tableName) {
  let orderBy = '';
  try {
    const res = await bridge.tableSchema(tableName);
    const byLower = new Map((res?.columns || []).map((c) => [String(c.column_name).toLowerCase(), c.column_name]));
    for (const cand of CREATED_COLS) {
      if (byLower.has(cand)) { orderBy = `\nORDER BY ${quoteId(byLower.get(cand))} DESC`; break; }
    }
  } catch { /* sin schema → sin order by */ }
  return `SELECT *\nFROM ${tableName}${orderBy}\nLIMIT 100;`;
}
async function openTableSelect(tableName) {
  editorTabs.openQuery(await buildTableSelect(tableName), tableName);
  runQuery();
}

contextMenu
  .on('describe', ({ tableName }) => describeTable(tableName))
  .on('indexes',  ({ tableName }) => showIndexes(tableName))
  .on('select',   ({ tableName }) => openTableSelect(tableName))
  .on('copy', ({ tableName }) => navigator.clipboard.writeText(tableName));

// ── Pivot table ──
let pivotActive = false;

function _pivotOn() {
  const tab = tabStore.find(t => t.id === activeTabId);
  if (!tab) return;
  // Populate selects with current tab's field names
  const opts = tab.fields.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
  pivotRowSel.innerHTML = opts;
  pivotRow2Sel.innerHTML = '<option value="">(none)</option>' + opts;   // Row 2/3 opcionales
  pivotRow3Sel.innerHTML = '<option value="">(none)</option>' + opts;
  pivotColSel.innerHTML = opts;
  pivotValSel.innerHTML = opts;
  if (tab.fields.length > 0) pivotRowSel.value = tab.fields[0].name;
  pivotRow2Sel.value = '';
  pivotRow3Sel.value = '';
  if (tab.fields.length > 1) pivotColSel.value = tab.fields[1].name;
  const valGuess = guessValueField(tab.fields) ?? (tab.fields[2] ?? tab.fields[0])?.name;
  if (valGuess) pivotValSel.value = valGuess;
  pivotActive = true;
  pivotBar.classList.remove('hidden');
  btnPivot.classList.add('active');
  _renderActiveTab();
}

function _pivotOff() {
  pivotActive = false;
  pivotBar.classList.add('hidden');
  btnPivot.classList.remove('active');
  _renderActiveTab();
}

btnPivot.addEventListener('click', () => pivotActive ? _pivotOff() : _pivotOn());

// ── Export de resultados (CSV / JSON / INSERT) ──
const btnExport = document.getElementById('btn-export');
const exportMenu = new ContextMenu(document.getElementById('export-menu'));
btnExport.addEventListener('click', (e) => {
  e.stopPropagation();   // evita que el listener global de document cierre el menú al instante
  const r = btnExport.getBoundingClientRect();
  exportMenu.show(r.left, r.bottom + 2, {});
});
for (const fmt of Object.keys(EXPORT_META)) exportMenu.on(fmt, () => downloadExport(fmt));

function downloadExport(fmt) {
  const tab = tabStore.find(t => t.id === activeTabId);
  if (!tab || !tab.fields || !tab.rows) return;
  const { ext, mime, fn } = EXPORT_META[fmt];
  const table = guessTableName(lastSql) || 'result';
  const content = fmt === 'insert'
    ? fn(tab.fields, tab.rows, table, dbType)
    : fn(tab.fields, tab.rows);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${table}_${date}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}
[pivotRowSel, pivotRow2Sel, pivotRow3Sel, pivotColSel, pivotValSel, pivotAggSel].forEach(s =>
  s.addEventListener('change', () => { if (pivotActive) _renderActiveTab(); })
);

// ── Database context menu ──
const dbContextMenu = new ContextMenu(document.getElementById('db-context-menu'));

dbContextMenu.on('dump', async ({ dbName }) => {
  const prevDotClass = statusDot.className;
  const prevText = statusText.textContent;
  statusDot.className = 'status-dot checking';
  statusText.textContent = `Generating dump for ${dbName}…`;
  try {
    const blob = await bridge.dumpDatabase(dbName);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const connCamel = currentConnection
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join('');
    const filename = `${date}_${dbName}_${connCamel}.sql`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showErrorModal(err.message);
  } finally {
    statusDot.className = prevDotClass;
    statusText.textContent = prevText;
  }
});

dbContextMenu.on('erd', async ({ dbName }) => {
  try {
    // El diagrama grafica el schema de la base activa: si se pidió otra, cambiamos primero.
    if (dbName !== schema.currentDb) {
      await bridge.useDatabase(dbName);
      await schema.load(bridge);
      currentDatabase = schema.currentDb ?? dbName;
      savedQueries.setContext(currentConnection, currentDatabase);
    }
    erd.open();
  } catch (err) {
    showErrorModal(err.message);
  }
});

// ── Connection color helpers ──
function getConnColor(name) {
  const c = settings.config.connections.find(c => c.name === name);
  return c?.color ?? CONN_COLORS[0];
}

function updateConnBadge(name, color) {
  if (!name) { connBadge.classList.add('hidden'); return; }
  connBadge.classList.remove('hidden');
  connBadge.innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'conn-badge-dot';
  dot.style.background = color;
  const label = document.createElement('span');
  label.textContent = name;
  connBadge.append(dot, label);
  editorTabsEl.style.setProperty('--conn-color', color);
}

// ── Connection selector ──
const connectionSelector = new ConnectionSelector({
  sectionEl: document.getElementById('connection-section'),
  listEl: document.getElementById('connection-list'),
  getColor: (name) => getConnColor(name),
  beforeSwitch: (name) => ensureUnlocked(name),   // Touch ID si la conexión lo requiere
  onSwitchStart: () => schema.clear(),            // limpia bases/tablas ya, sin esperar el fetch
  onSwitch: async (name) => {
    clearTableMetaCache();
    showState('empty');
    resultsMeta.classList.add('hidden');
    currentConnection = name ?? '';
    updateConnBadge(currentConnection, getConnColor(currentConnection));
    if (name) chrome.storage.local.set({ [LAST_CONN_KEY]: name });
    try { const h = await bridge.health(); isReadOnly = h.readOnly; dbType = h.db?.type ?? dbType; } catch {}
    schema.load(bridge).then(() => {
      currentDatabase = schema.currentDb ?? '';
      savedQueries.setContext(currentConnection, currentDatabase);
    });
  },
});

// ── Schema tree ──
const schema = new SchemaTree({
  dbListEl: document.getElementById('db-list'),
  tableListEl: document.getElementById('table-list'),
  dbLabelEl: document.getElementById('db-label'),
  onTableClick: (tableName) => openTableSelect(tableName),
  onDescribeTable: ({ tableName, x, y }) => {
    contextMenu.show(x, y, { tableName });
  },
  onDbContextMenu: ({ dbName, x, y }) => {
    dbContextMenu.show(x, y, { dbName });
  },
  onDatabaseSwitch: (db) => {
    clearTableMetaCache();
    showState('empty');
    resultsMeta.classList.add('hidden');
    currentDatabase = db;
    savedQueries.setContext(currentConnection, currentDatabase);
    erd.hasContent = false;   // diagrama de la base anterior queda obsoleto
    erd.hide();               // oculta y esconde el botón (se recarga al reabrir del menú)
  },
});

// ── Schema diagram (ER) ──
const btnErdToggle = document.getElementById('btn-erd-toggle');
function syncErdToggle() {
  // El botón aparece una vez que el diagrama tiene contenido; refleja si está visible.
  btnErdToggle.classList.toggle('hidden', !(erd.visible || erd.hasContent));
  btnErdToggle.classList.toggle('active', erd.visible);
}

const erd = new ERDiagram({
  panelEl: document.getElementById('erd-panel'),
  fetchGraph: () => bridge.schemaGraph(),
  getContext: () => ({ connection: currentConnection, database: currentDatabase }),
  onVisibilityChange: () => syncErdToggle(),
  onSelectTable: (tableName) => {
    // Abre la query en una pestaña nueva y OCULTA el diagrama (para ver el resultado).
    // El diagrama queda intacto: se reabre con el botón ⬡ del toolbar, sin recargar.
    openTableSelect(tableName);
    erd.hide();
  },
});
btnErdToggle.addEventListener('click', () => erd.toggle());

// ── Health check ──
let bridgeWasConnected = false;

let settingsAutoOpened = false;

async function checkHealth() {
  setStatus('checking', 'Connecting to bridge...');
  try {
    // Capture before any await so we know if this is an (re)connect or a steady-state poll.
    const reconnecting = !bridgeWasConnected;

    // On first connect / reconnect: push config and restore last-used connection.
    if (reconnecting && settings.config.connections.length > 0) {
      try { await bridge.configure(settings.config); } catch {}
      const stored = await chrome.storage.local.get(LAST_CONN_KEY);
      const lastConn = stored[LAST_CONN_KEY];
      if (lastConn && settings.config.connections.some(c => c.name === lastConn)) {
        try { await bridge.useConnection(lastConn); } catch {}
      }
    }

    const data = await bridge.health();

    if (data.status === 'unconfigured') {
      setStatus('disconnected', 'Not configured — click ⚙ to add a connection');
      if (!settingsAutoOpened) { settingsAutoOpened = true; settings.open(); }
      return;
    }

    isReadOnly = data.readOnly;
    dbType = data.db.type;
    const writeLabel = isReadOnly ? 'read-only' : '✎ write';
    setStatus('connected', `${data.db.type} · ${writeLabel}`);

    // Only sync connection identity from the bridge on (re)connect.
    // During steady-state polling we trust the locally-tracked value to avoid
    // a race where a stale health response overwrites a user-initiated switch.
    if (reconnecting) {
      currentConnection = data.connection ?? '';
      updateConnBadge(currentConnection, getConnColor(currentConnection));
    }

    if (!bridgeWasConnected) {
      bridgeWasConnected = true;
      connectionSelector.load(bridge);
      loadActiveConnectionData();
    }
  } catch {
    bridgeWasConnected = false;
    setStatus('disconnected', 'Bridge not running — cd bridge && npm start');
    updateConnBadge(null, null);
    editorTabsEl.style.removeProperty('--conn-color');
  }
}

// Carga el schema de la conexión activa, pidiendo Touch ID si está bloqueada.
const btnUnlock = document.getElementById('btn-unlock');
async function loadActiveConnectionData() {
  if (!(await ensureUnlocked(currentConnection))) {
    btnUnlock.classList.remove('hidden');
    setStatus('disconnected', '🔒 Bloqueado — Touch ID requerido');
    showState('empty');
    return;
  }
  btnUnlock.classList.add('hidden');
  schema.load(bridge).then(() => {
    currentDatabase = schema.currentDb ?? '';
    savedQueries.setContext(currentConnection, currentDatabase);
  });
}
btnUnlock.addEventListener('click', () => loadActiveConnectionData());

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text;
}

// ── Query at cursor ──
function getQueryAtCursor(sql, cursorPos) {
  let pos = cursorPos;
  while (pos > 0 && /\s/.test(sql[pos - 1])) pos--;
  if (pos > 0 && sql[pos - 1] === ';') pos--;

  let start = 0;
  for (let i = pos - 1; i >= 0; i--) {
    if (sql[i] === ';') { start = i + 1; break; }
  }
  let end = sql.length;
  for (let i = pos; i < sql.length; i++) {
    if (sql[i] === ';') { end = i; break; }
  }
  return sql.slice(start, end).trim();
}

function buildSql() {
  const { selectionStart, selectionEnd, value } = editor;
  let sql = selectionStart !== selectionEnd
    ? value.slice(selectionStart, selectionEnd).trim()
    : getQueryAtCursor(value, selectionStart);
  if (!sql) return '';
  const limit = parseInt(selectLimit.value, 10);
  if (limit > 0 && /^\s*SELECT\b/i.test(sql) && !/\bLIMIT\b/i.test(sql)) {
    sql = sql.replace(/;?\s*$/, '') + `\nLIMIT ${limit}`;
  }
  return sql;
}

// ── Detect source table ──
function detectSourceTable(sql) {
  const clean = sql.trim().replace(/;?\s*$/, '');
  if (/\b(JOIN|GROUP\s+BY|HAVING|UNION)\b/i.test(clean)) return null;
  const m = clean.match(/^SELECT\b.+?\bFROM\s+[`"']?(\w+)[`"']?/is);
  return m ? m[1] : null;
}

function quoteId(name) {
  return dbType === 'postgres' ? `"${name}"` : `\`${name}\``;
}
function placeholder(i) {
  return dbType === 'postgres' ? `$${i}` : '?';
}

// ── Update / Insert ──
async function handleUpdate(tableName, fields, fieldName, parsed, snapshot, pkCols) {
  const params = [];
  let setClause;
  if (parsed.kind === 'expr') {
    setClause = `${quoteId(fieldName)} = ${parsed.value}`;
  } else {
    params.push(parsed.value);
    setClause = `${quoteId(fieldName)} = ${placeholder(1)}`;
  }

  let where;
  if (pkCols.length > 0) {
    where = pkCols.map(pk => {
      const i = fields.findIndex(f => f.name === pk);
      params.push(snapshot[i]);
      return `${quoteId(pk)} = ${placeholder(params.length)}`;
    }).join(' AND ');
  } else {
    where = fields.map((f, i) => {
      if (snapshot[i] === null) return `${quoteId(f.name)} IS NULL`;
      params.push(snapshot[i]);
      return `${quoteId(f.name)} = ${placeholder(params.length)}`;
    }).join(' AND ');
  }
  const sql = `UPDATE ${quoteId(tableName)} SET ${setClause} WHERE ${where}`;
  await ensureBridgeContext();
  if (currentConfirmWrites() && !(await confirmWrite(sql, params))) throw new Error(WRITE_CANCELLED);
  await bridge.query(sql, params);
}

function parseInsertValue(raw) {
  if (raw === null || raw.trim() === '') return { kind: 'omit' };
  const v = raw.trim();
  if (/^null$/i.test(v))          return { kind: 'param', value: null };
  if (/^\w+\(.*\)$/.test(v))      return { kind: 'expr',  value: v };
  if (/^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i.test(v))
                                   return { kind: 'expr',  value: v };
  return { kind: 'param', value: raw };
}

async function handleInsert(tableName, fields, values, reloadFn = reloadResults) {
  const items = fields
    .map((f, i) => ({ f, parsed: parseInsertValue(values[i] ?? null) }))
    .filter(({ parsed }) => parsed.kind !== 'omit');

  if (items.length === 0) throw new Error('At least one field must have a value');

  const cols = items.map(({ f }) => quoteId(f.name)).join(', ');
  const params = [];
  const placeholders = items.map(({ parsed }) => {
    if (parsed.kind === 'expr') return parsed.value;
    params.push(parsed.value);
    return placeholder(params.length);
  }).join(', ');

  const sql = `INSERT INTO ${quoteId(tableName)} (${cols}) VALUES (${placeholders})`;
  await ensureBridgeContext();
  if (currentConfirmWrites() && !(await confirmWrite(sql, params))) throw new Error(WRITE_CANCELLED);
  await bridge.query(sql, params);
  await reloadFn();
}

async function reloadResults() {
  if (!lastSql) return;
  try {
    const result = await bridge.query(lastSql);
    await renderResults(result, lastSql, true);
  } catch { /* ignore reload errors */ }
}

// ── Confirmación de escritura (modo "Ask before writes" por conexión) ──
const WRITE_CANCELLED = '__write_cancelled__';   // sentinel: usuario canceló, no mostrar error
const handleWriteError = (msg) => { if (msg !== WRITE_CANCELLED) showErrorModal(msg); };
const confirmModal    = document.getElementById('confirm-modal');
const confirmSqlEl    = document.getElementById('confirm-sql');
const confirmParamsEl = document.getElementById('confirm-params');
const confirmRunBtn   = document.getElementById('confirm-run');
let _confirmResolve = null;
function _closeConfirm(result) {
  confirmModal.classList.add('hidden');
  const r = _confirmResolve; _confirmResolve = null;
  if (r) r(result);
}
confirmRunBtn.addEventListener('click', () => _closeConfirm(true));
document.getElementById('confirm-cancel').addEventListener('click', () => _closeConfirm(false));
document.getElementById('confirm-close').addEventListener('click', () => _closeConfirm(false));
// Enter/Escape dentro del modal (evita que el Enter se filtre al insert-row de atrás).
confirmModal.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); _closeConfirm(true); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _closeConfirm(false); }
});

function confirmWrite(sql, params = []) {
  if (_confirmResolve) _closeConfirm(false);   // cancela cualquier confirmación colgada
  confirmSqlEl.textContent = sql;
  if (params && params.length) {
    confirmParamsEl.textContent = 'Parameters: ' + params.map(v => v === null ? 'NULL' : JSON.stringify(v)).join(', ');
    confirmParamsEl.classList.remove('hidden');
  } else {
    confirmParamsEl.classList.add('hidden');
  }
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    confirmModal.classList.remove('hidden');
    confirmRunBtn.focus();   // saca el foco del input de atrás; Enter confirma el modal
  });
}

// ¿La conexión actual está en modo "confirmar antes de escribir"?
function currentConfirmWrites() {
  const c = settings.config.connections.find((x) => x.name === currentConnection);
  return !!c?.confirmWrites;
}

// Detecta si un SQL arbitrario es una sentencia de escritura (ignora comentarios/espacios iniciales).
const WRITE_RE = /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*(insert|update|delete|drop|alter|truncate|create|replace|merge|grant|revoke)\b/i;
const isWriteSql = (sql) => WRITE_RE.test(sql);

// El bridge tiene una sola conexión/DB activa (estado compartido). Antes de ejecutar,
// nos aseguramos de que esté en la conexión + base que muestra la UI (se re-sincroniza
// solo si difiere), para no correr contra otra conexión por una reconexión previa.
async function ensureBridgeContext() {
  if (!currentConnection) return;
  try {
    const h = await bridge.health();
    if (h.connection !== currentConnection) {
      await bridge.useConnection(currentConnection);
      if (currentDatabase) await bridge.useDatabase(currentDatabase);
    } else if (currentDatabase && h.database && h.database !== currentDatabase) {
      await bridge.useDatabase(currentDatabase);
    }
  } catch { /* si health/switch falla, la query reportará el error real */ }
}

// ── Run query ──
async function runQuery() {
  editorTabs.syncFromEditor();
  const sql = buildSql();
  if (!sql) return;

  if (!(await ensureUnlocked(currentConnection))) return;   // Touch ID si la conexión lo pide
  if (currentConfirmWrites() && isWriteSql(sql) && !(await confirmWrite(sql))) return;
  await ensureBridgeContext();

  lastSql = sql;
  showState('loading');
  btnRun.disabled = true;

  try {
    const result = await bridge.query(sql);
    await renderResults(result, sql);
    history.add(sql);
  } catch (err) {
    showState('error', err.message);
  } finally {
    btnRun.disabled = false;
  }
}

// ── Run all: ejecuta todas las sentencias del editor (o de la selección) ──
// Divide por ';' respetando strings ('...', "...", `...`) y comentarios (-- , /* */).
function splitStatements(sql) {
  const out = [];
  let cur = '';
  let inS = false, inD = false, inB = false, inLine = false, inBlock = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (inLine)  { cur += c; if (c === '\n') inLine = false; continue; }
    if (inBlock) { cur += c; if (c === '*' && next === '/') { cur += next; i++; inBlock = false; } continue; }
    if (inS) { cur += c; if (c === "'") inS = false; continue; }
    if (inD) { cur += c; if (c === '"') inD = false; continue; }
    if (inB) { cur += c; if (c === '`') inB = false; continue; }
    if (c === '-' && next === '-') { inLine = true; cur += c; continue; }
    if (c === '/' && next === '*') { inBlock = true; cur += c; continue; }
    if (c === "'") { inS = true; cur += c; continue; }
    if (c === '"') { inD = true; cur += c; continue; }
    if (c === '`') { inB = true; cur += c; continue; }
    if (c === ';') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const stmtLabel = (stmt) => {
  const one = stmt.replace(/\s+/g, ' ').trim();
  return one.length > 22 ? one.slice(0, 21) + '…' : one;
};

function _setResultTabsFromResults(items) {
  _pivotOff();
  tabStore.length = 0;
  items.forEach(({ stmt, res }, i) => {
    const isWrite = !res.fields || res.fields.length === 0;
    let fields = res.fields || [];
    let rows = res.rows || [];
    let metaText;
    if (isWrite) {
      fields = [{ name: 'status', dataTypeID: 0 }];
      rows = [[`${res.rowCount ?? 0} row(s) affected`]];
      metaText = `${res.rowCount ?? 0} affected · ${res.durationMs}ms`;
    } else {
      metaText = `${res.rowCount} row${res.rowCount !== 1 ? 's' : ''} · ${res.durationMs}ms`;
    }
    tabStore.push({
      id: i === 0 ? 0 : ++tabIdSeq,
      label: `${i + 1}: ${stmtLabel(stmt)}`,
      fields, rows, editable: false, callbacks: null, fkMap: new Map(), metaText,
    });
  });
  activeTabId = tabStore[0]?.id ?? null;
  _refreshTabBar();
  _renderActiveTab();
}

async function runAllQueries() {
  editorTabs.syncFromEditor();
  const { selectionStart, selectionEnd, value } = editor;
  const source = selectionStart !== selectionEnd ? value.slice(selectionStart, selectionEnd) : value;
  const statements = splitStatements(source);
  if (statements.length <= 1) return runQuery();   // una sola → flujo normal

  if (!(await ensureUnlocked(currentConnection))) return;
  await ensureBridgeContext();
  showState('loading');
  btnRunAll.disabled = btnRun.disabled = true;
  const results = [];
  let failed = null;
  try {
    for (const stmt of statements) {
      if (currentConfirmWrites() && isWriteSql(stmt) && !(await confirmWrite(stmt))) break; // cancelado
      const res = await bridge.query(stmt);
      history.add(stmt);
      results.push({ stmt, res });
    }
  } catch (err) {
    failed = err.message;
  } finally {
    btnRunAll.disabled = btnRun.disabled = false;
  }

  if (results.length) _setResultTabsFromResults(results);
  else if (!failed) showState('empty');
  if (failed) showErrorModal(`Statement ${results.length + 1} failed:\n${failed}`);
}

async function renderResults(result, sql, keepFkTabs = false) {
  const sourceTable = detectSourceTable(sql);

  if (!isReadOnly && sourceTable) {
    const { pkCols, fkMap, enumMap } = await getTableMeta(sourceTable);
    const metaText = `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''} · ${result.durationMs}ms · ✎ editable`;
    const callbacks = {
      onUpdate: (fieldName, parsed, snapshot) =>
        handleUpdate(sourceTable, result.fields, fieldName, parsed, snapshot, pkCols),
      onInsert: (fields, values) =>
        handleInsert(sourceTable, fields, values, reloadResults),
      onError: handleWriteError,
      onReload: reloadResults,
      onFkClick: handleFkClick,
      fkMap,
      enumMap,
    };
    _setMainTab(result.fields, result.rows, true, callbacks, fkMap, metaText, keepFkTabs);
  } else {
    let fkMap = new Map();
    if (sourceTable) {
      try { ({ fkMap } = await getTableMeta(sourceTable)); } catch {}
    }
    const metaText = `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''} · ${result.durationMs}ms`;
    _setMainTab(result.fields, result.rows, false, null, fkMap, metaText, keepFkTabs);
  }
}

// ── Show indexes ──
async function showIndexes(tableName) {
  try {
    const { indexes } = await bridge.tableIndexes(tableName);
    const fields = [
      { name: 'index_name', dataTypeID: 0 },
      { name: 'columns',    dataTypeID: 0 },
      { name: 'type',       dataTypeID: 0 },
      { name: 'index_type', dataTypeID: 0 },
    ];
    const rows = indexes.map(i => [i.index_name, i.columns, i.type, i.index_type]);
    _openSideTab(
      `INDEXES ${tableName}`,
      fields, rows,
      `INDEXES ${tableName} · ${indexes.length} index${indexes.length !== 1 ? 'es' : ''}`,
    );
  } catch (err) {
    showErrorModal(err.message);
  }
}

// ── Describe table ──
async function describeTable(tableName) {
  try {
    const { columns } = await bridge.tableSchema(tableName);
    const fields = [
      { name: 'column_name',    dataTypeID: 0 },
      { name: 'data_type',      dataTypeID: 0 },
      { name: 'is_nullable',    dataTypeID: 0 },
      { name: 'column_default', dataTypeID: 0 },
    ];
    const rows = columns.map(c => [
      c.column_name,
      c.enumValues ? `${c.data_type}(${c.enumValues.join(', ')})` : c.data_type,
      c.is_nullable,
      c.column_default,
    ]);
    _openSideTab(
      `DESCRIBE ${tableName}`,
      fields, rows,
      `DESCRIBE ${tableName} · ${columns.length} column${columns.length !== 1 ? 's' : ''}`,
    );
  } catch (err) {
    showErrorModal(err.message);
  }
}

function _openSideTab(label, fields, rows, metaText) {
  const tabId = ++tabIdSeq;
  tabStore.push({ id: tabId, label, fields, rows, editable: false, callbacks: null, fkMap: new Map(), metaText });
  activeTabId = tabId;
  _refreshTabBar();
  _renderActiveTab();
}

function showState(state, errorMsg) {
  resultsLoading.classList.add('hidden');
  resultsEmpty.classList.add('hidden');
  resultsError.classList.add('hidden');
  document.getElementById('results-table').classList.add('hidden');

  if (state === 'loading') resultsLoading.classList.remove('hidden');
  else if (state === 'empty') resultsEmpty.classList.remove('hidden');
  else if (state === 'error') {
    resultsError.textContent = `Error: ${errorMsg}`;
    resultsError.classList.remove('hidden');
    resultsMeta.classList.add('hidden');
  } else if (state === 'table') {
    document.getElementById('results-table').classList.remove('hidden');
  }
}

// ── Event listeners ──
btnRun.addEventListener('click', runQuery);
btnRunAll.addEventListener('click', runAllQueries);

// ── Tooltips de los botones (con shortcut donde aplica) ──
(() => {
  const MOD = /mac/i.test(navigator.platform || '') ? '⌘' : 'Ctrl';
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.title = text; };
  set('btn-settings',    'Settings');
  set('btn-theme',       'Toggle light / dark theme');
  set('btn-erd-toggle',  'Show / hide schema diagram');
  set('btn-network',     'Network requests → SQL');
  set('btn-save-query',  `Save query (${MOD}+S)`);
  set('btn-run',         `Run query (${MOD}+Enter)`);
  set('btn-run-all',     `Run all statements (${MOD}+Shift+Enter)`);
})();

editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    e.shiftKey ? runAllQueries() : runQuery();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    openSaveModal();
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    editor.value = editor.value.slice(0, start) + '  ' + editor.value.slice(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = start + 2;
  }
});

btnRefreshSchema.addEventListener('click', () => schema.load(bridge));
btnClearHistory.addEventListener('click', () => history.clear());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    errorModal.classList.add('hidden');
    saveModal.classList.add('hidden');
    nqModal.classList.add('hidden');
    settings.close();
  }
  if (e.altKey && e.code === 'KeyW') {
    e.preventDefault();
    editorTabs.closeActive();
  }
});

// ── Resize handles ──
(function initResizeHandles() {
  const handle = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
  const insert = (el, parent, before) => before ? parent.insertBefore(el, before) : parent.appendChild(el);

  // Sidebar ↔ main (horizontal)
  const sidebarHandle = handle('resize-handle resize-h-x');
  insert(sidebarHandle, document.getElementById('app'), document.getElementById('main'));
  makeResizable(sidebarHandle, document.getElementById('sidebar'), 'x', { min: 140 });

  // Connection list ↕ (vertical, inside sidebar; el handle se oculta con la sección)
  const connList = document.getElementById('connection-list');
  if (connList) {
    const connHandle = handle('resize-handle resize-h-y');
    connList.parentNode.insertBefore(connHandle, connList.nextSibling);
    makeResizable(connHandle, connList, 'y', { min: 40 });
  }

  // Database list ↕ tables (vertical, inside sidebar)
  const dbHandle = handle('resize-handle resize-h-y');
  const dbList = document.getElementById('db-list');
  dbList.parentNode.insertBefore(dbHandle, dbList.nextSibling);
  makeResizable(dbHandle, dbList, 'y', { min: 40 });

  // Editor ↕ results (vertical)
  const editorHandle = handle('resize-handle resize-h-y');
  insert(editorHandle, document.getElementById('main'), document.getElementById('results-container'));
  makeResizable(editorHandle, document.getElementById('editor-container'), 'y', { min: 60 });

  // Network panel top edge (drag up to grow)
  const netHandle = handle('resize-handle resize-h-y');
  const netPanel = document.getElementById('network-panel');
  netPanel.insertBefore(netHandle, netPanel.firstChild);
  makeResizable(netHandle, netPanel, 'y', { invert: true, min: 80 });

  // History panel top edge (drag up to grow)
  const histHandle = handle('resize-handle resize-h-y');
  const histPanel = document.getElementById('history-panel');
  histPanel.insertBefore(histHandle, histPanel.firstChild);
  makeResizable(histHandle, histPanel, 'y', { invert: true, min: 80 });

  // Saved queries top edge (drag up to grow)
  const savedList = document.getElementById('saved-query-list');
  const savedHandle = handle('resize-handle resize-h-y');
  savedList.previousElementSibling.before(savedHandle);
  makeResizable(savedHandle, savedList, 'y', { invert: true, min: 40 });
})();

// ── Autocomplete ──
const autocomplete = new SqlAutocomplete({
  editorEl:        editor,
  getTableNames:   () => schema.tableNames ?? [],
  getTableColumns: async (name) => {
    const { columns } = await bridge.tableSchema(name);
    return columns.map(c => c.column_name);
  },
});

// Invalidate column cache when schema reloads or connection changes
const _origSchemaLoad = schema.load.bind(schema);
schema.load = async (...args) => { autocomplete.invalidateCache(); return _origSchemaLoad(...args); };

// ── Init ──
showState('empty');
checkHealth();
setInterval(checkHealth, 30_000);
