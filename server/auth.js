import crypto from 'node:crypto';

export function generateApiKey() {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Config writes: open when no ADMIN_TOKEN is set, as documented. */
export function requireAdmin(config) {
  return (req, res, next) => {
    if (!config.adminToken) return next();
    const token = req.headers['x-admin-token'] || req.query.token;
    if (typeof token !== 'string' || !safeEqual(token, config.adminToken)) {
      return res.status(401).json({ error: 'Unauthorized. Set X-Admin-Token header.' });
    }
    next();
  };
}

export function extractApiKey(req) {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header) return header;
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (bearer) return bearer[1].trim();
  return typeof req.query?.key === 'string' ? req.query.key : null;
}

/** Returns null when access is granted, otherwise `{ status, error }`. */
export async function checkApiAccess(store, req) {
  const { api } = await store.load();
  if (!api.enabled) {
    return { status: 403, error: 'API access is disabled. Enable it in dashboard settings.' };
  }
  if (!api.keyHash) return null;
  const key = extractApiKey(req);
  if (!key || !safeEqual(hashApiKey(key), api.keyHash)) {
    return { status: 401, error: 'Invalid API key. Provide X-API-Key header or ?key= param.' };
  }
  return null;
}

export function requireApiKey(store) {
  return async (req, res, next) => {
    const denied = await checkApiAccess(store, req);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    next();
  };
}
