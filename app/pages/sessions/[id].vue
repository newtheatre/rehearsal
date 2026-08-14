<script lang="ts" setup>
import type { SessionDetail } from '~~/shared/types/session'

const route = useRoute()

// Typed explicitly: Nuxt cannot resolve a typed route from a template-literal
// URL, so the shared contract stands in for inference (shared/types/session.ts).
const { data } = await useFetch<SessionDetail>(`/api/sessions/${route.params.id}`)
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: 'Session not found', fatal: true })
}

definePageMeta({ title: 'Session' })

function formatDate(iso: string) {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}
</script>

<template>
  <div
    v-if="data"
    class="space-y-6 max-w-3xl"
  >
    <UButton
      to="/sessions"
      variant="link"
      color="neutral"
      size="sm"
      icon="i-lucide-arrow-left"
      label="Sessions"
      class="px-0"
    />

    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          {{ formatDate(data.heldOn) }}
        </h1>
        <p class="text-muted mt-1">
          Delivered by {{ data.trainerName }}<span v-if="data.location"> at {{ data.location }}</span>
        </p>
      </div>
      <UBadge
        color="neutral"
        variant="subtle"
        :label="`${data.recordCount} record${data.recordCount === 1 ? '' : 's'}`"
      />
    </div>

    <UAlert
      v-if="!data.canEdit"
      icon="i-lucide-lock"
      color="neutral"
      variant="subtle"
      title="This session can no longer be edited"
      :description="`Sessions are editable for ${data.editWindowDays} days. After that, corrections are made record by record so each one carries its own reason.`"
    />

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Modules covered
        </h2>
      </template>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="module in data.modules"
          :key="module.id"
          :to="`/modules/${module.id}`"
          variant="outline"
          color="neutral"
          size="sm"
          :label="`${module.id} · ${module.name}`"
        />
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Attendees
        </h2>
      </template>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="attendee in data.attendees"
          :key="attendee.id"
          :to="`/people/${attendee.id}`"
          variant="outline"
          color="neutral"
          size="sm"
          :label="attendee.name"
        />
      </div>
    </UCard>

    <UCard v-if="data.notes">
      <template #header>
        <h2 class="font-semibold">
          Notes
        </h2>
      </template>
      <p class="text-sm whitespace-pre-wrap">
        {{ data.notes }}
      </p>
    </UCard>
  </div>
</template>
