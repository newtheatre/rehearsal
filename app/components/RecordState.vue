<script lang="ts" setup>
/**
 * How a record's validity is shown, everywhere. One component so the
 * dashboard, the directory and a person's page can never disagree about what
 * "expiring" looks like.
 *
 * EXPIRING is deliberately amber-but-not-alarming: it still counts as held
 * (docs/records-and-expiry.md), and dressing it as a failure would tell
 * people their training has lapsed when it hasn't.
 */
const props = defineProps<{
  state: 'VALID' | 'EXPIRING' | 'EXPIRED' | null
  expiresAt?: string | null
  /** Show the date alongside the label. */
  withDate?: boolean
}>()

const config = computed(() => {
  switch (props.state) {
    case 'EXPIRED':
      return { color: 'error' as const, icon: 'i-lucide-circle-x', label: 'Expired' }
    case 'EXPIRING':
      return { color: 'warning' as const, icon: 'i-lucide-clock-alert', label: 'Renew soon' }
    case 'VALID':
      return { color: 'success' as const, icon: 'i-lucide-circle-check', label: 'Valid' }
    default:
      return null
  }
})

const formattedDate = computed(() => {
  if (!props.expiresAt) return null
  const [year, month, day] = props.expiresAt.split('-')
  return `${day}/${month}/${year}`
})
</script>

<template>
  <div
    v-if="config"
    class="flex items-center gap-2"
  >
    <UBadge
      :color="config.color"
      variant="subtle"
      size="sm"
      :icon="config.icon"
      :label="config.label"
    />
    <span
      v-if="withDate && formattedDate"
      class="text-xs text-muted"
    >
      {{ state === 'EXPIRED' ? 'since' : 'until' }} {{ formattedDate }}
    </span>
    <span
      v-else-if="withDate"
      class="text-xs text-muted"
    >
      no expiry
    </span>
  </div>
</template>
