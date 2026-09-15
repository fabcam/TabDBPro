const AGGS = {
  sum:   (vals) => round(vals.reduce((a, v) => a + (Number(v) || 0), 0)),
  count: (vals) => vals.length,
  avg: (vals) => {
    const nums = vals.map(Number).filter(n => !isNaN(n));
    return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  },
  min: (vals) => { const nums = vals.map(Number).filter(n => !isNaN(n)); return nums.length ? Math.min(...nums) : null; },
  max: (vals) => { const nums = vals.map(Number).filter(n => !isNaN(n)); return nums.length ? Math.max(...nums) : null; },
};

function round(v) {
  return typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v;
}

function sorter(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

// Ordena tuplas (arrays) elemento a elemento.
function tupleSorter(a, b) {
  for (let i = 0; i < a.length; i++) {
    const c = sorter(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}

// rowCol acepta un string o un array de nombres (agrupación por varios campos).
export function buildPivot(fields, rows, { rowCol, colCol, valueCol, agg = 'sum' }) {
  const rowCols = (Array.isArray(rowCol) ? rowCol : [rowCol]).filter(Boolean);
  const rowIdx = rowCols.map(name => fields.findIndex(f => f.name === name));
  const ci = fields.findIndex(f => f.name === colCol);
  const vi = fields.findIndex(f => f.name === valueCol);
  if (rowIdx.length === 0 || rowIdx.some(i => i < 0) || ci < 0 || vi < 0) return null;
  if (rowIdx.includes(ci)) return null;   // un mismo campo no puede ser row y column

  const colVals = [...new Set(rows.map(r => r[ci]))].sort(sorter);

  // Agrupar por la tupla de valores de las columnas-fila.
  const tupleOf = (row) => rowIdx.map(i => row[i]);
  const keyOf = (tuple) => JSON.stringify(tuple);
  const tuples = new Map();   // key → tuple (para preservar los valores)
  const cellMap = new Map();  // key → Map(colVal → values[])
  for (const row of rows) {
    const tuple = tupleOf(row);
    const key = keyOf(tuple);
    if (!tuples.has(key)) { tuples.set(key, tuple); cellMap.set(key, new Map()); }
    const inner = cellMap.get(key);
    const cv = row[ci];
    if (!inner.has(cv)) inner.set(cv, []);
    inner.get(cv).push(row[vi]);
  }

  const orderedTuples = [...tuples.values()].sort(tupleSorter);
  const fn = AGGS[agg] ?? AGGS.sum;

  const pivotFields = [
    ...rowCols.map(name => ({ name, dataTypeID: 0 })),
    ...colVals.map(cv => ({ name: cv === null ? '(NULL)' : String(cv), dataTypeID: 0 })),
  ];

  const pivotRows = orderedTuples.map(tuple => {
    const inner = cellMap.get(keyOf(tuple));
    return [
      ...tuple,
      ...colVals.map(cv => { const vals = inner.get(cv); return vals ? fn(vals) : null; }),
    ];
  });

  return {
    pivotFields,
    pivotRows,
    rowColCount: rowCols.length,   // cuántas columnas iniciales son de agrupación
    stats: `${orderedTuples.length} × ${colVals.length}`,
  };
}

// Returns the name of the first field that looks numeric, or null.
export function guessValueField(fields) {
  return fields.find(f =>
    /int|num|float|double|decimal|count|sum|amount|price|qty|quantity|total|score|age|size|length|weight|height/i.test(f.name)
  )?.name ?? null;
}
