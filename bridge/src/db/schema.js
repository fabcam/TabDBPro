import { getPool, getCurrentConnType } from './pool.js';

export async function getDatabases() {
  const pool = await getPool();
  const type = getCurrentConnType();

  if (type === 'postgres') {
    const { rows } = await pool.query(
      `SELECT datname AS database_name FROM pg_database WHERE datistemplate = false ORDER BY datname`
    );
    return rows.map((r) => r.database_name);
  } else {
    const [rows] = await pool.execute('SHOW DATABASES');
    return rows.map((r) => r.Database);
  }
}

export async function getTables() {
  const pool = await getPool();
  const type = getCurrentConnType();

  if (type === 'postgres') {
    const { rows } = await pool.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    return rows;
  } else {
    const [rows] = await pool.execute(`
      SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);
    return rows;
  }
}

export async function getTableIndexes(tableName) {
  const pool = await getPool();
  const type = getCurrentConnType();
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error('Invalid table name');

  const order = { 'PRIMARY KEY': 0, 'UNIQUE': 1, 'INDEX': 2, 'FOREIGN KEY': 3 };

  if (type === 'postgres') {
    const { rows: idxRows } = await pool.query(
      `SELECT
         i.relname                                                             AS index_name,
         string_agg(a.attname, ', ' ORDER BY array_position(ix.indkey, a.attnum)) AS columns,
         CASE WHEN ix.indisprimary THEN 'PRIMARY KEY'
              WHEN ix.indisunique  THEN 'UNIQUE'
              ELSE 'INDEX' END                                                 AS type,
         am.amname                                                             AS index_type
       FROM pg_class t
       JOIN pg_index     ix ON t.oid = ix.indrelid
       JOIN pg_class     i  ON i.oid = ix.indexrelid
       JOIN pg_am        am ON i.relam = am.oid
       JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       WHERE t.relname = $1 AND t.relkind = 'r'
       GROUP BY i.relname, ix.indisprimary, ix.indisunique, am.amname`,
      [tableName]
    );

    const { rows: fkRows } = await pool.query(
      `SELECT
         tc.constraint_name                                          AS index_name,
         string_agg(DISTINCT kcu.column_name, ', ')                 AS columns,
         'FOREIGN KEY'                                               AS type,
         '→ ' || MIN(ccu.table_name) || '(' ||
           string_agg(DISTINCT ccu.column_name, ', ') || ')'        AS index_type
       FROM information_schema.table_constraints        tc
       JOIN information_schema.key_column_usage         kcu ON tc.constraint_name = kcu.constraint_name
                                                            AND tc.table_schema   = kcu.table_schema
       JOIN information_schema.constraint_column_usage  ccu ON tc.constraint_name = ccu.constraint_name
                                                            AND tc.table_schema   = ccu.table_schema
       WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
       GROUP BY tc.constraint_name`,
      [tableName]
    );

    return [...idxRows, ...fkRows].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  } else {
    const [idxRows] = await pool.execute(
      `SELECT
         INDEX_NAME                                                               AS index_name,
         GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ')          AS columns,
         CASE WHEN INDEX_NAME = 'PRIMARY' THEN 'PRIMARY KEY'
              WHEN NON_UNIQUE = 0         THEN 'UNIQUE'
              ELSE 'INDEX' END                                                    AS type,
         INDEX_TYPE                                                               AS index_type
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE`,
      [tableName]
    );

    const [fkRows] = await pool.execute(
      `SELECT
         kcu.CONSTRAINT_NAME                                                               AS index_name,
         GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ', ')       AS columns,
         'FOREIGN KEY'                                                                     AS type,
         CONCAT('→ ', MIN(kcu.REFERENCED_TABLE_NAME), '(',
           GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ', '),
           ')')                                                                            AS index_type
       FROM information_schema.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
       GROUP BY kcu.CONSTRAINT_NAME`,
      [tableName]
    );

    return [...idxRows, ...fkRows].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  }
}

export async function getTableSchema(tableName) {
  const pool = await getPool();
  const type = getCurrentConnType();
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error('Invalid table name');

  if (type === 'postgres') {
    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    );
    return rows;
  } else {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type,
              IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [tableName]
    );
    return rows;
  }
}
