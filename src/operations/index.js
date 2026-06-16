import { createRegistry } from './registry.js';
import { operations } from './catalog.js';

export const registry = createRegistry(operations);
export { operations };
