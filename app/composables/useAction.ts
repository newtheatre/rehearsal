import { ref, useToast } from '#imports'

/**
 * One page action: a busy flag, an inline error, a refresh, then a toast.
 * The caller passes the `refresh` from its own `useFetch`.
 */
export function useAction(refresh: () => Promise<void>) {
  const toast = useToast()
  const busy = ref(false)
  const pendingKeys = ref(new Set<string>())
  const actionError = ref<string | null>(null)

  // Key an action per row and bind that row's button to `busyWith(key)`.
  // Unkeyed actions drive `busy`, so a page with one button binds `busy`.
  const busyWith = (key: string) => pendingKeys.value.has(key)

  function setPending(key: string | undefined, value: boolean) {
    if (key === undefined) busy.value = value
    else if (value) pendingKeys.value.add(key)
    else pendingKeys.value.delete(key)
  }

  async function act(fn: () => Promise<unknown>, success: string, key?: string) {
    setPending(key, true)
    actionError.value = null
    try {
      await fn()
      await refresh()
      toast.add({ title: success, icon: 'i-lucide-check', color: 'success' })
    }
    catch (e) {
      actionError.value = errorMessage(e, 'That did not work')
    }
    finally {
      setPending(key, false)
    }
  }

  return { busy, busyWith, actionError, act }
}
