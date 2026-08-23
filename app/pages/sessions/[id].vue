<script lang="ts" setup>
import type { SessionDetail } from '~~/shared/types/session'

const route = useRoute()
const toast = useToast()

// Typed explicitly: Nuxt cannot resolve a typed route from a template-literal
// URL, so the shared contract stands in for inference (shared/types/session.ts).
const { data, refresh } = await useFetch<SessionDetail>(`/api/sessions/${route.params.id}`)
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: 'Session not found', fatal: true })
}

definePageMeta({ title: 'Session' })

const STATUS_BADGE: Record<SessionDetail['status'], { label: string, color: 'neutral' | 'success' | 'warning' | 'error' }> = {
  PLANNED: { label: 'Planned, not yet open', color: 'neutral' },
  OPEN: { label: 'Open for sign-ups', color: 'success' },
  FULL: { label: 'Full, waitlist open', color: 'warning' },
  DELIVERED: { label: 'Delivered', color: 'neutral' },
  CANCELLED: { label: 'Cancelled', color: 'error' },
}

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

const signUp = () => act(
  () => $fetch(`/api/sessions/${route.params.id}/signup`, { method: 'POST' }),
  'You are on the list',
)

const withdraw = () => act(
  () => $fetch(`/api/sessions/${route.params.id}/signup`, { method: 'DELETE' }),
  'Withdrawn',
)

const openSignups = () => act(
  () => $fetch(`/api/sessions/${route.params.id}/open`, { method: 'POST' }),
  'Open for sign-ups',
)

const cancelOpen = ref(false)
const cancelReason = ref('')

const cancel = () => act(
  async () => {
    await $fetch(`/api/sessions/${route.params.id}/cancel`, {
      method: 'POST',
      body: { reason: cancelReason.value },
    })
    cancelOpen.value = false
    cancelReason.value = ''
  },
  'Cancelled, and everyone signed up has been told',
)

/** A scheduled session is the only one with a sign-up sheet to show. */
const isScheduled = computed(() =>
  data.value ? ['PLANNED', 'OPEN', 'FULL'].includes(data.value.status) : false,
)

const whenLine = computed(() => {
  if (!data.value) return ''
  if (!data.value.startsAt) return formatDate(data.value.heldOn)
  const start = formatDateTime(data.value.startsAt)
  return data.value.endsAt
    ? `${start} to ${new Date(data.value.endsAt).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', timeStyle: 'short' })}`
    : start
})
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
          {{ whenLine }}
        </h1>
        <p class="text-muted mt-1">
          {{ data.status === 'DELIVERED' ? 'Delivered by' : 'Run by' }} {{ data.trainerName }}<span v-if="data.location"> at {{ data.location }}</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UBadge
          :color="STATUS_BADGE[data.status].color"
          variant="subtle"
          :label="STATUS_BADGE[data.status].label"
        />
        <UBadge
          v-if="data.status === 'DELIVERED'"
          color="neutral"
          variant="subtle"
          :label="`${data.recordCount} record${data.recordCount === 1 ? '' : 's'}`"
        />
      </div>
    </div>

    <UAlert
      v-if="actionError"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="actionError"
    />

    <UAlert
      v-if="data.status === 'CANCELLED'"
      icon="i-lucide-calendar-x"
      color="error"
      variant="subtle"
      title="This session was cancelled"
      :description="data.cancelReason ?? ''"
    />

    <UAlert
      v-if="data.status === 'DELIVERED' && !data.canEdit"
      icon="i-lucide-lock"
      color="neutral"
      variant="subtle"
      title="This session can no longer be edited"
      :description="`Sessions are editable for ${data.editWindowDays} days. After that, corrections are made record by record so each one carries its own reason.`"
    />

    <UCard v-if="data.description">
      <p class="text-sm whitespace-pre-wrap">
        {{ data.description }}
      </p>
    </UCard>

    <!-- Sign-up -->
    <UCard v-if="isScheduled">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold">
            Sign-ups
          </h2>
          <span class="text-sm text-muted">
            {{ data.signupCount }} signed up<span v-if="data.capacity"> of {{ data.capacity }} places</span>
          </span>
        </div>
      </template>

      <div class="space-y-3">
        <UAlert
          v-if="data.mine.signedUp && data.mine.hasPlace"
          icon="i-lucide-check"
          color="success"
          variant="subtle"
          title="You have a place"
          description="If you can no longer make it, withdraw so somebody on the waitlist can take it."
        />
        <UAlert
          v-else-if="data.mine.signedUp"
          icon="i-lucide-clock"
          color="warning"
          variant="subtle"
          :title="`You are number ${data.mine.waitlistPosition} on the waitlist`"
          description="We will email you the moment a place comes free."
        />
        <UAlert
          v-else-if="data.signupBlockedReason"
          icon="i-lucide-info"
          color="neutral"
          variant="subtle"
          :description="data.signupBlockedReason"
        />
        <p
          v-else-if="data.placesLeft === 0"
          class="text-sm text-muted"
        >
          This session is full, so signing up joins the waitlist. Places often come free.
        </p>

        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="data.canSignUp"
            :label="data.placesLeft === 0 ? 'Join the waitlist' : 'Sign up'"
            icon="i-lucide-user-plus"
            :loading="busy"
            @click="signUp"
          />
          <UButton
            v-if="data.mine.signedUp && data.status !== 'CANCELLED'"
            label="Withdraw"
            color="neutral"
            variant="outline"
            :loading="busy"
            @click="withdraw"
          />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Modules {{ data.status === 'DELIVERED' ? 'covered' : 'taught' }}
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

    <!-- Names go to whoever is running it; everyone else sees the count. -->
    <UCard v-if="data.attendees">
      <template #header>
        <h2 class="font-semibold">
          {{ data.status === 'DELIVERED' ? 'Attendees' : 'Who has signed up' }}
        </h2>
      </template>
      <div
        v-if="data.attendees.length"
        class="flex flex-wrap gap-2"
      >
        <UButton
          v-for="attendee in data.attendees"
          :key="attendee.id"
          :to="`/people/${attendee.id}`"
          variant="outline"
          :color="attendee.status === 'ABSENT' || !attendee.hasPlace ? 'neutral' : 'primary'"
          size="sm"
          :label="attendee.hasPlace ? attendee.name : `${attendee.name} (waitlist)`"
        />
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        Nobody yet.
      </p>
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

    <div
      v-if="data.canSteward && isScheduled"
      class="flex flex-wrap gap-2"
    >
      <UButton
        v-if="data.status === 'PLANNED'"
        label="Open for sign-ups"
        icon="i-lucide-door-open"
        :loading="busy"
        @click="openSignups"
      />
      <UButton
        v-else
        :to="`/sessions/${data.id}/register`"
        :label="data.registerOpened ? 'Carry on with the register' : 'Take the register'"
        icon="i-lucide-clipboard-check"
      />
      <UButton
        label="Cancel this session"
        color="error"
        variant="outline"
        icon="i-lucide-calendar-x"
        @click="() => { cancelOpen = true }"
      />
    </div>

    <UModal
      v-model:open="cancelOpen"
      title="Cancel this session"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Everyone signed up is emailed the reason you give. Nothing is recorded against anybody,
            and the session stays visible so people can see what happened.
          </p>
          <UFormField
            label="Reason"
            required
          >
            <UTextarea
              v-model="cancelReason"
              :rows="2"
              placeholder="The rig is out of action until next week"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Keep it"
            color="neutral"
            variant="ghost"
            @click="() => { cancelOpen = false }"
          />
          <UButton
            label="Cancel session"
            color="error"
            :loading="busy"
            :disabled="cancelReason.trim().length < 3"
            @click="cancel"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
