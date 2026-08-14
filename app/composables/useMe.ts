/**
 * The caller's abilities, fetched once per page load and shared.
 *
 * For rendering only — hiding a button is a courtesy, not a permission check
 * (docs/permissions.md). The server re-checks everything.
 */
export function useMe() {
  return useFetch('/api/me', {
    key: 'me',
    default: () => ({
      user: { id: '', name: '', email: '' },
      isAdmin: false,
      leadOf: [] as string[],
      isTrainer: false,
      canSeeDrafts: false,
    }),
  })
}
