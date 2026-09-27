/**
 * An error that carries an HTTP status and is safe to expose to the client
 * (its `message` is sent as-is in the JSON response). Anything that isn't an
 * HttpError (or doesn't opt in via `expose`) is reported as a generic 500 so
 * internal details never leak.
 */
export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = options.expose ?? true;
    if (options.cause) this.cause = options.cause;
  }
}
