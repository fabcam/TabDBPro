// Funciones puras para exportar el resultado de una query.
// fields: [{ name, ... }]   rows: array de arrays (row[i] alineado a fields[i]).
// Los valores ya vienen serializados por JSON desde el bridge (string/number/bool/null).

const fieldNames = (fields) => fields.map((f) => f.name);

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ── CSV ──────────────────────────────────────────────────────────────────────
export function toCsv(fields, rows) {
  const esc = (v) => {
    const s = cellToString(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = fieldNames(fields).map(esc).join(',');
  const body = rows.map((row) => row.map(esc).join(',')).join('\r\n');
  return body ? `${header}\r\n${body}` : header;
}

// ── JSON ─────────────────────────────────────────────────────────────────────
export function toJson(fields, rows) {
  const names = fieldNames(fields);
  const objects = rows.map((row) => {
    const o = {};
    names.forEach((n, i) => { o[n] = row[i] === undefined ? null : row[i]; });
    return o;
  });
  return JSON.stringify(objects, null, 2);
}

// ── INSERT ───────────────────────────────────────────────────────────────────
export function toInsert(fields, rows, tableName, dbType = 'postgres') {
  const q = (id) => (dbType === 'mysql' ? `\`${id}\`` : `"${id}"`);
  const cols = fieldNames(fields).map(q).join(', ');
  const val = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `'${s.replace(/'/g, "''")}'`;
  };
  const table = q(tableName || 'table_name');
  return rows
    .map((row) => `INSERT INTO ${table} (${cols}) VALUES (${row.map(val).join(', ')});`)
    .join('\n');
}

// Extensión y MIME por formato.
export const EXPORT_META = {
  csv:    { ext: 'csv', mime: 'text/csv',        fn: toCsv },
  json:   { ext: 'json', mime: 'application/json', fn: toJson },
  insert: { ext: 'sql', mime: 'application/sql',  fn: toInsert },
};

// Intenta deducir el nombre de tabla desde el SQL (primer FROM / INTO / UPDATE / JOIN).
// Soporta nombres calificados y con comillas ("public"."orders" → orders).
export function guessTableName(sql) {
  if (!sql) return null;
  const m = sql.match(/\b(?:from|into|update|join)\s+([`"'\w.]+)/i);
  if (!m) return null;
  const last = m[1].split('.').pop();          // última parte (tabla)
  return last.replace(/[`"']/g, '') || null;
}
