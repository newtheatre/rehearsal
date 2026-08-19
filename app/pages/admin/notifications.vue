<script lang="ts" setup>
definePageMeta({ title: 'Notifications', middleware: 'admin' })

const toast = useToast()

const { data: config, refresh: refreshConfig } = await useFetch('/api/admin/config')
const previewDate = ref('')
// Omit the parameter entirely when no date is chosen: `asOf=` fails date
// validation, and the 400 renders as a blank card.
const previewQuery = computed(() => previewDate.value ? { asOf: previewDate.value } : {})
const {
  data: preview,
  refresh: refreshPreview,
  status: previewStatus,
  error: previewError,
} = await useFetch('/api/admin/expiry-preview', { query: previewQuery })
const { data: log, refresh: refreshLog } = await useFetch('/api/admin/notifications')

const mode = computed(() => config.value?.config.find(c => c.key === 'notifications_mode')?.value ?? 'dry-run')
const isLive = computed(() => mode.value === 'live')

const saving = ref(false)

async function setValue(key: string, value: string | number) {
  saving.value = true
  try {
    await $fetch('/api/admin/config', { method: 'PUT', body: { key, value } })
    await Promise.all([refreshConfig(), refreshPreview()])
    toast.add({ title: 'Saved', icon: 'i-lucide-check', color: 'success' })
  }
  catch (e) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({
      title: err.data?.statusMessage || 'Could not save',
      icon: 'i-lucide-circle-alert',
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}

const windowDays = computed({
  get: () => Number(config.value?.config.find(c => c.key === 'warning_window_days')?.value ?? 60),
  set: (value: number) => { setValue('warning_window_days', value) },
})
</script>

<template>
  <div class="space-y-8 max-w-4xl">
    <div>
      <h1 class="text-2xl font-bold">
        Notifications
      </h1>
      <p class="text-muted mt-1">
        The daily sweep runs at 06:00 UTC and warns people whose training is lapsing.
      </p>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <h2 class="font-semibold">
            Mode
          </h2>
          <UBadge
            :color="isLive ? 'success' : 'warning'"
            variant="subtle"
            :label="isLive ? 'Live' : 'Dry run'"
          />
        </div>
      </template>

      <div class="space-y-4">
        <UAlert
          v-if="!isLive"
          icon="i-lucide-shield-check"
          color="warning"
          variant="subtle"
          title="Nothing is reaching members"
          description="The sweep emails a report to admins and stops there. Nothing is recorded as sent, so switching to live still delivers everything the dry run described."
        />
        <UAlert
          v-else
          icon="i-lucide-mail-check"
          color="success"
          variant="subtle"
          title="Members are being emailed"
          description="Put this back to dry run after changing any expiry policy or the warning window, and check the preview before switching back."
        />

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            :label="isLive ? 'Switch to dry run' : 'Switch to live'"
            :color="isLive ? 'neutral' : 'primary'"
            :variant="isLive ? 'outline' : 'solid'"
            :loading="saving"
            @click="setValue('notifications_mode', isLive ? 'dry-run' : 'live')"
          />
        </div>

        <UFormField
          label="Warning window"
          help="How far ahead a member is first told. The second, urgent warning is always 14 days out."
        >
          <div class="flex items-center gap-2">
            <UInput
              v-model.number="windowDays"
              type="number"
              :min="1"
              :max="365"
              class="w-28"
            />
            <span class="text-sm text-muted">days</span>
          </div>
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-semibold">
            What the next sweep would do
          </h2>
          <div class="flex items-center gap-2">
            <UInput
              v-model="previewDate"
              type="date"
              size="sm"
              class="w-40"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              variant="ghost"
              color="neutral"
              size="sm"
              aria-label="Refresh preview"
              :loading="previewStatus === 'pending'"
              @click="refreshPreview()"
            />
          </div>
        </div>
      </template>

      <p class="text-sm text-muted mb-4">
        A preview sends nothing and records nothing. Set a date to ask what happens
        on, say, 1 October.
      </p>

      <UAlert
        v-if="previewError"
        icon="i-lucide-circle-alert"
        color="error"
        variant="subtle"
        title="Could not build the preview"
        :description="(previewError.data as { statusMessage?: string } | undefined)?.statusMessage || previewError.message"
        class="mb-4"
      />

      <div
        v-if="preview"
        class="space-y-4"
      >
        <div class="flex flex-wrap gap-4 text-sm">
          <span><strong>{{ preview.counts.recordsConsidered }}</strong> records considered</span>
          <span class="text-warning"><strong>{{ preview.counts.expiring }}</strong> expiring</span>
          <span class="text-error"><strong>{{ preview.counts.expired }}</strong> expired</span>
          <span
            v-if="preview.counts.unaddressable"
            class="text-muted"
          ><strong>{{ preview.counts.unaddressable }}</strong> unaddressable</span>
        </div>

        <div v-if="preview.warnings.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            Member warnings ({{ preview.warnings.length }})
          </h3>
          <div class="border border-default rounded-lg divide-y divide-default text-sm">
            <div
              v-for="(warning, i) in preview.warnings"
              :key="i"
              class="flex items-center justify-between gap-3 p-2.5"
            >
              <span>{{ warning.name }}</span>
              <UBadge
                :color="warning.type === 'expiry.14day' ? 'error' : 'warning'"
                variant="subtle"
                size="sm"
                :label="warning.type === 'expiry.14day' ? 'final' : 'first'"
              />
              <span class="text-muted text-xs">
                {{ warning.modules.map(m => `${m.id} (${formatDate(m.expiresAt)})`).join(', ') }}
              </span>
            </div>
          </div>
        </div>
        <p
          v-else
          class="text-sm text-muted"
        >
          No member warnings due.
        </p>

        <div v-if="preview.digests.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            Digests ({{ preview.digests.length }})
          </h3>
          <ul class="text-sm space-y-1">
            <li
              v-for="(digest, i) in preview.digests"
              :key="i"
            >
              {{ digest.name }} —
              {{ digest.departments === null ? 'all departments' : digest.departments.join(', ') }}:
              {{ digest.expiring }} expiring, {{ digest.expired }} expired
            </li>
          </ul>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <h2 class="font-semibold">
            Sent
          </h2>
          <UButton
            icon="i-lucide-refresh-cw"
            variant="ghost"
            color="neutral"
            size="sm"
            aria-label="Refresh log"
            @click="refreshLog()"
          />
        </div>
      </template>

      <p
        v-if="!log?.notifications.length"
        class="text-sm text-muted"
      >
        Nothing has been sent yet.
      </p>

      <div
        v-else
        class="border border-default rounded-lg divide-y divide-default text-sm max-h-96 overflow-y-auto"
      >
        <div
          v-for="entry in log.notifications"
          :key="entry.id"
          class="flex items-center justify-between gap-3 p-2.5"
        >
          <span>{{ entry.name ?? 'Unknown' }}</span>
          <code class="text-xs text-muted">{{ entry.type }}</code>
          <span class="text-xs text-muted">{{ entry.moduleId ?? '—' }}</span>
          <span class="text-xs text-dimmed">{{ formatDateTime(entry.sentAt) }}</span>
        </div>
      </div>
    </UCard>
  </div>
</template>
