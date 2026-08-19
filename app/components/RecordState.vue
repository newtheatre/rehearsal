<script lang="ts" setup>
/**
 * How validity is shown, everywhere. EXPIRING is amber but not alarming: it
 * still counts as held (docs/records-and-expiry.md).
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

const formattedDate = computed(() => props.expiresAt ? formatDate(props.expiresAt) : null)
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
