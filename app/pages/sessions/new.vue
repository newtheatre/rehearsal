<script lang="ts" setup>
/**
 * Log a session. Two steps on purpose: the review step shows the exact
 * records that will exist before any are created.
 */
definePageMeta({ title: 'Log a session', middleware: 'trainer' })

const toast = useToast()
const router = useRouter()

const { data: catalogue } = await useFetch('/api/modules')
const { data: directory, refresh: refreshDirectory } = await useFetch('/api/people')

const todayIso = today()

const form = ref({
  heldOn: todayIso,
  moduleIds: [] as string[],
  attendeeIds: [] as string[],
  location: '',
  notes: '',
})

const moduleOptions = computed(() =>
  (catalogue.value?.modules ?? [])
    // Certifications are signed off after a supervised practical, not
    // handed out in a session: the server refuses them too.
    .filter(m => m.kind !== 'CERTIFICATION' && m.status === 'ACTIVE')
    .map(m => ({ label: `${m.id} · ${m.name}`, value: m.id })),
)

const attendeeOptions = computed(() =>
  (directory.value?.people ?? []).map(p => ({ label: p.name, value: p.id })),
)

// ── Add by email ────────────────────────────────────────────────────────────

const addByEmailOpen = ref(false)
const addBusy = ref(false)
const addError = ref<string | null>(null)
const newAttendee = ref({ email: '', name: '' })

async function addAttendee() {
  addBusy.value = true
  addError.value = null
  try {
    const attendee = await $fetch('/api/attendees/lookup', {
      method: 'POST',
      body: { email: newAttendee.value.email, name: newAttendee.value.name || undefined },
    })
    await refreshDirectory()
    if (!form.value.attendeeIds.includes(attendee.id)) {
      form.value.attendeeIds = [...form.value.attendeeIds, attendee.id]
    }
    toast.add({
      title: attendee.created ? `${attendee.name} added` : `${attendee.name} was already known`,
      icon: 'i-lucide-user-plus',
      color: 'success',
    })
    addByEmailOpen.value = false
    newAttendee.value = { email: '', name: '' }
  }
  catch (e) {
    addError.value = errorMessage(e, 'Could not add that person')
  }
  finally {
    addBusy.value = false
  }
}

// ── Review ──────────────────────────────────────────────────────────────────

interface PreviewRecord {
  userId: string
  moduleId: string
  moduleName: string
  awardedAt: string
  expiresAt: string | null
}
interface Warning {
  userId: string
  name: string
  moduleId: string
  missing: { moduleId: string, name: string, state: string | null }[]
}

const preview = ref<{
  recordCount: number
  records: PreviewRecord[]
  warnings: Warning[]
  blocking: Warning[]
} | null>(null)
const reviewing = ref(false)
const reviewError = ref<string | null>(null)

const canReview = computed(() =>
  form.value.moduleIds.length > 0 && form.value.attendeeIds.length > 0,
)

async function review() {
  reviewing.value = true
  reviewError.value = null
  try {
    preview.value = await $fetch('/api/sessions/check', { method: 'POST', body: payload() })
  }
  catch (e) {
    reviewError.value = errorMessage(e, 'Could not check this session')
  }
  finally {
    reviewing.value = false
  }
}

// ── Submit ──────────────────────────────────────────────────────────────────

const submitting = ref(false)
const submitError = ref<string | null>(null)

function payload() {
  return {
    heldOn: form.value.heldOn,
    moduleIds: form.value.moduleIds,
    attendeeIds: form.value.attendeeIds,
    location: form.value.location || null,
    notes: form.value.notes || null,
  }
}

async function submit() {
  submitting.value = true
  submitError.value = null
  try {
    const result = await $fetch('/api/sessions', {
      method: 'POST',
      body: { ...payload(), acknowledgeWarnings: (preview.value?.warnings.length ?? 0) > 0 },
    })
    toast.add({
      title: `Session logged: ${result.recordCount} records created`,
      icon: 'i-lucide-check',
      color: 'success',
    })
    await router.push(`/sessions/${result.id}`)
  }
  catch (e) {
    submitError.value = errorMessage(e, 'Could not log this session')
  }
  finally {
    submitting.value = false
  }
}

const attendeeName = (id: string) =>
  (directory.value?.people ?? []).find(p => p.id === id)?.name ?? id

// Any edit invalidates the review: the confirm screen must always describe
// what is actually about to be written.
watch(form, () => {
  preview.value = null
}, { deep: true })
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div>
      <h1 class="text-2xl font-bold">
        Log a session
      </h1>
      <p class="text-muted mt-1">
        Records are created from what you enter here.
      </p>
    </div>

    <UAlert
      v-if="reviewError || submitError"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="reviewError || submitError || ''"
    />

    <UCard>
      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Date held"
            required
          >
            <UInput
              v-model="form.heldOn"
              type="date"
              :max="todayIso"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Location">
            <UInput
              v-model="form.location"
              placeholder="Main house"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField
          label="Modules covered"
          required
          help="Certifications are signed off on a person's page, not logged here"
        >
          <USelectMenu
            v-model="form.moduleIds"
            :items="moduleOptions"
            value-key="value"
            multiple
            searchable
            placeholder="Choose modules"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Attendees"
          required
        >
          <div class="flex gap-2">
            <USelectMenu
              v-model="form.attendeeIds"
              :items="attendeeOptions"
              value-key="value"
              multiple
              searchable
              placeholder="Choose attendees"
              class="flex-1"
            />
            <UButton
              icon="i-lucide-user-plus"
              variant="outline"
              color="neutral"
              aria-label="Add by email"
              @click="() => { addByEmailOpen = true }"
            />
          </div>
        </UFormField>

        <UFormField
          label="Notes"
          help="What was covered, anything worth remembering"
        >
          <UTextarea
            v-model="form.notes"
            :rows="2"
            class="w-full"
          />
        </UFormField>
      </div>

      <template #footer>
        <UButton
          label="Review"
          trailing-icon="i-lucide-arrow-right"
          :loading="reviewing"
          :disabled="!canReview"
          @click="review"
        />
      </template>
    </UCard>

    <!-- Confirm step -->
    <UCard v-if="preview">
      <template #header>
        <h2 class="font-semibold">
          About to create {{ preview.recordCount }} record{{ preview.recordCount === 1 ? '' : 's' }}
        </h2>
      </template>

      <div class="space-y-4">
        <UAlert
          v-if="preview.blocking.length"
          icon="i-lucide-octagon-x"
          color="error"
          variant="subtle"
          title="Blocked: safety-critical prerequisites are missing"
          :description="preview.blocking
            .map(b => `${b.name}, ${b.moduleId} needs ${b.missing.map(m => m.moduleId).join(', ')}`)
            .join('; ')"
        />

        <UAlert
          v-if="preview.warnings.length"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="subtle"
          title="Some attendees are missing prerequisites"
          :description="`${preview.warnings
            .map(w => `${w.name}, ${w.moduleId} usually needs ${w.missing.map(m => m.moduleId).join(', ')}`)
            .join('; ')}. You can go ahead if you know why.`"
        />

        <div class="border border-default rounded-lg divide-y divide-default text-sm">
          <div
            v-for="record in preview.records"
            :key="`${record.userId}-${record.moduleId}`"
            class="flex items-center justify-between gap-3 p-2.5"
          >
            <span>{{ attendeeName(record.userId) }}</span>
            <span class="text-muted">{{ record.moduleId }}</span>
            <span class="text-xs text-muted">
              {{ record.expiresAt ? `expires ${formatDate(record.expiresAt)}` : 'no expiry' }}
            </span>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Back"
            color="neutral"
            variant="ghost"
            @click="() => { preview = null }"
          />
          <UButton
            :label="preview.warnings.length ? 'Log anyway' : 'Log session'"
            :color="preview.warnings.length ? 'warning' : 'primary'"
            :loading="submitting"
            :disabled="preview.blocking.length > 0"
            @click="submit"
          />
        </div>
      </template>
    </UCard>

    <UModal
      v-model:open="addByEmailOpen"
      title="Add someone by email"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="addError"
            icon="i-lucide-circle-alert"
            color="error"
            variant="subtle"
            :description="addError"
          />
          <p class="text-sm text-muted">
            For someone who hasn't signed in yet. Their training attaches to the account
            they'll claim when they first sign in with Google.
          </p>
          <UFormField
            label="Email"
            required
          >
            <UInput
              v-model="newAttendee.email"
              type="email"
              placeholder="name@nottingham.ac.uk"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Name">
            <UInput
              v-model="newAttendee.name"
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
            @click="() => { addByEmailOpen = false }"
          />
          <UButton
            label="Add"
            :loading="addBusy"
            :disabled="!newAttendee.email"
            @click="addAttendee"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
