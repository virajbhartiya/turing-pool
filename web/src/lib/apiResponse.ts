const MAX_ERROR_DETAIL_LENGTH = 240;

function responseDetail(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_ERROR_DETAIL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`;
}

function jsonError(body: unknown): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
  ) {
    return responseDetail(body.error);
  }
  return undefined;
}

export async function responseJson<T>(
  response: Response,
  label = 'Vault API',
): Promise<T> {
  const text = await response.text();
  let body: unknown;

  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      const detail = responseDetail(text) || response.statusText || 'non-JSON response';
      throw new Error(`${label} returned ${response.status}: ${detail}`);
    }
  }

  if (!response.ok) {
    const detail = jsonError(body) ?? response.statusText;
    throw new Error(`${label} returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  if (body === undefined) {
    throw new Error(`${label} returned ${response.status} without a JSON body`);
  }

  return body as T;
}
