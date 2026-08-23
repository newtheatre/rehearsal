<script lang="ts" setup>
/**
 * Put a session in the diary. Nothing here creates a record: that happens
 * when the register is marked (docs/scheduling-design.md §6).
 */
definePageMeta({ title: 'Schedule a session', middleware: 'trainer' })

const toast = useToast()
const router = useRouter()

const { data: catalogue } = await useFetch('/api/modules')

const form = ref({
  heldOn: '',
  startsAt: '',
  endsAt: '',
  moduleIds: [] as string[],
  capacity: null as number | null,
  location: '',
  description: '',
  notes: '',
  openNow: true,
})

const moduleOptions = computed(() =>
  (catalogue.value?.modules ?? [])
    // Certifications are signed off after a supervised practical, so they
    // cannot be scheduled as a session; the server refuses them too.
    .filter(m => m.kind !== 'CERTIFICATION' && m.status === 'ACTIVE')
    .map(m => ({ label: `${m.id} · ${m.name}`, value: m.id })),
)

const canSubmit = computed(() => Boolean(form.value.heldOn) && form.value.moduleIds.length > 0)

const submitting = ref(false)
const submitError = ref<string | null>(null)

async function submit() {
  submitting.value = true
  submitError.value = null
  try {
    const result = await $fetch('/api/sessions/schedule', {
      method: 'POST',
      body: {
        heldOn: form.value.heldOn,
        moduleIds: form.value.moduleIds,
        startsTime: form.value.startsAt || null,
        endsTime: form.value.endsAt || null,
        capacity: form.value.capacity || null,
        location: form.value.location || null,
        description: form.value.description || null,
        notes: form.value.notes || null,
        openNow: form.value.openNow,
      },
    })
    toast.add({
      title: form.value.openNow ? 'Scheduled, and open for sign-ups' : 'Scheduled',
      icon: 'i-lucide-calendar-check',
      color: 'success',
    })
    await router.push(`/sessions/${result.id}`)
  }
  catch (e) {
    submitError.value = errorMessage(e, 'Could not schedule this session')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div>
      <h1 class="text-2xl font-bold">
        Schedule a session
      </h1>
      <p class="text-muted mt-1">
        Nobody gets a record from this. You mark the register on the day, and that is what awards.
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
              v-model="form.startsAt"
              type="time"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Ends">
            <UInput
              v-model="form.endsAt"
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
            placeholder="Choose modules"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Where">
            <UInput
              v-model="form.location"
              placeholder="Main house, or a rooms booking link"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Places"
            help="Leave blank for no limit. Past this, people join a waitlist."
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

        <UFormField
          label="What to expect"
          help="Shown to anyone deciding whether to sign up"
        >
          <UTextarea
            v-model="form.description"
            :rows="2"
            placeholder="Bring boots. Meet in the foyer."
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

        <UCheckbox
          v-model="form.openNow"
          label="Open for sign-ups straight away"
          help="Leave this off to finish the details first. Nobody sees a planned session."
        />
      </div>

      <template #footer>
        <UButton
          label="Schedule"
          icon="i-lucide-calendar-plus"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        />
      </template>
    </UCard>
  </div>
</template>
