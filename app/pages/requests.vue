<script lang="ts" setup>
/**
 * Asking for a module to be taught, and what a lead does with those asks.
 * A request is a demand signal, never a queue position.
 */
definePageMeta({ title: 'Requests' })

const { data, status, error, refresh } = await useFetch('/api/module-requests')
const { data: catalogue } = await useFetch('/api/modules')

const mine = computed(() => data.value?.mine ?? [])
const board = computed(() => data.value?.board.modules ?? [])
// The board is capped: a term's worth of asks must not become one long page.
const boardHasMore = computed(() => data.value?.board.hasMore ?? false)

const alreadyAsked = computed(() =>
  new Set(mine.value.filter(request => request.status === 'OPEN').map(request => request.moduleId)),
)

const moduleOptions = computed(() =>
  (catalogue.value?.modules ?? [])
    .filter(m => m.status === 'ACTIVE' && !alreadyAsked.value.has(m.id))
    .map(m => ({ label: `${m.id} · ${m.name}`, value: m.id })),
)

const chosen = ref<string | undefined>(undefined)
const note = ref('')
const { busy, busyWith, actionError, act } = useAction(refresh)

const ask = () => act(async () => {
  await $fetch('/api/module-requests', {
    method: 'POST',
    body: { moduleId: chosen.value, note: note.value || null },
  })
  chosen.value = undefined
  note.value = ''
}, 'Asked. A lead will see it on their board.')

// A lead answers a request they will not schedule. The requester is shown the
// reason, so the copy asks for a reply rather than a rejection.
const declining = ref<{ requestId: string, name: string, moduleId: string } | null>(null)
const declineReason = ref('')

function startDecline(person: { requestId: string, name: string }, moduleId: string) {
  declining.value = { requestId: person.requestId, name: person.name, moduleId }
  declineReason.value = ''
}

const sendDecline = () => act(async () => {
  await $fetch(`/api/module-requests/${declining.value!.requestId}/decline`, {
    method: 'POST',
    body: { reason: declineReason.value.trim() },
  })
  declining.value = null
}, 'Answered. They have been told why.', `decline:${declining.value?.requestId}`)

// Keyed on the request, so one withdrawal does not spin every row's button.
const withdrawRequest = (id: string) => act(
  () => $fetch(`/api/module-requests/${id}`, { method: 'DELETE' }),
  'Withdrawn',
  id,
)

const STATUS: Record<string, { label: string, color: 'neutral' | 'success' | 'warning' }> = {
  OPEN: { label: 'Waiting', color: 'warning' },
  SCHEDULED: { label: 'Scheduled', color: 'success' },
  WITHDRAWN: { label: 'Withdrawn', color: 'neutral' },
  DECLINED: { label: 'Answered', color: 'neutral' },
}
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <div>
      <h1 class="text-2xl font-bold">
        Requests
      </h1>
      <p class="text-muted mt-1">
        Ask for a module to be taught. It tells the department there is demand, nothing more.
      </p>
    </div>

    <UAlert
      v-if="actionError"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="actionError"
    />

    <LoadFailed
      v-if="error"
      :error="error"
      what="your requests"
      :retrying="status === 'pending'"
      @retry="refresh"
    />

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Ask for a module
        </h2>
      </template>
      <div class="space-y-4">
        <UFormField
          label="Module"
          required
        >
          <USelectMenu
            v-model="chosen"
            :items="moduleOptions"
            value-key="value"
            searchable
            placeholder="Search the catalogue"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Anything worth saying"
          help="When you are free, why you need it, who else wants it"
        >
          <UTextarea
            v-model="note"
            :rows="2"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <UButton
          label="Ask"
          icon="i-lucide-hand"
          :loading="busy"
          :disabled="!chosen"
          @click="ask"
        />
      </template>
    </UCard>

    <section
      v-if="mine.length"
      class="space-y-3"
    >
      <h2 class="font-semibold">
        What you have asked for
      </h2>
      <div class="border border-default rounded-lg divide-y divide-default overflow-hidden">
        <div
          v-for="request in mine"
          :key="request.id"
          class="flex items-start justify-between gap-4 p-4"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ request.moduleId }} · {{ request.moduleName }}</span>
              <UBadge
                :color="STATUS[request.status]?.color ?? 'neutral'"
                variant="subtle"
                size="sm"
                :label="STATUS[request.status]?.label ?? request.status"
              />
            </div>
            <p
              v-if="request.status === 'SCHEDULED' && request.resolvedSessionId"
              class="text-xs text-muted mt-1"
            >
              <NuxtLink
                :to="`/sessions/${request.resolvedSessionId}`"
                class="underline"
              >
                A session has been scheduled
              </NuxtLink>
            </p>
            <p
              v-else-if="request.declineReason"
              class="text-xs text-muted mt-1"
            >
              {{ request.declineReason }}
            </p>
          </div>
          <UButton
            v-if="request.status === 'OPEN'"
            label="Withdraw"
            size="xs"
            color="neutral"
            variant="ghost"
            :loading="busyWith(request.id)"
            @click="withdrawRequest(request.id)"
          />
        </div>
      </div>
    </section>

    <!-- Leads only: what their departments are being asked for. -->
    <section
      v-if="data?.canSeeBoard"
      class="space-y-3"
    >
      <h2 class="font-semibold">
        What people are asking for
      </h2>

      <UAlert
        v-if="!board.length"
        icon="i-lucide-inbox"
        color="neutral"
        variant="subtle"
        title="Nothing outstanding"
        description="When somebody asks for one of your department's modules it appears here."
      />

      <div
        v-else
        class="border border-default rounded-lg divide-y divide-default overflow-hidden"
      >
        <div
          v-for="row in board"
          :key="row.moduleId"
          class="p-4 space-y-2"
        >
          <div class="flex items-center justify-between gap-4">
            <NuxtLink
              :to="`/modules/${row.moduleId}`"
              class="font-medium hover:underline"
            >
              {{ row.moduleId }} · {{ row.moduleName }}
            </NuxtLink>
            <UBadge
              color="primary"
              variant="subtle"
              :label="`${row.openCount} waiting`"
            />
          </div>
          <ul class="text-xs text-muted space-y-1">
            <li
              v-for="person in row.requesters"
              :key="person.requestId"
              class="flex items-start justify-between gap-3"
            >
              <span>
                {{ person.name }}<template v-if="person.note">: {{ person.note }}</template>
              </span>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                label="Decline"
                :loading="busyWith(`decline:${person.requestId}`)"
                @click="startDecline(person, row.moduleId)"
              />
            </li>
            <li
              v-if="row.requestersNotShown"
              class="italic"
            >
              and {{ row.requestersNotShown }} more waiting
            </li>
          </ul>
          <UButton
            to="/sessions/schedule"
            size="xs"
            variant="outline"
            color="neutral"
            icon="i-lucide-calendar-plus"
            label="Schedule this"
          />
        </div>
      </div>

      <p
        v-if="boardHasMore"
        class="text-xs text-muted"
      >
        The busiest modules are shown first. Answer or schedule some of these to see the rest.
      </p>
    </section>

    <UModal
      :open="Boolean(declining)"
      title="Answer this request"
      @update:open="(value: boolean) => { if (!value) declining = null }"
    >
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            {{ declining?.name }} asked for {{ declining?.moduleId }}. They are shown what you write,
            so tell them where it stands rather than only that it is declined.
          </p>
          <UAlert
            v-if="actionError"
            icon="i-lucide-circle-alert"
            color="error"
            variant="subtle"
            :title="actionError"
          />
          <UTextarea
            v-model="declineReason"
            :rows="3"
            class="w-full"
            placeholder="Not running this term, but it is on the list for next"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            variant="ghost"
            color="neutral"
            label="Back"
            @click="() => { declining = null }"
          />
          <UButton
            label="Send reply"
            :loading="busyWith(`decline:${declining?.requestId}`)"
            :disabled="declineReason.trim().length < 3"
            @click="sendDecline"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
