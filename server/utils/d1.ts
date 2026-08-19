/**
 * D1 caps bound parameters at 100 per statement. Any list whose length tracks
 * a row count must be chunked, or scoped by subquery instead.
 */
export const D1_PARAM_CHUNK = 90

export function chunk<T>(items: T[], size = D1_PARAM_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
