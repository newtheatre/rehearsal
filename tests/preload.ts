/**
 * Bun test bootstrap: swaps the D1 binding for the in-memory double, then
 * loads the globals. Registered as `preload` in bunfig.toml.
 */

import { mock } from 'bun:test'

// Nuxt resolves `@nuxthub/db` from the hub layer, which needs a real
// binding. Tests get the sqlite double instead.
const double = await import('./mocks/nuxthub-db')
mock.module('@nuxthub/db', () => double)

await import('./setup')
