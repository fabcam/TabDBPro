// Resaltado de sintaxis SQL sobre un <textarea>, con la técnica de "backdrop":
// un <pre> detrás del textarea que muestra el mismo texto tokenizado y coloreado.
// El textarea queda con texto transparente (solo se ve el caret) encima.

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'BETWEEN', 'LIKE', 'ILIKE',
  'EXISTS', 'ANY', 'ALL', 'SOME', 'AS', 'DISTINCT', 'ON', 'USING',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL',
  'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
  'UNION', 'INTERSECT', 'EXCEPT', 'WITH', 'RECURSIVE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'RETURNING',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'TABLE', 'VIEW', 'INDEX', 'SCHEMA', 'DATABASE',
  'PRIMARY', 'FOREIGN', 'KEY', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT', 'CONSTRAINT',
  'CAST', 'CONVERT', 'COLLATE', 'OVER', 'PARTITION', 'WINDOW',
  'TRUE', 'FALSE', 'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'BOOLEAN', 'BOOL',
  'VARCHAR', 'CHAR', 'TEXT', 'DATE', 'TIME', 'TIMESTAMP', 'DATETIME', 'NUMERIC', 'DECIMAL',
  'FLOAT', 'DOUBLE', 'REAL', 'JSON', 'JSONB', 'UUID', 'ENUM',
]);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightSql(text) {
  const re = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    if (m[1]) {
      out += `<span class="tok-comment">${esc(m[1])}</span>`;
    } else if (m[2]) {
      out += `<span class="tok-string">${esc(m[2])}</span>`;
    } else if (m[3]) {
      out += `<span class="tok-number">${esc(m[3])}</span>`;
    } else {
      const w = m[4];
      if (KEYWORDS.has(w.toUpperCase())) {
        out += `<span class="tok-keyword">${esc(w)}</span>`;
      } else if (/^\s*\(/.test(text.slice(re.lastIndex))) {
        out += `<span class="tok-func">${esc(w)}</span>`;   // nombre seguido de "(" → función
      } else {
        out += esc(w);
      }
    }
    last = re.lastIndex;
  }
  out += esc(text.slice(last));
  return out;
}

// Crea el overlay detrás del textarea y lo mantiene sincronizado.
export function createHighlighter(textarea) {
  const pre = document.createElement('pre');
  pre.className = 'editor-highlight';
  pre.setAttribute('aria-hidden', 'true');
  const code = document.createElement('code');
  pre.appendChild(code);
  textarea.parentElement.insertBefore(pre, textarea);

  const sync = () => { pre.scrollTop = textarea.scrollTop; pre.scrollLeft = textarea.scrollLeft; };
  const render = () => {
    code.innerHTML = highlightSql(textarea.value) + '\n';   // \n asegura que la última línea se pinte
    sync();
  };

  textarea.addEventListener('input', render);
  textarea.addEventListener('scroll', sync);
  textarea.addEventListener('rehighlight', render);   // señal de cambio programático (cambio de pestaña, etc.)
  render();
  return { render };
}
