<script lang="ts" setup>
/**
 * A list that failed to load says so. An empty list and a failed one look the
 * same, and "nobody is rigging-certified" is an answer a lead acts on.
 */
const props = defineProps<{
  error: unknown
  /** What could not be loaded, lower case: "the directory", "the schedule". */
  what: string
  retrying?: boolean
}>()

defineEmits<{ retry: [] }>()

const description = computed(() =>
  errorMessage(props.error, 'The training system did not answer. This is not an answer about anybody\'s training.'),
)
</script>

<template>
  <UAlert
    icon="i-lucide-triangle-alert"
    color="error"
    variant="subtle"
    :title="`Could not load ${what}`"
    :description="description"
    :actions="[{ label: 'Try again', color: 'neutral', variant: 'subtle', loading: retrying, onClick: () => $emit('retry') }]"
  />
</template>
