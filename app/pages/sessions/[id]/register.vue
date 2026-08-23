<script lang="ts" setup>
/**
 * The register, on a phone, in a rehearsal room. Marking it is what creates
 * records, so the confirm step says exactly what is about to happen.
 */
definePageMeta({ title: 'Register', middleware: 'trainer' })

const route = useRoute()
const toast = useToast()
const router = useRouter()

interface RegisterEntry {
  userId: string
  name: string
  hasPlace: boolean
  status: 'SIGNED_UP' | 'CANCELLED' | 'ATTENDED' | 'ABSENT'
}
interface RegisterView {
  id: string
  heldOn: string
  status: string
  capacity: number | null
  registerOpened: boolean
  marked: boolean
  register: RegisterEntry[]
}

const { data, refresh } = await useFetch<RegisterView>(`/api/sessions/${route.params.id}/register`)
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: 'Session not found', fatal: true })
}

const { data: directory, refresh: refreshDirectory } = await useFetch('/api/directory')

/** Nobody is present until somebody says so: an unticked register awards nothing. */
const present = ref<Record<string, boolean>>({})
watchEffect(() => {
  for (const entry of data.value?.register ?? []) {
    if (!(entry.userId in present.value)) present.value[entry.userId] = false
  }
})

const presentCount = computed(() =>
  (data.value?.register ?? []).filter(entry => present.value[entry.userId]).length,
)
const absentCount = computed(() => (data.value?.register ?? []).length - presentCount.value)

const busy = ref(false)
const actionError = ref<string | null>(null)

async function openRegister() {
  busy.value = true
  actionError.value = null
  try {
    await $fetch(`/api/sessions/${route.params.id}/register/open`, { method: 'POST' })
    await refresh()
  }
  catch (e) {
    actionError.value = errorMessage(e, 'Could not open the register')
  }
  finally {
    busy.value = false
  }
}

// ── Adding a walk-in ────────────────────────────────────────────────────────

const addOpen = ref(false)
const addChoice = ref<string | undefined>(undefined)
const addEmail = ref('')

const alreadyOn = computed(() => new Set((data.value?.register ?? []).map(entry => entry.userId)))
const addOptions = computed(() =>
  (directory.value?.people ?? [])
    .filter(person => !alreadyOn.value.has(person.id))
    .map(person => ({ label: person.name, value: person.id })),
)

async function addWalkIn() {
  busy.value = true
  actionError.value = null
  try {
    let userId = addChoice.value
    if (!userId && addEmail.value) {
      const attendee = await $fetch('/api/attendees/lookup', {
        method: 'POST',
        body: { email: addEmail.value },
      })
      await refreshDirectory()
      userId = attendee.id
    }
    if (!userId) return

    await $fetch(`/api/sessions/${route.params.id}/attendees`, {
      method: 'POST',
      body: { userId },
    })
    // Somebody the lead added by hand is here: that is why they added them.
    present.value[userId] = true
    await refresh()
    addOpen.value = false
    addChoice.value = undefined
    addEmail.value = ''
  }
  catch (e) {
    actionError.value = errorMessage(e, 'Could not add that person')
  }
  finally {
    busy.value = false
  }
}

// ── Submitting ──────────────────────────────────────────────────────────────

const confirmOpen = ref(false)
const warnings = ref<{ name: string, moduleId: string }[]>([])

async function submit(acknowledgeWarnings = false) {
  busy.value = true
  actionError.value = null
  try {
    const result = await $fetch(`/api/sessions/${route.params.id}/register`, {
      method: 'POST',
      body: {
        marks: (data.value?.register ?? []).map(entry => ({
          userId: entry.userId,
          present: Boolean(present.value[entry.userId]),
        })),
        acknowledgeWarnings,
      },
    })
    confirmOpen.value = false
    toast.add({
      title: `${result.recordCount} record${result.recordCount === 1 ? '' : 's'} created`,
      description: result.absent
        ? `${result.absent} marked absent and emailed.`
        : undefined,
      icon: 'i-lucide-check',
      color: 'success',
    })
    await router.push(`/sessions/${route.params.id}`)
  }
  catch (e) {
    const data = (e as { data?: { data?: { warnings?: { name: string, moduleId: string }[], requiresAcknowledgement?: boolean } } }).data?.data
    if (data?.requiresAcknowledgement && data.warnings) {
      warnings.value = data.warnings
      confirmOpen.value = true
      return
    }
    actionError.value = errorMessage(e, 'Could not mark the register')
    confirmOpen.value = false
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    v-if="data"
    class="space-y-6 max-w-xl"
  >
    <UButton
      :to="`/sessions/${route.params.id}`"
      variant="link"
      color="neutral"
      size="sm"
      icon="i-lucide-arrow-left"
      label="Session"
      class="px-0"
    />

    <div>
      <h1 class="text-2xl font-bold">
        Register
      </h1>
      <p class="text-muted mt-1">
        {{ formatDate(data.heldOn) }}. Marking this is what creates the records.
      </p>
    </div>

    <UAlert
      v-if="actionError"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="actionError"
    />

    <UAlert
      v-if="data.marked"
      icon="i-lucide-check"
      color="success"
      variant="subtle"
      title="This register has been marked"
      description="Records were created from it. Corrections go through the session's edit window."
    />

    <template v-else-if="!data.registerOpened">
      <UAlert
        icon="i-lucide-clipboard-list"
        color="neutral"
        variant="subtle"
        title="Not taking the register yet"
        description="Opening it closes sign-ups, so do it when you are about to start."
      />
      <UButton
        label="Open the register"
        icon="i-lucide-clipboard-check"
        size="lg"
        :loading="busy"
        @click="openRegister"
      />
    </template>

    <template v-else>
      <div class="border border-default rounded-lg divide-y divide-default overflow-hidden">
        <button
          v-for="entry in data.register"
          :key="entry.userId"
          type="button"
          class="w-full flex items-center justify-between gap-3 p-4 text-left transition-colors"
          :class="present[entry.userId] ? 'bg-success/10' : 'hover:bg-elevated/50'"
          @click="present[entry.userId] = !present[entry.userId]"
        >
          <div class="min-w-0">
            <span class="font-medium">{{ entry.name }}</span>
            <UBadge
              v-if="!entry.hasPlace"
              class="ml-2"
              color="neutral"
              variant="subtle"
              size="sm"
              label="Waitlist"
            />
          </div>
          <UIcon
            :name="present[entry.userId] ? 'i-lucide-circle-check' : 'i-lucide-circle'"
            class="size-6 shrink-0"
            :class="present[entry.userId] ? 'text-success' : 'text-dimmed'"
          />
        </button>
      </div>

      <p
        v-if="!data.register.length"
        class="text-sm text-muted"
      >
        Nobody signed up. You can still add whoever turned up.
      </p>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">
          {{ presentCount }} here, {{ absentCount }} not
        </span>
        <UButton
          label="Add someone"
          icon="i-lucide-user-plus"
          color="neutral"
          variant="outline"
          @click="() => { addOpen = true }"
        />
      </div>

      <UAlert
        v-if="absentCount"
        icon="i-lucide-mail"
        color="neutral"
        variant="subtle"
        :title="`${absentCount} ${absentCount === 1 ? 'person gets' : 'people get'} a 'sorry we missed you' email`"
        description="They get no record for this session, so anything needing it stays outstanding for them."
      />

      <UButton
        label="Mark the register"
        icon="i-lucide-check"
        size="lg"
        block
        :loading="busy"
        :disabled="!data.register.length"
        @click="() => submit(false)"
      />
    </template>

    <UModal
      v-model:open="confirmOpen"
      title="Some people are missing prerequisites"
    >
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            You can go ahead if you know why. The records will still be created.
          </p>
          <ul class="text-sm list-disc pl-5 space-y-1">
            <li
              v-for="warning in warnings"
              :key="`${warning.name}-${warning.moduleId}`"
            >
              {{ warning.name }}, for {{ warning.moduleId }}
            </li>
          </ul>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Go back"
            color="neutral"
            variant="ghost"
            @click="() => { confirmOpen = false }"
          />
          <UButton
            label="Mark anyway"
            color="warning"
            :loading="busy"
            @click="() => submit(true)"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="addOpen"
      title="Add someone to the register"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Someone already known">
            <USelectMenu
              v-model="addChoice"
              :items="addOptions"
              value-key="value"
              searchable
              placeholder="Search by name"
              class="w-full"
            />
          </UFormField>
          <p class="text-sm text-muted">
            Or, for somebody who has never signed in, add them by email. Their training attaches to
            the account they claim when they first sign in.
          </p>
          <UFormField label="Email">
            <UInput
              v-model="addEmail"
              type="email"
              placeholder="name@nottingham.ac.uk"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="() => { addOpen = false }"
          />
          <UButton
            label="Add"
            :loading="busy"
            :disabled="!addChoice && !addEmail"
            @click="addWalkIn"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
