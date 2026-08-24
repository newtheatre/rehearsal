<script lang="ts" setup>
/**
 * Amend a session that has not been taught. Records are untouched: only a
 * marked register awards (ADR-0013).
 */
import type { SessionDetail } from '~~/shared/types/session'

definePageMeta({ title: 'Amend session', middleware: 'trainer' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const { data } = await useFetch<SessionDetail>(`/api/sessions/${route.params.id}`)
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: 'Session not found', fatal: true })
}
if (!data.value.canAmend) {
  throw createError({ statusCode: 409, statusMessage: 'That session can no longer be amended', fatal: true })
}

const { data: catalogue } = await useFetch('/api/modules')

/** The stored instants read back as London wall-clock, which is what was typed. */
function timeOf(value: string | null): string {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London', hour12: false, hour: '2-digit', minute: '2-digit',
  })
}

const form = ref({
  heldOn: data.value.heldOn,
  startsTime: timeOf(data.value.startsAt),
  endsTime: timeOf(data.value.endsAt),
  moduleIds: data.value.modules.map(module => module.id),
  capacity: data.value.capacity,
  location: data.value.location ?? '',
  description: data.value.description ?? '',
  notes: data.value.notes ?? '',
})

const moduleOptions = computed(() =>
  (catalogue.value?.modules ?? [])
    .filter(m => m.kind !== 'CERTIFICATION' && m.status === 'ACTIVE')
    .map(m => ({ label: `${m.id} · ${m.name}`, value: m.id })),
)

const busy = ref(false)
const submitError = ref<string | null>(null)

async function submit() {
  busy.value = true
  submitError.value = null
  try {
    const result = await $fetch(`/api/sessions/${route.params.id}/schedule`, {
      method: 'PUT',
      body: {
        heldOn: form.value.heldOn,
        startsTime: form.value.startsTime || null,
        endsTime: form.value.endsTime || null,
        moduleIds: form.value.moduleIds,
        capacity: form.value.capacity || null,
        location: form.value.location || null,
        description: form.value.description || null,
        notes: form.value.notes || null,
      },
    })
    toast.add({
      title: 'Amended',
      description: result.promoted
        ? `${result.promoted} moved off the waitlist and were emailed.`
        : undefined,
      icon: 'i-lucide-check',
      color: 'success',
    })
    await router.push(`/sessions/${route.params.id}`)
  }
  catch (e) {
    submitError.value = errorMessage(e, 'Could not amend this session')
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
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
        Amend session
      </h1>
      <p class="text-muted mt-1">
        Nobody's records change. Raising the places emails anyone it lets in.
      </p>
    </div>

    <UAlert
      v-if="submitError"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="submitError"
    />

    <UCard>
      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField
            label="Date"
            required
          >
            <UInput
              v-model="form.heldOn"
              type="date"
              :min="today()"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Starts">
            <UInput
              v-model="form.startsTime"
              type="time"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Ends">
            <UInput
              v-model="form.endsTime"
              type="time"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField
          label="Modules taught"
          required
        >
          <USelectMenu
            v-model="form.moduleIds"
            :items="moduleOptions"
            value-key="value"
            multiple
            searchable
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Where">
            <UInput
              v-model="form.location"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Places"
            help="Lowering this moves the people at the back onto the waitlist"
          >
            <UInput
              v-model.number="form.capacity"
              type="number"
              :min="1"
              :max="60"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="What to expect">
          <UTextarea
            v-model="form.description"
            :rows="2"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Your notes"
          help="Only you and department leads see these"
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
          label="Save changes"
          icon="i-lucide-check"
          :loading="busy"
          :disabled="!form.heldOn || !form.moduleIds.length"
          @click="submit"
        />
      </template>
    </UCard>
  </div>
</template>
