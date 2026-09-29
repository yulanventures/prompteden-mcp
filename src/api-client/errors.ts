/**
 * Error types shared by the PromptEden API client.
 *
 * `ApiError` is thrown for any non-OK HTTP response after retries are
 * exhausted. It preserves the raw status, the parsed (or text-wrapped) body,
 * and the request path so callers can branch on machine-readable details
 * rather than parsing a message string.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build a human-readable message for an API error. Prefers `{ message, error }`
 * fields from the JSON body, and falls back to a status-only message.
 */
export function renderApiError(status: number, body: unknown, path: string): string {
  if (isRecord(body)) {
    const message = typeof body.message === 'string' ? body.message : undefined;
    const error = typeof body.error === 'string' ? body.error : undefined;
    if (message && error) return `PromptEden API error ${status} (${error}) at ${path}: ${message}`;
    if (message) return `PromptEden API error ${status} at ${path}: ${message}`;
    if (error) return `PromptEden API error ${status} (${error}) at ${path}`;
  }
  return `PromptEden API error ${status} at ${path}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly path: string;

  constructor(status: number, body: unknown, path: string) {
    super(renderApiError(status, body, path));
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}
