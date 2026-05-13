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

const BRIDGE_URL = 'http://127.0.0.1:47321';
const bridge = new BridgeClient(BRIDGE_URL);

const LAST_CONN_KEY = 'last_connection';

// ── DOM refs ──
const editor = document.getElementById('editor');
const btnRun = document.getElementById('btn-run');
const btnSaveQuery = document.getElementById('btn-save-query');
const selectLimit = document.getElementById('select-limit');
const statusDot = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const resultsMeta = document.getElementById('results-meta');
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

function clearTableMetaCache() { tableMetaCache.clear(); }

async function getTableMeta(tableName) {
  if (tableMetaCache.has(tableName)) return tableMetaCache.get(tableName);
  try {
    const { indexes } = await bridge.tableIndexes(tableName);
    const pk = indexes.find(i => i.type === 'PRIMARY KEY');
    const pkCols = pk ? pk.columns.split(',').map(s => s.trim()) : [];

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

    const meta = { pkCols, fkMap };
    tableMetaCache.set(tableName, meta);
    return meta;
  } catch { return { pkCols: [], fkMap: new Map() }; }
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

  if (tab.editable && tab.callbacks) {
    resultsTable.renderEditable(tab.fields, tab.rows, tab.callbacks);
  } else {
    resultsTable.render(tab.fields, tab.rows, { fkMap: tab.fkMap, onFkClick: handleFkClick });
  }
  resultsMeta.textContent = tab.metaText;
  resultsMeta.classList.remove('hidden');
  showState('table');
}

async function handleFkClick(refTable, refCol, value) {
  try {
    const fkSql = `SELECT * FROM ${quoteId(refTable)} WHERE ${quoteId(refCol)} = ${placeholder(1)}`;
    const result = await bridge.query(fkSql, [value]);
    const { pkCols, fkMap } = await getTableMeta(refTable);

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
        onError: showErrorModal,
        onReload: reloadFkTab,
        onFkClick: handleFkClick,
        fkMap,
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

contextMenu
  .on('describe', ({ tableName }) => describeTable(tableName))
  .on('indexes',  ({ tableName }) => showIndexes(tableName))
  .on('select',   ({ tableName }) => {
    editorTabs.openQuery(`SELECT *\nFROM ${tableName}\nLIMIT 100;`, tableName);
    runQuery();
  })
  .on('copy', ({ tableName }) => navigator.clipboard.writeText(tableName));

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
  onTableClick: (tableName) => {
    editorTabs.openQuery(`SELECT *\nFROM ${tableName}\nLIMIT 100;`, tableName);
    runQuery();
  },
  onDescribeTable: ({ tableName, x, y }) => {
    contextMenu.show(x, y, { tableName });
  },
  onDatabaseSwitch: (db) => {
    clearTableMetaCache();
    showState('empty');
    resultsMeta.classList.add('hidden');
    currentDatabase = db;
    savedQueries.setContext(currentConnection, currentDatabase);
  },
});

// ── Health check ──
let bridgeWasConnected = false;

let settingsAutoOpened = false;

async function checkHealth() {
  setStatus('checking', 'Connecting to bridge...');
  try {
    // On first connect, push saved config to the bridge then restore last connection
    if (!bridgeWasConnected && settings.config.connections.length > 0) {
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
    currentConnection = data.connection ?? '';
    const writeLabel = isReadOnly ? 'read-only' : '✎ write';
    setStatus('connected', `${data.db.type} · ${writeLabel}`);
    updateConnBadge(currentConnection, getConnColor(currentConnection));
    if (!bridgeWasConnected) {
      bridgeWasConnected = true;
      connectionSelector.load(bridge);
      schema.load(bridge).then(() => {
        currentDatabase = schema.currentDb ?? '';
        savedQueries.setContext(currentConnection, currentDatabase);
      });
    }
  } catch {
    bridgeWasConnected = false;
    setStatus('disconnected', 'Bridge not running — cd bridge && npm start');
    updateConnBadge(null, null);
    editorTabsEl.style.removeProperty('--conn-color');
  }
}

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

  await bridge.query(
    `INSERT INTO ${quoteId(tableName)} (${cols}) VALUES (${placeholders})`,
    params
  );
  await reloadFn();
}

async function reloadResults() {
  if (!lastSql) return;
  try {
    const result = await bridge.query(lastSql);
    await renderResults(result, lastSql, true);
  } catch { /* ignore reload errors */ }
}

// ── Run query ──
async function runQuery() {
  editorTabs.syncFromEditor();
  const sql = buildSql();
  if (!sql) return;

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

async function renderResults(result, sql, keepFkTabs = false) {
  const sourceTable = detectSourceTable(sql);

  if (!isReadOnly && sourceTable) {
    const { pkCols, fkMap } = await getTableMeta(sourceTable);
    const metaText = `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''} · ${result.durationMs}ms · ✎ editable`;
    const callbacks = {
      onUpdate: (fieldName, parsed, snapshot) =>
        handleUpdate(sourceTable, result.fields, fieldName, parsed, snapshot, pkCols),
      onInsert: (fields, values) =>
        handleInsert(sourceTable, fields, values, reloadResults),
      onError: showErrorModal,
      onReload: reloadResults,
      onFkClick: handleFkClick,
      fkMap,
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
  showState('loading');
  try {
    const { indexes } = await bridge.tableIndexes(tableName);
    const fields = [
      { name: 'index_name', dataTypeID: 0 },
      { name: 'columns',    dataTypeID: 0 },
      { name: 'type',       dataTypeID: 0 },
      { name: 'index_type', dataTypeID: 0 },
    ];
    const rows = indexes.map(i => [i.index_name, i.columns, i.type, i.index_type]);
    _setMainTab(fields, rows, false, null, new Map(), `INDEXES ${tableName} · ${indexes.length} index${indexes.length !== 1 ? 'es' : ''}`);
  } catch (err) {
    showState('error', err.message);
  }
}

// ── Describe table ──
async function describeTable(tableName) {
  showState('loading');
  try {
    const { columns } = await bridge.tableSchema(tableName);
    const fields = [
      { name: 'column_name',   dataTypeID: 0 },
      { name: 'data_type',     dataTypeID: 0 },
      { name: 'is_nullable',   dataTypeID: 0 },
      { name: 'column_default', dataTypeID: 0 },
    ];
    const rows = columns.map(c => [c.column_name, c.data_type, c.is_nullable, c.column_default]);
    _setMainTab(fields, rows, false, null, new Map(), `DESCRIBE ${tableName} · ${columns.length} column${columns.length !== 1 ? 's' : ''}`);
  } catch (err) {
    showState('error', err.message);
  }
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

editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runQuery();
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
