<script lang="ts" setup>
definePageMeta({ title: 'Dashboard' })

const { data: me } = useMe()
const { data } = await useFetch('/api/me/records')

const records = computed(() => data.value?.records ?? [])
const expiring = computed(() => data.value?.expiring ?? [])
const expired = computed(() => data.value?.expired ?? [])
const briefs = computed(() => data.value?.briefs ?? [])
const nextUp = computed(() => data.value?.nextUp ?? [])

/** Records grouped by department, in department order. */
const byDepartment = computed(() => {
  const groups = new Map<string, typeof records.value>()
  for (const record of records.value) {
    groups.set(record.department, [...(groups.get(record.department) ?? []), record])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
})

function formatDate(iso: string) {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="text-2xl font-bold">
        Hello, {{ me?.user.name?.split(' ')[0] || 'there' }}
      </h1>
      <p class="text-muted mt-1">
        Your training at the Nottingham New Theatre.
      </p>
    </div>

    <!-- Anything needing attention comes first: this is the whole reason a
         member opens the dashboard. -->
    <UAlert
      v-if="expired.length"
      icon="i-lucide-circle-x"
      color="error"
      variant="subtle"
      :title="`${expired.length} ${expired.length === 1 ? 'module has' : 'modules have'} expired`"
      :description="expired.map(r => `${r.moduleId} ${r.moduleName}`).join(', ')"
    />

    <UAlert
      v-if="expiring.length"
      icon="i-lucide-clock-alert"
      color="warning"
      variant="subtle"
      :title="`${expiring.length} ${expiring.length === 1 ? 'module expires' : 'modules expire'} soon`"
      :description="expiring.map(r => `${r.moduleName} (${formatDate(r.expiresAt!)})`).join(', ')"
    />

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="lg:col-span-2 space-y-6">
        <div>
          <h2 class="font-semibold mb-3">
            Your training
          </h2>

          <UAlert
            v-if="!records.length"
            icon="i-lucide-book-dashed"
            color="neutral"
            variant="subtle"
            title="Nothing recorded yet"
            description="Your records appear here once a trainer logs a session you attended."
          />

          <div
            v-for="[department, group] in byDepartment"
            v-else
            :key="department"
            class="mb-4"
          >
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
              {{ department }}
            </h3>
            <div class="divide-y divide-default border border-default rounded-lg overflow-hidden">
              <NuxtLink
                v-for="record in group"
                :key="record.id"
                :to="`/modules/${record.moduleId}`"
                class="flex items-center justify-between gap-4 p-3 hover:bg-elevated/50 transition-colors"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <code class="text-xs font-mono text-muted">{{ record.moduleId }}</code>
                    <span class="font-medium truncate">{{ record.moduleName }}</span>
                    <UBadge
                      v-if="record.kind === 'CERTIFICATION'"
                      color="secondary"
                      variant="subtle"
                      size="sm"
                      label="Certification"
                    />
                  </div>
                  <p class="text-xs text-muted mt-0.5">
                    Awarded {{ formatDate(record.awardedAt) }}
                  </p>
                </div>
                <RecordState
                  :state="record.state"
                  :expires-at="record.expiresAt"
                  with-date
                />
              </NuxtLink>
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
      </div>

      <div class="space-y-4">
        <UCard v-if="nextUp.length">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-arrow-up-right" />
              <h2 class="font-semibold">
                What's next
              </h2>
            </div>
          </template>
          <p class="text-sm text-muted mb-3">
            You already meet the prerequisites for these.
          </p>
          <div class="space-y-1">
            <NuxtLink
              v-for="module in nextUp"
              :key="module.id"
              :to="`/modules/${module.id}`"
              class="block text-sm hover:text-primary"
            >
              <code class="text-xs font-mono text-muted mr-2">{{ module.id }}</code>{{ module.name }}
            </NuxtLink>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              What you can do
            </h2>
          </template>
          <ul class="text-sm space-y-2">
            <li class="flex items-center gap-2">
              <UIcon
                :name="me?.isTrainer ? 'i-lucide-check' : 'i-lucide-minus'"
                :class="me?.isTrainer ? 'text-primary' : 'text-dimmed'"
              />
              <span :class="me?.isTrainer ? '' : 'text-dimmed'">Deliver and log training</span>
            </li>
            <li class="flex items-center gap-2">
              <UIcon
                :name="me?.leadOf.length ? 'i-lucide-check' : 'i-lucide-minus'"
                :class="me?.leadOf.length ? 'text-primary' : 'text-dimmed'"
              />
              <span :class="me?.leadOf.length ? '' : 'text-dimmed'">
                Sign off {{ me?.leadOf.length ? me.leadOf.join(', ') : 'certifications' }}
              </span>
            </li>
            <li class="flex items-center gap-2">
              <UIcon
                :name="me?.isAdmin ? 'i-lucide-check' : 'i-lucide-minus'"
                :class="me?.isAdmin ? 'text-primary' : 'text-dimmed'"
              />
              <span :class="me?.isAdmin ? '' : 'text-dimmed'">Administer training</span>
            </li>
          </ul>
          <template #footer>
            <UButton
              v-if="me?.isTrainer"
              to="/sessions/new"
              icon="i-lucide-clipboard-pen"
              label="Log a session"
              size="sm"
              block
            />
            <p
              v-else
              class="text-xs text-muted"
            >
              Trainer standing comes from holding a valid Trainer certification.
            </p>
          </template>
        </UCard>
      </div>
    </div>
  </div>
</template>
