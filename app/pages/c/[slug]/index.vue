<template>
  <div class="wrap cover">
    <p v-if="error" class="muted">{{ t('course.notFound') }}</p>

    <template v-else-if="course">
      <div class="cols">
        <div class="art">
          <img :src="course.cover" :alt="course.title" loading="eager">
        </div>

        <div class="info">
          <h1>{{ course.title }}</h1>
          <p class="muted desc">{{ course.description }}</p>

          <ul class="facts muted">
            <li>{{ t('course.slides', { n: course.slideCount }) }}</li>
            <li>{{ t('course.questions', { n: course.total }) }}</li>
            <li>{{ t('course.threshold', { p: threshold }) }}</li>
            <li v-if="course.langs?.length > 1">{{ course.langs.join(' · ') }}</li>
          </ul>

          <p v-if="course.answeredCount > 0" class="progress muted">
            {{ t('course.progress', { done: course.answeredCount, total: course.total }) }}
          </p>

          <div class="actions">
            <NuxtLinkLocale
              v-if="!course.done"
              class="btn-primary action"
              :to="`/c/${course.slug}/${course.nextSlide ?? 1}`"
            >
              {{ course.answeredCount ? t('course.resume', { n: course.nextSlide ?? 1 }) : t('course.start') }}
            </NuxtLinkLocale>
            <span v-else class="done">{{ t('course.done') }}</span>

            <a
              v-if="course.hasPptx"
              class="action ghost"
              :href="`/c/${course.slug}/slides.pptx?lang=${course.deckLang}`"
              download
            >
              ⬇ {{ t('course.download') }}
            </a>
            <button v-if="course.answeredCount > 0" class="action ghost" :disabled="restarting" @click="restart">
              {{ t('course.restart') }}
            </button>
          </div>

          <div v-if="course.lastFinished?.certificate" class="cert-line">
            <span class="muted mono">{{ course.lastFinished.certificate.serial }}</span>
            <a class="action ghost" :href="`/certificate/${course.lastFinished.certificate.verifyId}?locale=${locale}`" download>
              ⬇ {{ t('cert.download') }}
            </a>
            <NuxtLinkLocale class="action ghost" :to="`/verify/${course.lastFinished.certificate.serial}`">
              {{ t('cert.verifyLink') }}
            </NuxtLinkLocale>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const { t, locale } = useI18n()
const route = useRoute()
const slug = String(route.params.slug)
const threshold = 90

const { data: course, error, refresh } = await useFetch(`/api/c/${slug}`, {
  query: { locale },
})

const restarting = ref(false)
async function restart() {
  restarting.value = true
  try {
    await $fetch(`/api/c/${slug}/restart`, { method: 'POST' })
    await refresh()
  } finally {
    restarting.value = false
  }
}
</script>

<style scoped>
.cover { padding: 2rem 1.25rem 3rem; }
.cols { display: grid; gap: 2rem; grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr); align-items: start; }
@media (max-width: 52rem) { .cols { grid-template-columns: 1fr; } }
.art img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
.desc { margin: 0 0 1rem; }
.facts { list-style: none; padding: 0; margin: 0 0 1rem; display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; font-size: 0.85rem; }
.progress { font-size: 0.9rem; margin: 0 0 0.9rem; }
.actions { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; }
.action { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.6rem 1rem; border-radius: var(--radius); text-decoration: none; font-size: 0.95rem; }
.ghost { border: 1px solid var(--line); background: transparent; }
.done { color: var(--good); font-weight: 600; }
.cert-line { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--line); }
.mono { font-family: ui-monospace, monospace; font-size: 0.85rem; }
</style>
