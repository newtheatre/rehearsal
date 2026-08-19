<script lang="ts" setup>
const route = useRoute()
const toast = useToast()

const { data, refresh } = await useFetch(`/api/people/${route.params.id}`)
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: 'Person not found', fatal: true })
}

definePageMeta({ title: 'Person' })
useHead({ title: () => data.value?.person.name ?? 'Person' })

const { data: catalogue } = await useFetch('/api/modules', { query: { status: 'all' } })

const person = computed(() => data.value!.person)
const records = computed(() => data.value?.records ?? [])
const briefs = computed(() => data.value?.briefs ?? [])
const can = computed(() => data.value?.can)

/** Certifications this caller is allowed to sign off, minus ones already held. */
const signableCertifications = computed(() => {
  const held = new Set(records.value.filter(r => r.state !== 'EXPIRED').map(r => r.moduleId))
  const departments = can.value?.signOffDepartments
  return (catalogue.value?.modules ?? [])
    .filter(m => m.kind === 'CERTIFICATION' && m.status !== 'RETIRED')
    .filter(m => !held.has(m.id))
    .filter(m => departments === null || departments === undefined || departments.includes(m.department))
    .map(m => ({ label: `${m.id} · ${m.name}`, value: m.id }))
})

const externalModules = computed(() => {
  const departments = can.value?.signOffDepartments
  return (catalogue.value?.modules ?? [])
    .filter(m => m.status !== 'RETIRED' && m.kind !== 'BRIEF')
    .filter(m => departments === null || departments === undefined || departments.includes(m.department))
    .map(m => ({ label: `${m.id} · ${m.name}`, value: m.id }))
})

const todayIso = today()

// ── Sign-off ────────────────────────────────────────────────────────────────

const signoffOpen = ref(false)
const signoffBusy = ref(false)
const signoffError = ref<string | null>(null)
const signoff = ref({ moduleId: '', awardedAt: todayIso, note: '' })

async function submitSignoff() {
  signoffBusy.value = true
  signoffError.value = null
  try {
    await $fetch(`/api/people/${person.value.id}/signoff`, {
      method: 'POST',
      body: {
        moduleId: signoff.value.moduleId,
        awardedAt: signoff.value.awardedAt,
        note: signoff.value.note || null,
      },
    })
    toast.add({ title: 'Certification signed off', icon: 'i-lucide-check', color: 'success' })
    signoffOpen.value = false
    signoff.value = { moduleId: '', awardedAt: todayIso, note: '' }
    await refresh()
  }
  catch (e) {
    signoffError.value = errorMessage(e, 'Could not sign this off')
  }
  finally {
    signoffBusy.value = false
  }
}

// ── External certificate ────────────────────────────────────────────────────

const externalOpen = ref(false)
const externalBusy = ref(false)
const externalError = ref<string | null>(null)
const external = ref({ moduleId: '', awardedAt: todayIso, expiresAt: '', externalRef: '' })

async function submitExternal() {
  externalBusy.value = true
  externalError.value = null
  try {
    await $fetch(`/api/people/${person.value.id}/external`, {
      method: 'POST',
      body: {
        moduleId: external.value.moduleId,
        awardedAt: external.value.awardedAt,
        expiresAt: external.value.expiresAt || null,
        externalRef: external.value.externalRef,
      },
    })
    toast.add({ title: 'External certificate recorded', icon: 'i-lucide-check', color: 'success' })
    externalOpen.value = false
    external.value = { moduleId: '', awardedAt: todayIso, expiresAt: '', externalRef: '' }
    await refresh()
  }
  catch (e) {
    externalError.value = errorMessage(e, 'Could not record this certificate')
  }
  finally {
    externalBusy.value = false
  }
}

// ── Revocation ──────────────────────────────────────────────────────────────

const revokeOpen = ref(false)
const revokeBusy = ref(false)
const revokeError = ref<string | null>(null)
const revokeTarget = ref<{ id: string, moduleId: string, moduleName: string } | null>(null)
const revokeReason = ref('')

function askRevoke(record: { id: string, moduleId: string, moduleName: string }) {
  revokeTarget.value = record
  revokeReason.value = ''
  revokeError.value = null
  revokeOpen.value = true
}

async function submitRevoke() {
  if (!revokeTarget.value) return
  revokeBusy.value = true
  revokeError.value = null
  try {
    await $fetch(`/api/records/${revokeTarget.value.id}/revoke`, {
      method: 'POST',
      body: { reason: revokeReason.value },
    })
    toast.add({ title: 'Record revoked', icon: 'i-lucide-check', color: 'success' })
    revokeOpen.value = false
    await refresh()
  }
  catch (e) {
    revokeError.value = errorMessage(e, 'Could not revoke this record')
  }
  finally {
    revokeBusy.value = false
  }
}
</script>

<template>
  <div
    v-if="data"
    class="space-y-8 max-w-3xl"
  >
    <div class="space-y-3">
      <UButton
        to="/people"
        variant="link"
        color="neutral"
        size="sm"
        icon="i-lucide-arrow-left"
        label="People"
        class="px-0"
      />

      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">
            {{ person.name }}
          </h1>
          <div
            v-if="data.leadOf.length"
            class="flex gap-1 mt-2"
          >
            <UBadge
              v-for="department in data.leadOf"
              :key="department"
              color="primary"
              variant="subtle"
              size="sm"
              :label="`${department} lead`"
            />
          </div>
        </div>

        <div
          v-if="can?.signOff"
          class="flex gap-2"
        >
          <UButton
            icon="i-lucide-award"
            label="Sign off"
            size="sm"
            :disabled="!signableCertifications.length"
            @click="() => { signoffOpen = true }"
          />
          <UButton
            icon="i-lucide-file-badge"
            label="External cert"
            size="sm"
            variant="outline"
            color="neutral"
            @click="() => { externalOpen = true }"
          />
        </div>
      </div>
    </div>

    <div>
      <h2 class="font-semibold mb-3">
        Training
      </h2>

      <UAlert
        v-if="!records.length"
        icon="i-lucide-book-dashed"
        color="neutral"
        variant="subtle"
        title="No records"
        description="Nothing has been recorded for this person yet."
      />

      <div
        v-else
        class="divide-y divide-default border border-default rounded-lg overflow-hidden"
      >
        <div
          v-for="record in records"
          :key="record.id"
          class="flex items-center justify-between gap-4 p-3"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <code class="text-xs font-mono text-muted">{{ record.moduleId }}</code>
              <NuxtLink
                :to="`/modules/${record.moduleId}`"
                class="font-medium hover:text-primary"
              >
                {{ record.moduleName }}
              </NuxtLink>
              <UBadge
                v-if="record.kind === 'CERTIFICATION'"
                color="secondary"
                variant="subtle"
                size="sm"
                label="Certification"
              />
              <UBadge
                v-if="record.source !== 'SESSION'"
                color="neutral"
                variant="outline"
                size="sm"
                :label="record.source.toLowerCase()"
              />
            </div>
            <p class="text-xs text-muted mt-0.5">
              Awarded {{ formatDate(record.awardedAt) }}
            </p>
            <p
              v-if="record.lapsedConstituents?.length"
              class="text-xs text-warning mt-1 flex items-start gap-1"
            >
              <UIcon
                name="i-lucide-triangle-alert"
                class="mt-0.5 shrink-0"
              />
              <span>
                Still valid, but rests on training that has lapsed:
                {{ record.lapsedConstituents.map(g => g.moduleId).join(', ') }}
              </span>
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <RecordState
              :state="record.state"
              :expires-at="record.expiresAt"
              with-date
            />
            <UButton
              v-if="can?.revoke"
              icon="i-lucide-ban"
              variant="ghost"
              color="error"
              size="xs"
              aria-label="Revoke"
              @click="askRevoke(record)"
            />
          </div>
        </div>
      </div>
    </div>

    <UCard v-if="briefs.length">
      <template #header>
        <h2 class="font-semibold">
          Briefings
        </h2>
      </template>
      <ul class="text-sm space-y-1">
        <li
          v-for="brief in briefs"
          :key="brief.id"
          class="flex justify-between"
        >
          <span>{{ brief.moduleName }}</span>
          <span class="text-muted">last received {{ formatDate(brief.awardedAt) }}</span>
        </li>
      </ul>
    </UCard>

    <UCard v-if="data.sessionsDelivered.length">
      <template #header>
        <h2 class="font-semibold">
          Sessions delivered
        </h2>
      </template>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="session in data.sessionsDelivered"
          :key="session.id"
          :to="`/sessions/${session.id}`"
          variant="outline"
          color="neutral"
          size="sm"
          :label="formatDate(session.heldOn)"
        />
      </div>
    </UCard>

    <UCard v-if="data.revoked.length">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-lock" />
          <h2 class="font-semibold">
            Revoked (leads and admins only)
          </h2>
        </div>
      </template>
      <p class="text-sm text-muted mb-3">
        Withdrawn records stay visible here: corrections are accountable, not silent.
      </p>
      <ul class="text-sm space-y-2">
        <li
          v-for="record in data.revoked"
          :key="record.id"
        >
          <span class="font-medium">{{ record.moduleId }} {{ record.moduleName }}</span>
          <span class="text-muted">: awarded {{ formatDate(record.awardedAt) }}</span>
          <p class="text-xs text-muted">
            {{ record.revokeReason }}
          </p>
        </li>
      </ul>
    </UCard>

    <!-- Sign-off -->
    <UModal
      v-model:open="signoffOpen"
      title="Sign off a certification"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="signoffError"
            icon="i-lucide-circle-alert"
            color="error"
            variant="subtle"
            :description="signoffError"
          />
          <p class="text-sm text-muted">
            The server checks every prerequisite is currently valid before this is recorded.
          </p>
          <UFormField
            label="Certification"
            required
          >
            <USelectMenu
              v-model="signoff.moduleId"
              :items="signableCertifications"
              value-key="value"
              searchable
              placeholder="Choose a certification"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Date awarded"
            required
          >
            <UInput
              v-model="signoff.awardedAt"
              type="date"
              :max="todayIso"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Note"
            help="What the supervised practical was, for the record"
          >
            <UTextarea
              v-model="signoff.note"
              :rows="2"
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
            @click="() => { signoffOpen = false }"
          />
          <UButton
            label="Sign off"
            :loading="signoffBusy"
            :disabled="!signoff.moduleId"
            @click="submitSignoff"
          />
        </div>
      </template>
    </UModal>

    <!-- External certificate -->
    <UModal
      v-model:open="externalOpen"
      title="Record an external certificate"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="externalError"
            icon="i-lucide-circle-alert"
            color="error"
            variant="subtle"
            :description="externalError"
          />
          <UFormField
            label="Module"
            required
          >
            <USelectMenu
              v-model="external.moduleId"
              :items="externalModules"
              value-key="value"
              searchable
              placeholder="Choose a module"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Date awarded"
            required
          >
            <UInput
              v-model="external.awardedAt"
              type="date"
              :max="todayIso"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Certificate expires"
            help="From the certificate itself: this wins over the module's own policy"
          >
            <UInput
              v-model="external.expiresAt"
              type="date"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="What the certificate is"
            required
          >
            <UInput
              v-model="external.externalRef"
              placeholder="SU Emergency First Aid at Work"
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
            @click="() => { externalOpen = false }"
          />
          <UButton
            label="Record"
            :loading="externalBusy"
            :disabled="!external.moduleId || !external.externalRef"
            @click="submitExternal"
          />
        </div>
      </template>
    </UModal>

    <!-- Revoke -->
    <UModal
      v-model:open="revokeOpen"
      title="Revoke this record"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="revokeError"
            icon="i-lucide-circle-alert"
            color="error"
            variant="subtle"
            :description="revokeError"
          />
          <p class="text-sm">
            Revoking <strong>{{ revokeTarget?.moduleName }}</strong> stops it counting anywhere
            immediately. The record is not deleted: it stays in this person's history with
            the reason you give, so the correction is reviewable.
          </p>
          <UFormField
            label="Reason"
            required
          >
            <UTextarea
              v-model="revokeReason"
              :rows="2"
              placeholder="Logged against the wrong person"
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
            @click="() => { revokeOpen = false }"
          />
          <UButton
            label="Revoke"
            color="error"
            :loading="revokeBusy"
            :disabled="revokeReason.trim().length < 3"
            @click="submitRevoke"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
