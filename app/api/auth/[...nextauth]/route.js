/* Auth.js route handlers.
 *
 * NextAuth() returns `handlers` — an OBJECT holding GET and POST. It does NOT
 * export GET and POST as top-level bindings, so
 *
 *     export { GET, POST } from "../../../../auth.js";   // WRONG
 *
 * re-exports two undefined values. The route then exists with no valid method
 * handler, and Next.js answers 405 Method Not Allowed to everything — including
 * Google's callback after the user clicks Allow. It builds without complaint,
 * which is what let it survive to production.
 */
import { handlers } from "../../../../auth.js";

export const { GET, POST } = handlers;
