<script lang="ts" setup>
/**
 * Asking for a module to be taught, and what a lead does with those asks.
 * A request is a demand signal, never a queue position.
 */
definePageMeta({ title: 'Requests' })

const { data, refresh } = await useFetch('/api/module-requests')
const { data: catalogue } = await useFetch('/api/modules')

const mine = computed(() => data.value?.mine ?? [])
const board = computed(() => data.value?.board ?? [])

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
const { busy, actionError, act } = useAction(refresh)

const ask = () => act(async () => {
  await $fetch('/api/module-requests', {
    method: 'POST',
    body: { moduleId: chosen.value, note: note.value || null },
  })
  chosen.value = undefined
  note.value = ''
}, 'Asked. A lead will see it on their board.')

const withdrawRequest = (id: string) => act(
  () => $fetch(`/api/module-requests/${id}`, { method: 'DELETE' }),
  'Withdrawn',
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
            :loading="busy"
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
          <p class="text-xs text-muted">
            {{ row.requesters.map(person => person.name).join(', ') }}
          </p>
          <ul
            v-if="row.requesters.some(person => person.note)"
            class="text-xs text-muted list-disc pl-4"
          >
            <li
              v-for="person in row.requesters.filter(candidate => candidate.note)"
              :key="person.id"
            >
              {{ person.name }}: {{ person.note }}
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
    </section>
  </div>
</template>
