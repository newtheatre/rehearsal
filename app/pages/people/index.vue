<script lang="ts" setup>
definePageMeta({ title: 'People' })

const search = ref('')

// Searching server-side: the directory is paged, so filtering the page in the
// browser would only ever search the part of the membership already loaded.
const query = computed(() => ({ ...(search.value.trim() ? { q: search.value.trim() } : {}) }))
const { data } = await useFetch('/api/people', { query })
type PeoplePage = NonNullable<typeof data.value>

const pages = ref<PeoplePage[]>([])
watch(data, (value) => {
  if (value) pages.value = [value]
}, { immediate: true })

const people = computed(() => pages.value.flatMap(page => page.people))
const hasMore = computed(() => pages.value.at(-1)?.hasMore ?? false)
const loadingMore = ref(false)

async function loadMore() {
  const last = people.value.at(-1)
  if (!last) return

  loadingMore.value = true
  try {
    const page = await $fetch('/api/people', {
      query: { ...query.value, afterName: last.name, afterId: last.id },
    })
    pages.value.push(page as PeoplePage)
  }
  finally {
    loadingMore.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">
          People
        </h1>
        <p class="text-muted mt-1">
          Who is trained in what: the "who can supervise me on this get-in" lookup.
        </p>
      </div>

      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search people"
        class="w-56"
      />
    </div>

    <UAlert
      v-if="!people.length"
      icon="i-lucide-users"
      color="neutral"
      variant="subtle"
      title="Nobody to show"
      :description="search ? 'No one matches that search.' : 'People appear here once they have signed in or been added to a session.'"
    />

    <div
      v-else
      class="divide-y divide-default border border-default rounded-lg overflow-hidden"
    >
      <NuxtLink
        v-for="person in people"
        :key="person.id"
        :to="`/people/${person.id}`"
        class="flex items-center justify-between gap-4 p-4 hover:bg-elevated/50 transition-colors"
      >
        <div class="min-w-0">
          <div class="font-medium">
            {{ person.name }}
          </div>
          <div
            v-if="person.certifications.length"
            class="flex flex-wrap gap-1 mt-1"
          >
            <UBadge
              v-for="cert in person.certifications"
              :key="cert"
              color="secondary"
              variant="subtle"
              size="sm"
              :label="cert"
            />
          </div>
        </div>

        <div class="flex items-center gap-3 text-sm shrink-0">
          <span
            v-if="person.valid"
            class="text-muted"
          >{{ person.valid }} valid</span>
          <span
            v-if="person.expiring"
            class="text-warning"
          >{{ person.expiring }} expiring</span>
          <span
            v-if="person.expired"
            class="text-error"
          >{{ person.expired }} expired</span>
          <span
            v-if="!person.valid && !person.expiring && !person.expired"
            class="text-dimmed"
          >no records</span>
          <UIcon
            name="i-lucide-chevron-right"
            class="text-dimmed"
          />
        </div>
      </NuxtLink>
    </div>

    <div
      v-if="hasMore"
      class="flex justify-center"
    >
      <UButton
        :loading="loadingMore"
        variant="subtle"
        color="neutral"
        label="Load more people"
        @click="loadMore"
      />
    </div>
  </div>
</template>
