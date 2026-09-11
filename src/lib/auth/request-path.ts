/**
 * The header the middleware copies the request's own path onto.
 *
 * Its own module, and not an export from `src/middleware.ts`, because
 * importing the middleware entry point from application code pulls it into
 * the app's module graph — Next then resolves it as both a middleware and an
 * ordinary module, and routing stops working. Every route but `/` returned
 * 404, with nothing in the log to say why.
 *
 * A constant shared by a middleware and a guard belongs in neither of them.
 */
export const PATHNAME_HEADER = 'x-livd-pathname';
