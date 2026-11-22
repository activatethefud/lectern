<template>
  <div class="shell">
    <header class="top">
      <div class="wrap top-in">
        <NuxtLinkLocale to="/" class="brand">
          <span class="dot" aria-hidden="true" />
          {{ t('site.name') }}
        </NuxtLinkLocale>
        <label class="lang">
          <span class="sr-only">Language</span>
          <select :value="locale" @change="onLang">
            <option v-for="l in locales" :key="l.code" :value="l.code">{{ l.name }}</option>
          </select>
        </label>
      </div>
    </header>

    <main>
      <slot />
    </main>

    <footer class="wrap foot muted">
      <span>{{ t('site.name') }} — {{ new Date().getFullYear() }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
const { t, locale, locales, setLocale } = useI18n()

async function onLang(e: Event) {
  const code = (e.target as HTMLSelectElement).value
  await setLocale(code as never)
  useHead({ htmlAttrs: { lang: code } })
}
</script>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }
.top { border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 10; }
.top-in { display: flex; align-items: center; justify-content: space-between; height: 3.25rem; }
.brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 650; text-decoration: none; letter-spacing: -0.01em; }
.dot { width: 0.6rem; height: 0.6rem; border-radius: 2px; background: var(--accent); }
.lang select { font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 0.3rem 0.5rem; }
main { flex: 1; }
.foot { padding: 2rem 1.25rem; font-size: 0.85rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
