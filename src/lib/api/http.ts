// Tiny shared helpers for API route responses. Keeps route handlers thin and
// consistent (every error is `{ error: { code, message } }`).

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}