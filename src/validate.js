export const ALLOWED_IDS = ['bitcoin', 'ethereum', 'solana', 'dogecoin', 'cardano', 'ripple'];
export const MAX_IDS = 10;

export function parseIds(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'Missing ids. Example: ?ids=bitcoin,ethereum' };
  }

  const parts = raw.split(',').map((id) => id.trim().toLowerCase());

  if (parts.length > MAX_IDS) {
    return { ok: false, error: `Too many ids. The maximum is ${MAX_IDS} per request.` };
  }

  if (parts.some((id) => id === '')) {
    return { ok: false, error: 'Empty id in the list. Example: ?ids=bitcoin,ethereum' };
  }

  const unknown = parts.filter((id) => !ALLOWED_IDS.includes(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown ids: ${unknown.join(', ')}. Allowed ids: ${ALLOWED_IDS.join(', ')}.`,
    };
  }

  return { ok: true, ids: [...new Set(parts)] };
}
