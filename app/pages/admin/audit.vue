<script lang="ts" setup>
definePageMeta({ title: 'Audit log', middleware: 'admin' })

const action = ref<string | undefined>(undefined)
const search = ref('')
const before = ref<number | undefined>(undefined)
const beforeId = ref<string | undefined>(undefined)

const query = computed(() => ({
  ...(action.value ? { action: action.value } : {}),
  ...(search.value.trim() ? { q: search.value.trim() } : {}),
  ...(before.value ? { before: before.value } : {}),
  ...(beforeId.value ? { beforeId: beforeId.value } : {}),
}))

const { data, status } = await useFetch('/api/admin/audit', { query })

const expanded = ref<string | null>(null)

// Filtering starts a new page run: otherwise a cursor from the old filter
// silently drops the first results of the new one.
watch([action, search], () => {
  before.value = undefined
  beforeId.value = undefined
})

function nextPage() {
  const entries = data.value?.entries ?? []
  const last = entries[entries.length - 1]
  if (!last) return
  before.value = new Date(last.createdAt).getTime()
  beforeId.value = last.id
}

function auditTime(value: string | Date) {
  return formatDateTime(value, { seconds: true })
}

/** Colour by what the action does, not by which noun it acts on. */
function tone(actionName: string) {
  if (actionName.includes('revoke') || actionName.includes('remove') || actionName.includes('anonymise')) return 'error'
  if (actionName.includes('create') || actionName.includes('signoff') || actionName.includes('add')) return 'success'
  if (actionName.includes('sweep') || actionName.includes('merge')) return 'neutral'
  return 'warning'
}
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <div>
      <h1 class="text-2xl font-bold">
        Audit log
      </h1>
      <p class="text-muted mt-1">
        Every privileged change, who made it and when. Append-only.
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <USelect
        v-model="action"
        :items="[
          { label: 'All actions', value: undefined },
          ...(data?.actions ?? []).map(a => ({ label: a, value: a })),
        ]"
        class="w-56"
      />
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search target or detail"
        class="w-64"
      />
    </div>

    <div
      v-if="status === 'pending'"
      class="space-y-2"
    >
      <USkeleton
        v-for="n in 6"
        :key="n"
        class="h-12 w-full"
      />
    </div>

    <UAlert
      v-else-if="!data?.entries.length"
      icon="i-lucide-scroll-text"
      color="neutral"
      variant="subtle"
      title="Nothing to show"
      description="No entries match. A brand-new database has none until something privileged happens."
    />

    <div
      v-else
      class="border border-default rounded-lg divide-y divide-default"
    >
      <div
        v-for="entry in data.entries"
        :key="entry.id"
      >
        <button
          type="button"
          class="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-elevated/40 transition-colors"
          @click="expanded = expanded === entry.id ? null : entry.id"
        >
          <div class="flex items-center gap-3 min-w-0">
            <UBadge
              :color="tone(entry.action)"
              variant="subtle"
              size="sm"
              :label="entry.action"
            />
            <code class="text-xs font-mono text-muted truncate">{{ entry.target }}</code>
          </div>
          <div class="flex items-center gap-3 shrink-0 text-xs text-muted">
            <span>{{ entry.actorName ?? 'system' }}</span>
            <span>{{ auditTime(entry.createdAt) }}</span>
            <UIcon
              :name="expanded === entry.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="text-dimmed"
            />
          </div>
        </button>

        <pre
          v-if="expanded === entry.id && entry.detail"
          class="text-xs bg-elevated/50 p-3 overflow-x-auto"
        >{{ JSON.stringify(entry.detail, null, 2) }}</pre>
      </div>
    </div>

    <div
      v-if="data?.hasMore"
      class="flex justify-center"
    >
      <UButton
        label="Older entries"
        variant="outline"
        color="neutral"
        @click="nextPage"
      />
    </div>
  </div>
</template>
