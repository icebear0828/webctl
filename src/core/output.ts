/**
 * Structured output for agent consumption.
 */

export interface CliOutput<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export const EXIT = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  AUTH_REQUIRED: 2,
  NETWORK_ERROR: 3,
  NOT_FOUND: 4,
  RATE_LIMITED: 5,
} as const;

export type Format = 'json' | 'text';

export function formatOutput<T>(
  result: CliOutput<T>,
  format: Format = 'json',
): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  // text mode
  if (!result.ok) {
    return `Error [${result.error?.code ?? 'unknown'}]: ${result.error?.message ?? 'Unknown error'}`;
  }

  const data = result.data;
  if (data === null || data === undefined) return '';

  if (Array.isArray(data)) {
    return data.map(row => formatRow(row)).join('\n');
  }

  if (typeof data === 'object') {
    return formatRow(data as Record<string, unknown>);
  }

  return String(data);
}

function formatRow(row: Record<string, unknown>): string {
  return Object.entries(row)
    .map(([k, v]) => `${k}: ${v}`)
    .join('  |  ');
}

export function success<T>(data: T): CliOutput<T> {
  return { ok: true, data };
}

export function error(code: string, message: string): CliOutput<never> {
  return { ok: false, error: { code, message } };
}
