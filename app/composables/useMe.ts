/**
 * The caller's abilities, fetched once per page load. For rendering only —
 * the server re-checks everything (docs/permissions.md).
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
