/**
 * Cookie merge utility — handles Set-Cookie headers correctly.
 *
 * Uses Headers.getSetCookie() (Node 20+) to get individual Set-Cookie
 * headers without comma-joining corruption.
 */

/**
 * Merge existing cookie string with Set-Cookie response headers.
 * Accepts either an array of Set-Cookie strings or a Response object.
 */
export function mergeCookies(existing: string, setCookies: string[]): string {
  const cookieMap = new Map<string, string>();

  // Parse existing "name=value; name2=value2" string
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      cookieMap.set(trimmed.slice(0, eqIdx).trim(), trimmed.slice(eqIdx + 1).trim());
    }
  }

  // Parse Set-Cookie headers: "name=value; Path=...; ..." — take only name=value
  for (const header of setCookies) {
    const firstSemicolon = header.indexOf(';');
    const nameValue = firstSemicolon > 0 ? header.slice(0, firstSemicolon) : header;
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx > 0) {
      cookieMap.set(nameValue.slice(0, eqIdx).trim(), nameValue.slice(eqIdx + 1).trim());
    }
  }

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * Extract Set-Cookie headers from a fetch Response.
 * Uses getSetCookie() (Node 20+) to avoid comma-joining corruption.
 */
export function getSetCookies(res: Response): string[] {
  // Node 20+ Headers supports getSetCookie()
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  // Fallback: get() joins with comma which can corrupt cookie values,
  // but it's better than nothing
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}
