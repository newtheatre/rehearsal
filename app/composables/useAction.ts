import { ref, useToast } from '#imports'

/**
 * One page action: a busy flag, an inline error, a refresh, then a toast.
 * The caller passes the `refresh` from its own `useFetch`.
 */
export function useAction(refresh: () => Promise<void>) {
  const toast = useToast()
  const busy = ref(false)
  const actionError = ref<string | null>(null)

  async function act(fn: () => Promise<unknown>, success: string) {
    busy.value = true
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
      busy.value = false
    }
  }

  return { busy, actionError, act }
}
