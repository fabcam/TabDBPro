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

export function buildPivot(fields, rows, { rowCol, colCol, valueCol, agg = 'sum' }) {
  const ri = fields.findIndex(f => f.name === rowCol);
  const ci = fields.findIndex(f => f.name === colCol);
  const vi = fields.findIndex(f => f.name === valueCol);
  if (ri < 0 || ci < 0 || vi < 0) return null;
  if (ri === ci) return null;

  const colVals = [...new Set(rows.map(r => r[ci]))].sort(sorter);
  const rowVals = [...new Set(rows.map(r => r[ri]))].sort(sorter);

  const cellMap = new Map();
  for (const row of rows) {
    const rv = row[ri], cv = row[ci], vv = row[vi];
    if (!cellMap.has(rv)) cellMap.set(rv, new Map());
    const inner = cellMap.get(rv);
    if (!inner.has(cv)) inner.set(cv, []);
    inner.get(cv).push(vv);
  }

  const fn = AGGS[agg] ?? AGGS.sum;

  const pivotFields = [
    { name: rowCol, dataTypeID: 0 },
    ...colVals.map(cv => ({ name: cv === null ? '(NULL)' : String(cv), dataTypeID: 0 })),
  ];

  const pivotRows = rowVals.map(rv => [
    rv,
    ...colVals.map(cv => {
      const vals = cellMap.get(rv)?.get(cv);
      return vals ? fn(vals) : null;
    }),
  ]);

  return {
    pivotFields,
    pivotRows,
    stats: `${rowVals.length} × ${colVals.length}`,
  };
}

// Returns the name of the first field that looks numeric, or null.
export function guessValueField(fields) {
  return fields.find(f =>
    /int|num|float|double|decimal|count|sum|amount|price|qty|quantity|total|score|age|size|length|weight|height/i.test(f.name)
  )?.name ?? null;
}
