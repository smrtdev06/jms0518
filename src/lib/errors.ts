/**
 * An error with an HTTP status. Route wrappers (lib/http.ts, lib/extension.ts) turn it into a JSON error response.
 * For a 5xx error, pass the underlying error as `cause`: it goes to the server log, while the response shows only
 * the message.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
