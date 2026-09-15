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

// Parsea las opciones de un enum/set de MySQL: enum('a','b','c') → ['a','b','c'].
function parseMysqlEnum(columnType) {
  const m = /^(?:enum|set)\((.*)\)$/i.exec(columnType || '');
  if (!m) return null;
  const out = [];
  const re = /'((?:[^']|'')*)'/g;
  let x;
  while ((x = re.exec(m[1]))) out.push(x[1].replace(/''/g, "'"));
  return out.length ? out : null;
}

export async function getTableSchema(tableName) {
  const pool = await getPool();
  const type = getCurrentConnType();
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error('Invalid table name');

  if (type === 'postgres') {
    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    );

    // Etiquetas de los tipos enum usados por columnas USER-DEFINED.
    const enumTypes = [...new Set(rows.filter((r) => r.data_type === 'USER-DEFINED').map((r) => r.udt_name))];
    const enumByType = {};
    if (enumTypes.length) {
      const { rows: er } = await pool.query(
        `SELECT t.typname, e.enumlabel
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
         WHERE t.typname = ANY($1)
         ORDER BY e.enumsortorder`,
        [enumTypes]
      );
      for (const r of er) (enumByType[r.typname] ||= []).push(r.enumlabel);
    }

    return rows.map((r) => {
      const isEnum = r.data_type === 'USER-DEFINED' && enumByType[r.udt_name];
      return {
        column_name: r.column_name,
        data_type: r.data_type === 'USER-DEFINED' ? r.udt_name : r.data_type,
        is_nullable: r.is_nullable,
        column_default: r.column_default,
        enumValues: isEnum ? enumByType[r.udt_name] : null,
      };
    });
  } else {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type,
              IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
              COLUMN_TYPE AS column_type
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [tableName]
    );
    return rows.map((r) => ({
      column_name: r.column_name,
      data_type: r.data_type,
      is_nullable: r.is_nullable,
      column_default: r.column_default,
      enumValues: (r.data_type === 'enum' || r.data_type === 'set') ? parseMysqlEnum(r.column_type) : null,
    }));
  }
}

// Devuelve el grafo completo del schema actual para el diagrama ER:
//   { tables: [{ name, columns: [{ name, type, nullable, pk, fk }] }],
//     relationships: [{ name, sourceTable, sourceColumn, targetTable, targetColumn }] }
// Usa queries bulk (una por columnas / PKs / FKs) en vez de N llamadas por tabla.
export async function getSchemaGraph() {
  const pool = await getPool();
  const type = getCurrentConnType();

  let colRows, pkRows, fkRows;

  if (type === 'postgres') {
    ({ rows: colRows } = await pool.query(`
      SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position
    `));
    ({ rows: pkRows } = await pool.query(`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    `));
    ({ rows: fkRows } = await pool.query(`
      SELECT tc.constraint_name AS name,
             tc.table_name      AS source_table,
             kcu.column_name    AS source_column,
             ccu.table_name     AS target_table,
             ccu.column_name    AS target_column
      FROM information_schema.table_constraints        tc
      JOIN information_schema.key_column_usage         kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage  ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `));
  } else {
    [colRows] = await pool.execute(`
      SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name,
             c.DATA_TYPE AS data_type, c.IS_NULLABLE AS is_nullable
      FROM information_schema.COLUMNS c
      JOIN information_schema.TABLES t
        ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
      WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
    `);
    [pkRows] = await pool.execute(`
      SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY'
    `);
    [fkRows] = await pool.execute(`
      SELECT CONSTRAINT_NAME        AS name,
             TABLE_NAME             AS source_table,
             COLUMN_NAME            AS source_column,
             REFERENCED_TABLE_NAME  AS target_table,
             REFERENCED_COLUMN_NAME AS target_column
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
  }

  const pkSet = new Set(pkRows.map((r) => `${r.table_name}.${r.column_name}`));
  const fkSet = new Set(fkRows.map((r) => `${r.source_table}.${r.source_column}`));

  const tableMap = new Map();
  for (const r of colRows) {
    if (!tableMap.has(r.table_name)) tableMap.set(r.table_name, []);
    const key = `${r.table_name}.${r.column_name}`;
    tableMap.get(r.table_name).push({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
      pk: pkSet.has(key),
      fk: fkSet.has(key),
    });
  }

  const tables = [...tableMap.entries()].map(([name, columns]) => ({ name, columns }));
  const relationships = fkRows.map((r) => ({
    name: r.name,
    sourceTable: r.source_table,
    sourceColumn: r.source_column,
    targetTable: r.target_table,
    targetColumn: r.target_column,
  }));

  return { tables, relationships };
}
