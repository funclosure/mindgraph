import { err, errorItem } from './result.js';

function matchesType(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  return true;
}

function validateInput(input, schema) {
  const errors = [];
  if (!schema || schema.type !== 'object') return errors;
  for (const key of schema.required ?? []) {
    if (input[key] === undefined) errors.push(errorItem('missing_input', `Missing required input '${key}'`, key));
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (input[key] === undefined) continue;
    if (spec.type && !matchesType(input[key], spec.type)) {
      errors.push(errorItem('invalid_input', `Input '${key}' must be of type ${spec.type}`, key));
    }
  }
  return errors;
}

export function createRegistry(operations) {
  const byName = new Map(operations.map((op) => [op.name, op]));
  return {
    list() {
      return [...byName.values()].map(({ name, summary, inputSchema }) => ({ name, summary, inputSchema }));
    },
    get(name) {
      return byName.get(name) ?? null;
    },
    run(name, input = {}, ctx = {}) {
      const op = byName.get(name);
      if (!op) return err(errorItem('unknown_operation', `Unknown operation: ${name}`));
      const inputErrors = validateInput(input, op.inputSchema);
      if (inputErrors.length) return err(inputErrors);
      try {
        return op.handler(input, ctx);
      } catch (error) {
        return err(errorItem('operation_threw', error?.message ?? String(error)));
      }
    },
  };
}
