<script lang="ts" setup>
/**
 * Kind, status, expiry policy and safety flag. One component, so no two
 * screens describe the same module differently.
 */
defineProps<{
  module: {
    kind: string
    status: string
    expiryMode: string
    expiryMonths?: number | null
    safetyCritical?: boolean
  }
  showStatus?: boolean
}>()

function expiryLabel(mode: string, months?: number | null): string | null {
  if (mode === 'ACADEMIC_YEAR') return 'Renew each year'
  if (mode === 'MONTHS') return `Renew every ${months} months`
  return null
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <UBadge
      v-if="module.kind === 'CERTIFICATION'"
      color="secondary"
      variant="subtle"
      size="sm"
      icon="i-lucide-award"
      label="Certification"
    />
    <UBadge
      v-else-if="module.kind === 'BRIEF'"
      color="neutral"
      variant="subtle"
      size="sm"
      icon="i-lucide-megaphone"
      label="Brief"
    />

    <UBadge
      v-if="module.safetyCritical"
      color="error"
      variant="subtle"
      size="sm"
      icon="i-lucide-triangle-alert"
      label="Safety critical"
    />

    <UBadge
      v-if="expiryLabel(module.expiryMode, module.expiryMonths)"
      color="warning"
      variant="subtle"
      size="sm"
      icon="i-lucide-clock"
      :label="expiryLabel(module.expiryMode, module.expiryMonths)!"
    />

    <UBadge
      v-if="showStatus && module.status === 'DRAFT'"
      color="neutral"
      variant="outline"
      size="sm"
      label="Draft"
    />
    <UBadge
      v-if="showStatus && module.status === 'RETIRED'"
      color="neutral"
      variant="outline"
      size="sm"
      label="Retired"
    />
  </div>
</template>
