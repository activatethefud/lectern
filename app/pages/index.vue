<template>
  <div class="wrap home">
    <section class="hero">
      <h1>{{ t('site.name') }}</h1>
      <p class="muted">{{ t('site.tagline') }}</p>
      <input
        v-model="q"
        type="search"
        :placeholder="`${t('home.search')} — ${t('home.searchHint')}`"
        :aria-label="t('home.search')"
        autocomplete="off"
      >
    </section>

    <p v-if="filtered.length === 0" class="muted empty">
      {{ courses?.length ? t('home.noResults', { q }) : t('home.empty') }}
    </p>

    <ul v-else class="grid">
      <li v-for="c in filtered" :key="c.slug" class="card">
        <NuxtLinkLocale :to="`/c/${c.slug}`" class="card-link">
          <div class="card-title">{{ c.title }}</div>
          <p class="muted card-desc">{{ c.description }}</p>
          <div class="card-meta muted">
            <span>{{ t('course.slides', { n: c.slideCount }) }}</span>
            <span v-if="c.tags.length" class="tags">{{ c.tags.join(' · ') }}</span>
          </div>
        </NuxtLinkLocale>

        <a
          v-if="c.hasPptx"
          class="dl"
          :href="`/c/${c.slug}/slides.pptx`"
          :title="t('course.download')"
          :aria-label="t('course.download')"
          download
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round"
            />
          </svg>
        </a>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { matchesQuery, type CourseListEntry } from '#shared/course'

const { t, locale } = useI18n()

const { data: courses } = await useFetch<CourseListEntry[]>('/api/courses', {
  query: { locale },
  default: () => [],
})

const q = ref('')

const filtered = computed(() =>
  (courses.value ?? []).filter((c) => matchesQuery(q.value, [c.title, c.description, c.slug, ...c.tags])),
)
</script>

<style scoped>
.home { padding: 2.5rem 1.25rem 3rem; }
.hero { max-width: 40rem; margin-bottom: 2rem; }
.hero h1 { font-size: 2.1rem; margin: 0 0 0.35rem; letter-spacing: -0.02em; }
.hero p { margin: 0 0 1.1rem; }
.empty { padding: 2rem 0; }
.grid { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }
.card { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); transition: border-color 0.15s; }
.card:hover { border-color: var(--accent); }
.card-link { display: block; padding: 1rem 2.6rem 1rem 1rem; text-decoration: none; }
.card-title { font-weight: 620; letter-spacing: -0.01em; }
.card-desc { margin: 0.25rem 0 0.6rem; font-size: 0.9rem; }
.card-meta { display: flex; gap: 0.6rem; font-size: 0.78rem; flex-wrap: wrap; }
.tags { opacity: 0.85; }
.dl { position: absolute; top: 0.8rem; right: 0.8rem; padding: 0.3rem; border-radius: 8px; color: var(--muted); display: grid; place-items: center; }
.dl:hover { color: var(--accent); background: color-mix(in oklab, var(--accent) 12%, transparent); }
</style>
