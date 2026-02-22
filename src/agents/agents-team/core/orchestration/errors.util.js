/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 * @returns {Error & { code: string, details?: unknown }}
 */
export function makeError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details !== undefined) err.details = details;
    return err;
}
