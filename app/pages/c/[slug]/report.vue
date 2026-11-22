<template>
  <div class="wrap report">
    <p v-if="!report" class="muted">{{ t('report.notReady') }}</p>

    <template v-else>
      <header class="head">
        <h1>{{ t('report.title') }}</h1>
        <p class="muted course">{{ report.title }}</p>

        <div class="score" :class="report.passed ? 'ok' : 'bad'">
          <span class="big">{{ report.score }}<span class="of">/{{ report.total }}</span></span>
          <span class="pct">{{ report.percent }} %</span>
          <span class="verdict">{{ report.passed ? t('report.passed') : t('report.failed') }}</span>
        </div>
        <p class="muted mark">{{ t('report.passMark', { mark: report.passMark, total: report.total }) }}</p>
        <p v-if="report.passed" class="muted">{{ t('report.passedNote') }}</p>
        <p v-else class="muted">{{ t('report.failedNote') }}</p>
      </header>

      <ol class="items">
        <li v-for="item in report.items" :key="item.n" class="item">
          <div class="item-head">
            <span class="n">{{ t('player.progress', { n: item.n, total: report.items.length }) }}</span>
            <span class="flag" :class="item.correct ? 'ok' : 'bad'">
              {{ item.correct ? '✓ ' + t('report.correct') : '✗ ' + t('report.failed') }}
            </span>
          </div>
          <p class="q">{{ item.q }}</p>
          <ul class="opts">
            <li
              v-for="(opt, i) in item.options"
              :key="i"
              :class="{ chosen: item.chosen === i, 'is-ok': item.chosen === i && item.correct, 'is-bad': item.chosen === i && !item.correct }"
            >
              <span class="key">{{ 'ABCD'[i] }}</span>
              <span>{{ opt }}</span>
            </li>
          </ul>
          <p v-if="item.why" class="why"><span class="muted">{{ t('report.why') }}:</span> {{ item.why }}</p>
        </li>
      </ol>

      <section v-if="report.passed" class="cert">
        <template v-if="cert || report.certId">
          <h2>{{ t('cert.title') }}</h2>
          <p class="muted">{{ t('cert.readyFor', { name: report.name ?? cert?.name }) }}</p>
          <div class="actions">
            <a class="btn-primary btn" :href="`/certificate/${cert?.certId ?? report.certId}?locale=${locale}`" download>
              ⬇ {{ t('cert.download') }}
            </a>
            <NuxtLinkLocale class="ghost btn" :to="`/verify/${cert?.certId ?? report.certId}`">
              {{ t('cert.verifyLink') }}
            </NuxtLinkLocale>
          </div>
        </template>
        <template v-else>
          <h2>{{ t('cert.generate') }}</h2>
          <p class="muted">{{ t('cert.nameHint') }}</p>
          <form class="name-form" @submit.prevent="createCertificate">
            <input
              v-model="name"
              type="text"
              :placeholder="t('report.name')"
              maxlength="60"
              minlength="2"
              required
              :aria-label="t('report.name')"
            >
            <button class="btn-primary btn" type="submit" :disabled="busy || name.trim().length < 2">
              {{ t('cert.generate') }}
            </button>
          </form>
          <p v-if="certError" class="bad-text">{{ certError }}</p>
        </template>
      </section>

      <div class="actions bottom">
        <NuxtLinkLocale v-if="!report.passed" class="btn-primary btn" :to="`/c/${slug}`" @click="retake">
          {{ t('report.retake') }}
        </NuxtLinkLocale>
        <NuxtLinkLocale class="ghost btn" :to="`/c/${slug}`">{{ t('report.backToCourse') }}</NuxtLinkLocale>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const { t, locale } = useI18n()
const route = useRoute()
const slug = String(route.params.slug)

const { data: report, error, refresh } = await useFetch(`/api/c/${slug}/report`, {
  query: { locale },
})

// Not finished (or restarted): send the learner back to the slide they owe an answer on.
if (error.value?.statusCode === 409) {
  const next = (error.value.data as { data?: { nextSlide?: number } })?.data?.nextSlide ?? 1
  await navigateTo(`/c/${slug}/${next}`, { replace: true })
}

const name = ref((report.value?.name as string | null) ?? '')
const cert = ref<{ certId: string, name: string, pdf: string, verify: string } | null>(null)
const busy = ref(false)
const certError = ref('')

async function createCertificate() {
  busy.value = true
  certError.value = ''
  try {
    cert.value = await $fetch(`/api/c/${slug}/certificate`, {
      method: 'POST',
      body: { name: name.value.trim() },
    })
    await refresh()
  } catch (e) {
    certError.value = (e as { statusMessage?: string }).statusMessage ?? t('cert.failed')
  } finally {
    busy.value = false
  }
}

async function retake() {
  await $fetch(`/api/c/${slug}/restart`, { method: 'POST' })
}
</script>

<style scoped>
.report { padding: 2rem 1.25rem 4rem; max-width: 52rem; }
.head h1 { font-size: 1.6rem; margin: 0 0 0.2rem; letter-spacing: -0.02em; }
.course { margin: 0 0 1rem; }
.score { display: flex; align-items: baseline; gap: 0.7rem; margin-bottom: 0.3rem; }
.score .big { font-size: 2.6rem; font-weight: 700; letter-spacing: -0.03em; }
.score .of { font-size: 1.3rem; font-weight: 400; color: var(--muted); }
.score .pct { font-size: 1.1rem; color: var(--muted); }
.score .verdict { font-weight: 650; margin-left: auto; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.85rem; }
.score.ok .verdict { color: var(--good); border: 1px solid var(--good); }
.score.bad .verdict { color: var(--bad); border: 1px solid var(--bad); }
.mark { font-size: 0.85rem; margin: 0 0 0.4rem; }
.items { list-style: none; padding: 0; margin: 2rem 0; display: flex; flex-direction: column; gap: 1.1rem; }
.item { border-top: 1px solid var(--line); padding-top: 0.8rem; }
.item-head { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--muted); margin-bottom: 0.3rem; }
.flag.ok { color: var(--good); }
.flag.bad { color: var(--bad); }
.q { margin: 0 0 0.5rem; font-weight: 550; }
.opts { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.25rem; }
.opts li { display: flex; gap: 0.5rem; padding: 0.35rem 0.55rem; border: 1px solid transparent; border-radius: 7px; font-size: 0.92rem; }
.opts .key { color: var(--muted); font-weight: 700; font-size: 0.78rem; }
.opts li.chosen { border-color: var(--line); }
.opts li.is-ok { border-color: var(--good); background: color-mix(in oklab, var(--good) 10%, transparent); }
.opts li.is-bad { border-color: var(--bad); background: color-mix(in oklab, var(--bad) 10%, transparent); }
.why { font-size: 0.9rem; margin: 0.5rem 0 0; }
.cert { border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.1rem; background: var(--card); }
.cert h2 { font-size: 1.05rem; margin: 0 0 0.3rem; }
.name-form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.7rem; }
.name-form input { max-width: 22rem; }
.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.bottom { margin-top: 1.5rem; }
.btn { padding: 0.5rem 0.9rem; border-radius: var(--radius); text-decoration: none; }
.ghost { border: 1px solid var(--line); }
.bad-text { color: var(--bad); font-size: 0.85rem; margin: 0.5rem 0 0; }
</style>
