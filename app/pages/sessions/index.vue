<script lang="ts" setup>
definePageMeta({ title: 'Sessions' })

const { data: me } = useMe()

const { data } = await useFetch('/api/sessions')
type SessionsPage = NonNullable<typeof data.value>

// Accumulated, because the log is the who-trained-whom evidence trail: older
// entries must stay reachable rather than falling off the end.
const pages = ref<SessionsPage[]>([])
watch(data, (value) => {
  if (value) pages.value = [value]
}, { immediate: true })

const sessions = computed(() => pages.value.flatMap(page => page.sessions))
const hasMore = computed(() => pages.value.at(-1)?.hasMore ?? false)
const loadingMore = ref(false)

async function loadMore() {
  const last = sessions.value.at(-1)
  if (!last) return

  loadingMore.value = true
  try {
    const page = await $fetch('/api/sessions', {
      query: { beforeHeldOn: last.heldOn, beforeId: last.id },
    })
    pages.value.push(page as SessionsPage)
  }
  finally {
    loadingMore.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">
          Sessions
        </h1>
        <p class="text-muted mt-1">
          Every session logged, and who delivered it.
        </p>
      </div>

      <UButton
        v-if="me?.isTrainer"
        to="/sessions/new"
        icon="i-lucide-clipboard-pen"
        label="Log a session"
      />
    </div>

    <UAlert
      v-if="!sessions.length"
      icon="i-lucide-calendar-off"
      color="neutral"
      variant="subtle"
      title="No sessions yet"
      :description="me?.isTrainer
        ? 'Log the first one: records are created from it.'
        : 'Sessions logged by trainers appear here.'"
    />

    <div
      v-else
      class="divide-y divide-default border border-default rounded-lg overflow-hidden"
    >
      <NuxtLink
        v-for="session in sessions"
        :key="session.id"
        :to="`/sessions/${session.id}`"
        class="flex items-center justify-between gap-4 p-4 hover:bg-elevated/50 transition-colors"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium">{{ formatDate(session.heldOn) }}</span>
            <UBadge
              v-for="moduleId in session.moduleIds"
              :key="moduleId"
              color="neutral"
              variant="subtle"
              size="sm"
              :label="moduleId"
            />
          </div>
          <p class="text-xs text-muted mt-0.5">
            {{ session.trainerName }}<span v-if="session.location"> · {{ session.location }}</span>
          </p>
        </div>

        <div class="flex items-center gap-3 text-sm shrink-0 text-muted">
          <span>{{ session.attendeeCount }} {{ session.attendeeCount === 1 ? 'attendee' : 'attendees' }}</span>
          <UIcon
            name="i-lucide-chevron-right"
            class="text-dimmed"
          />
        </div>
      </NuxtLink>
    </div>

    <div
      v-if="hasMore"
      class="flex justify-center"
    >
      <UButton
        :loading="loadingMore"
        variant="subtle"
        color="neutral"
        label="Load older sessions"
        @click="loadMore"
      />
    </div>
  </div>
</template>
