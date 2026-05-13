// Keyword-based read-only enforcement (defense-in-depth alongside DB-level read-only).
// Intentionally simple: reject on first suspicious keyword.
const WRITE_KEYWORDS = /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|REPLACE|MERGE|CALL|EXEC|EXECUTE)\b/i;

// Additional dangerous patterns even in SELECT context
const DANGEROUS_PATTERNS = [
  /;\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE)/i, // stacked queries
  /--\s*$/m,   // trailing comment that might hide injected code (allow inline -- for SQL comments in general queries)
];

export function checkReadOnly(sql) {
  const trimmed = sql.trim();
  if (WRITE_KEYWORDS.test(trimmed)) {
    const keyword = trimmed.match(WRITE_KEYWORDS)[1].toUpperCase();
    throw Object.assign(new Error(`Query blocked: ${keyword} is not allowed in read-only mode`), { code: 'READONLY' });
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw Object.assign(new Error('Query blocked: potentially dangerous pattern detected'), { code: 'DANGEROUS' });
    }
  }
}

export function checkLocalhost(req) {
  const host = req.headers.host || '';
  const origin = req.headers.origin || '';
  const ip = req.ip || req.socket?.remoteAddress || '';

  const allowedIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  const isLocalIp = allowedIps.some((a) => ip.includes(a));
  const isLocalOrigin = origin.startsWith('devtools://') || origin.startsWith('chrome-extension://') || !origin;

  if (!isLocalIp) {
    throw Object.assign(new Error('Access denied: bridge only accepts connections from localhost'), { code: 'FORBIDDEN' });
  }
  return true;
}
