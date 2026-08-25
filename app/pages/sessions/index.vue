<script lang="ts" setup>
definePageMeta({ title: 'Sessions' })

const { data: me } = useMe()

const { data: schedule, error: scheduleError, status: scheduleStatus, refresh: refreshSchedule }
  = await useFetch('/api/sessions/upcoming')
const upcoming = computed(() => schedule.value?.sessions ?? [])
// The endpoint decides who may schedule; the template must not re-derive it.
const canSchedule = computed(() => schedule.value?.canSchedule ?? false)

/** A time is only worth printing when the session says one. */
function whenLine(session: { heldOn: string, startsAt: string | null }): string {
  return session.startsAt ? formatDateTime(session.startsAt) : formatDate(session.heldOn)
}

const { data, status, error, refresh } = await useFetch('/api/sessions')
type SessionsPage = NonNullable<typeof data.value>

// Accumulated, because the log is the who-trained-whom evidence trail: older
// entries must stay reachable rather than falling off the end.
const pages = ref<SessionsPage[]>([])
watch(data, (value) => {
  pages.value = value ? [value] : []
}, { immediate: true })

const sessions = computed(() => pages.value.flatMap(page => page.sessions))
const hasMore = computed(() => pages.value.at(-1)?.hasMore ?? false)
const loadingMore = ref(false)
const loadMoreError = ref<string | null>(null)

async function loadMore() {
  const last = sessions.value.at(-1)
  if (!last) return

  loadingMore.value = true
  loadMoreError.value = null
  try {
    const page = await $fetch('/api/sessions', {
      query: { beforeHeldOn: last.heldOn, beforeId: last.id },
    })
    pages.value.push(page as SessionsPage)
  }
  catch (e) {
    loadMoreError.value = errorMessage(e, 'Could not load any more sessions')
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
          What is coming up, and every session already delivered.
        </p>
      </div>

      <div
        v-if="canSchedule"
        class="flex flex-wrap gap-2"
      >
        <UButton
          to="/sessions/schedule"
          icon="i-lucide-calendar-plus"
          label="Schedule a session"
        />
        <UButton
          to="/sessions/new"
          icon="i-lucide-clipboard-pen"
          color="neutral"
          variant="outline"
          label="Log one already taught"
        />
      </div>
    </div>

    <LoadFailed
      v-if="scheduleError"
      :error="scheduleError"
      what="the schedule"
      :retrying="scheduleStatus === 'pending'"
      @retry="refreshSchedule"
    />

    <section
      v-if="upcoming.length"
      class="space-y-3"
    >
      <h2 class="font-semibold">
        Coming up
      </h2>

      <div class="divide-y divide-default border border-default rounded-lg overflow-hidden">
        <NuxtLink
          v-for="session in upcoming"
          :key="session.id"
          :to="`/sessions/${session.id}`"
          class="flex items-center justify-between gap-4 p-4 hover:bg-elevated/50 transition-colors"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ whenLine(session) }}</span>
              <UBadge
                v-for="moduleId in session.moduleIds"
                :key="moduleId"
                color="neutral"
                variant="subtle"
                size="sm"
                :label="moduleId"
              />
              <UBadge
                v-if="session.status === 'PLANNED'"
                color="neutral"
                variant="outline"
                size="sm"
                label="Not open yet"
              />
              <UBadge
                v-if="session.signedUp"
                :color="session.hasPlace ? 'success' : 'warning'"
                variant="subtle"
                size="sm"
                :label="session.hasPlace ? 'You are signed up' : 'You are on the waitlist'"
              />
            </div>
            <p class="text-xs text-muted mt-0.5">
              {{ session.trainerName }}<span v-if="session.location"> · {{ session.location }}</span>
            </p>
          </div>

          <div class="flex items-center gap-3 text-sm shrink-0 text-muted">
            <span v-if="session.placesLeft === null">{{ session.signupCount }} signed up</span>
            <span v-else-if="session.placesLeft > 0">{{ session.placesLeft }} place{{ session.placesLeft === 1 ? '' : 's' }} left</span>
            <span v-else>Waitlist</span>
            <UIcon
              name="i-lucide-chevron-right"
              class="text-dimmed"
            />
          </div>
        </NuxtLink>
      </div>
    </section>

    <h2
      v-if="sessions.length"
      class="font-semibold"
    >
      Already delivered
    </h2>

    <LoadFailed
      v-if="error"
      :error="error"
      what="the delivery log"
      :retrying="status === 'pending'"
      @retry="refresh"
    />

    <UAlert
      v-else-if="!sessions.length"
      icon="i-lucide-calendar-off"
      color="neutral"
      variant="subtle"
      title="No sessions yet"
      :description="me?.isTrainer
        ? 'Schedule one, or log the first one already taught.'
        : 'Sessions delivered by trainers appear here.'"
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

    <UAlert
      v-if="loadMoreError"
      icon="i-lucide-triangle-alert"
      color="error"
      variant="subtle"
      title="Could not load any more sessions"
      :description="loadMoreError"
    />

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
