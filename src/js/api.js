// All calls are relative: in dev, Vite proxies /api and /mcp to the backend.
const TOKEN_KEY = 'piDashboardAdminToken';

let tokenPrompt = null;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function storeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: token lives for this request only */
  }
}

// The auth modal registers itself here; it resolves to a token or null (cancelled).
export function setTokenPrompt(fn) {
  tokenPrompt = fn;
}

async function send(path, { method = 'GET', body, timeout = 10000, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const adminToken = token ?? readToken();
  if (adminToken) headers['X-Admin-Token'] = adminToken;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      cache: 'no-store'
    });
  } catch (error) {
    throw new ApiError(0, error.name === 'TimeoutError' ? 'Request timed out' : 'Network error');
  }

  const isJson = (response.headers.get('content-type') || '').includes('json');
  const data = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) throw new ApiError(response.status, data?.error || `HTTP ${response.status}`);
  if (!isJson) throw new ApiError(response.status, 'Unexpected response');
  return data;
}

// `interactive` requests (user actions) ask for the admin token on 401 and retry;
// background polls just fail so they never pop a dialog on their own.
export async function request(path, options = {}) {
  try {
    return await send(path, options);
  } catch (error) {
    if (error.status !== 401 || !options.interactive || !tokenPrompt) throw error;
    let rejected = Boolean(readToken());
    for (;;) {
      const token = await tokenPrompt({ rejected });
      if (!token) throw new ApiError(401, 'Admin token required');
      try {
        const data = await send(path, { ...options, token });
        storeToken(token);
        return data;
      } catch (retryError) {
        if (retryError.status !== 401) throw retryError;
        rejected = true;
      }
    }
  }
}

export const api = {
  get: (path, options) => request(path, options),
  put: (path, body, options) => request(path, { method: 'PUT', body, interactive: true, ...options }),
  post: (path, body, options) => request(path, { method: 'POST', body, interactive: true, ...options }),
  del: (path, options) => request(path, { method: 'DELETE', interactive: true, ...options })
};
