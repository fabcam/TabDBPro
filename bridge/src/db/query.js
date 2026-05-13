import { getPool, getCurrentConnType, getCurrentReadOnly } from './pool.js';
import { checkReadOnly } from '../security/guard.js';

export async function executeQuery(sql, params = []) {
  const readOnly = getCurrentReadOnly();
  if (readOnly) checkReadOnly(sql);

  const pool = await getPool();
  const type = getCurrentConnType();
  const startMs = Date.now();

  if (type === 'postgres') {
    const client = await pool.connect();
    try {
      if (readOnly) await client.query('SET LOCAL default_transaction_read_only = on');
      const result = await client.query({ text: sql, values: params, rowMode: 'array' });
      return {
        fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        rows: result.rows,
        rowCount: result.rowCount,
        durationMs: Date.now() - startMs,
      };
    } finally {
      client.release();
    }
  } else {
    const [rows, fields] = await pool.execute(sql, params);
    return {
      fields: (fields || []).map((f) => ({ name: f.name, dataTypeID: f.columnType })),
      rows: Array.isArray(rows) ? rows.map((r) => Object.values(r)) : [],
      rowCount: Array.isArray(rows) ? rows.length : 0,
      durationMs: Date.now() - startMs,
    };
  }
}
