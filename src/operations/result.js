export function ok(value) {
  return { ok: true, value, errors: [] };
}

export function err(errors) {
  return { ok: false, errors: Array.isArray(errors) ? errors : [errors] };
}

export function errorItem(code, message, path) {
  return path === undefined ? { code, message } : { code, message, path };
}
