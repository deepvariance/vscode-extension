export const DEFAULT_GATEWAY = 'https://demo.deepvariance.com';

/** Strip trailing slashes so `${gateway}/register` never doubles up. */
export function normalizeGateway(gateway) {
  return String(gateway).trim().replace(/\/+$/, '');
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

/**
 * Is the gateway answering at all?
 *
 * We deliberately don't assume /health exists: any status below 500 (even 404 or 401)
 * proves the gateway is up and talking, while 5xx — including Cloudflare's 52x/530 when
 * the origin is unreachable — or a transport error means it is not.
 */
export async function checkHealth({ gateway, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const base = normalizeGateway(gateway);
  const url = `${base}/health`;

  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? `no response within ${timeoutMs / 1000}s` : error.message;
    return { ok: false, url, status: null, detail: `Cannot reach ${base} (${reason}).` };
  }

  if (response.status >= 500) {
    return {
      ok: false,
      url,
      status: response.status,
      detail: `${base} returned HTTP ${response.status}. The gateway is not serving requests — check with your administrator.`,
    };
  }

  // The gateway's /health reports on its upstream too: it can answer 200 while the model
  // behind it is unreachable. Trust the body's own verdict when it gives one.
  const body = await response.json().catch(() => null);
  const reported = body?.status;

  if (reported && !['ok', 'healthy', 'up', 'pass'].includes(String(reported).toLowerCase())) {
    return {
      ok: false,
      url,
      status: response.status,
      detail: `${base} reports "${reported}"${body.detail ? ` — ${body.detail}` : ''}. The model behind the gateway is not ready.`,
    };
  }

  const suffix = body?.detail ? ` — ${body.detail}` : '';
  return { ok: true, url, status: response.status, detail: `${base} is up (HTTP ${response.status})${suffix}.` };
}

/**
 * POST /register — exchanges an invite token for a personal API key.
 * Mirrors the curl call in the tester setup guide (step 3).
 */
export async function register({ gateway, email, invite, fetchImpl = fetch }) {
  const url = `${normalizeGateway(gateway)}/register`;

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, invite }),
    });
  } catch (cause) {
    throw new Error(`Could not reach ${url}. Check the gateway URL and your network.`, { cause });
  }

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(explainFailure(response.status, raw, url));
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`${url} returned a non-JSON response: ${truncate(raw)}`);
  }

  if (!body.api_key) {
    throw new Error(`${url} responded without an api_key: ${truncate(raw)}`);
  }

  return { apiKey: body.api_key, email: body.email ?? email, createdUser: body.created_user === true };
}

function explainFailure(status, raw, url) {
  const detail = truncate(raw);
  if (status === 403) return `403 Forbidden — the invite token was rejected. Ask your administrator for a current one. ${detail}`;
  if (status === 404) return `404 Not Found — ${url} is not a register endpoint. Check the gateway URL with your administrator. ${detail}`;
  return `Registration failed (HTTP ${status}). ${detail}`;
}

function truncate(text, max = 300) {
  const clean = String(text).trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
