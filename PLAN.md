# slide-course — plan (v2)

**Status:** scaffolded. Nuxt 4 app boots; catalogue + search + course-folder loading + 3 locales
work; Docker runtime image builds and reports healthy; tests green. Player/report/certificate are M2–M4.

**One sentence:** a no-login course site where a course *is* a `.pptx` deck — read a slide, answer
the 4-option question under it, and at the end get a report (wrong ones marked, answers withheld)
plus a certificate at ≥ 90 %.

---

## 1. Confirmed requirements

| | |
|---|---|
| Course | one folder under `courses/`, containing `slides.pptx` + `questions.json` (+ `course.json`) |
| Player | one slide per page, its question pinned at the bottom, answers locked on click |
| Report | score + which slides were wrong; **correct answers only revealed if the attempt passed** |
| Pass | **90 %**, **unlimited retakes** |
| Certificate | learner types their name before the report; PDF with name, course, date, score, ID; public `/verify/<id>` |
| Home | all courses, searchable, no login, ⬇ icon downloads the `.pptx` |
| Languages | UI in **sr / en / zh-CN**; question text may be localized per course |
| Hosting | eventually a real server (VPS/Docker), not just localhost |

## 2. Stack decisions

| Area | Choice | Why / what was rejected |
|---|---|---|
| Framework | **Nuxt 4.6** (Vue 3 + Nitro) | File-based routing maps 1:1 to the URL plan (`app/pages/c/[slug]/[n].vue`), one Nitro process serves API + slide images + ssr, and `@nuxtjs/i18n` v10 gives sr/en/zh-CN with locale-prefixed routes for free. Next 16 would need `next-intl` wiring, and its RSC/server-action split adds nothing here. Neither is heavy once built: `node .output/server/index.mjs`. |
| Slide rendering | **Bake at author time**: `soffice --convert-to pdf` → `pdftoppm -webp` → `courses/<slug>/slides/00N.webp`, **committed** | Pixel-faithful (no browser pptx engine to mangle themes/tables), and production needs **no LibreOffice** — deploy is a node container plus a read-only `courses/` mount. Baking at request time would put a 500 MB office suite in the prod image. |
| Questions | `questions.json` next to the deck, validated at load | Diffable in git, no authoring UI. Validation errors are fatal at startup, not at slide 9. |
| Store | **`node:sqlite`** (built into Node 22) behind `server/utils/store.ts` | Attempts, answers, certificates: a handful of rows, needs durability and atomicity, no ORM. `better-sqlite3` needs native builds (painful on NixOS); swapping to it later is one file. |
| Certificate | `pdf-lib` + `@pdf-lib/fontkit` with **subsetted Noto Sans + Noto Sans SC** | Pure JS, exact A4 landscape control, and CJK names work because a real font is embedded. Rejected: `soffice` HTML→PDF (needs LibreOffice in prod), headless Chrome (heavy), print-only HTML (can't guarantee the artifact). |
| Cert artifact | HTML celebration page + `/c/<slug>/certificate.pdf` download | The PDF is the record; `/verify/<id>` is the authoritative check. |
| Auth | none. `sid` cookie (32 hex) identifies an attempt | Requirement. Certificates are *claimed*; the value is the row in the DB and the verify page. |
| CSS | one hand-written `main.css` (~100 lines) + scoped styles | No Tailwind/UI kit; the site is 4 screens. |
| Tests | **vitest** (unit) + **@nuxt/test-utils** (integration against real Nitro) + **playwright** (player flow) | Everything runs headless in `./test`; playwright only for the browser-specific invariants. |

**Environment note (verified 2026-11-22):** host `PATH` has no `node`, `python3`, `poppler` or
`pdflatex`; `soffice` converts a 15-slide school deck to PDF in ~3 s. Hence: everything runs through
`nix develop` (node 22, poppler_utils, libreoffice), and `./serve` / `./test` wrap that.
npm registry is reachable (nuxt 4.6.4, @nuxtjs/i18n 10.6.0, pdf-lib 1.17.1 resolved).
`node:sqlite` loads on node 22.23.5 (ExperimentalWarning only).

## 3. Layout

```
~/slide-course/
  nuxt.config.ts  package.json  vitest.config.ts  flake.nix  serve  test
  PLAN.md  README.md  AGENTS.md
  app/
    app.vue  layouts/default.vue
    pages/index.vue                 catalogue + search
    pages/c/[slug]/index.vue        cover + start/resume/restart
    pages/c/[slug]/[n].vue          the player
    pages/c/[slug]/report.vue       name gate → report
    pages/c/[slug]/certificate.vue  HTML certificate
    pages/verify/[id].vue           public check (locale-free)
    components/  assets/css/main.css
  server/
    api/courses.get.ts
    api/c/[slug]/answer.post.ts
    api/c/[slug]/report.get.ts  report.post.ts
    routes/c/[slug]/slides.pptx.get.ts
    routes/c/[slug]/slides/[n].get.ts
    routes/c/[slug]/certificate.pdf.get.ts
    utils/{courses,questions,store,grading,certificate}.ts
  shared/course.ts                  types, fold(), matchesQuery(), pickLocalized()
  scripts/bake-courses.mjs          bake | --check
  courses/<slug>/…                  see §4
  tests/                            unit, nuxt-integration, e2e
  data/                             course.db (gitignored)
```

## 4. Course package

```
courses/podaci-i-informacije/
  course.json
  questions.json
  slides.pptx
  manifest.json          # generated, committed
  slides/001.webp …  016.webp   # generated, committed
```

`course.json`
```json
{
  "slug": "podaci-i-informacije",
  "title": {
    "sr": "Podaci i informacije na internetu",
    "en": "Data and information on the internet",
    "zh-CN": "互联网上的数据与信息"
  },
  "description": { "sr": "…", "en": "…" },
  "tags": ["informatika", "5. razred", "internet"],
  "lang": "sr",              // language of the *deck*; fallback for content strings
  "passThreshold": 0.9,      // optional override of the global 0.9
  "order": 30,               // catalogue order
  "author": "…"
}
```

`questions.json`
```json
{
  "slides": [
    { "n": 1, "skip": true },
    { "n": 2,
      "q": { "sr": "Šta je podatak?", "en": "What is a datum?" },
      "options": [
        "sirova činjenica bez značenja",
        { "sr": "obrađen zaključak", "en": "a processed conclusion" },
        "uređaj koji pamti",
        "veza između računara"
      ],
      "answer": 0,
      "why": { "sr": "Podatak je sirov zapis…", "en": "A datum is a raw record…" }
    }
  ]
}
```

Validation (`server/utils/questions.ts`, run on every load; also called by `bake`):
- `n` covers 1..slideCount exactly once each, ascending.
- non-skip: 4 distinct non-empty options (after localization + trim), `q` non-empty, `answer` ∈ 0..3.
- `skip: true` allowed (title/section slides) but a course needs ≥ 8 answered slides to be listed.
- `why` optional; never sent before a passed report.
- Every option of every slide must have a *distinct* folded text — otherwise a learner can't tell
  two options apart (catches copy-paste authoring errors).

**90 % with small decks:** `passed = correct >= ceil(0.9 * total)`. A 4-slide deck then demands 4/4;
warn at bake time when `total < 10`, because the pass rule stops being informative. The example
decks in `tmp-archive-2026-11` are 3–17 slides, mostly 10–16 → fine.

## 5. Bake pipeline (`npm run bake [slug…]`)

1. `sha256(slides.pptx)`; if `manifest.deckSha` matches **and** every listed image exists → skip (`--force` to redo).
2. `soffice --headless --convert-to pdf` into a temp dir (serialised: LibreOffice can't run concurrently).
3. `pdfinfo` page count, then `pdftoppm -webp -r 110 -scale-to-x 1600` → `001.webp …`.
4. Write `manifest.json`:
   ```json
   { "deckSha": "…", "slideCount": 16, "images": ["001.webp", …],
     "slideXmlSha": ["…", …], "builtAt": "…" }
   ```
   `slideXmlSha[i]` = hash of `ppt/slides/slideN.xml` from the pptx zip, so later edits can report
   "slide 7 changed since its question was written" (authoring aid, warning only).
5. Cross-check against `questions.json` (slide count, numbering) and fail with the slide number.
6. `bake:check` (CI + `./test`) fails when a deck's hash ≠ manifest, i.e. someone edited a deck
   without re-baking — that's the only way a stale slide can reach a learner.

Warns (does not fail) on: embedded video/audio, notes-only slides, images wider than ~2 MP.
Deck size budget: 10–16 slides ≈ 1–2 MB of webp per course.

## 6. Routes

| Route | Purpose |
|---|---|
| `/` | catalogue: cards, search, ⬇ pptx, last result badge, locale switcher |
| `/c/<slug>` | cover: title, description, slide count, **start/resume at slide n**, restart, download |
| `/c/<slug>/<n>` | player: slide *n* + its question (1-based, deep-linkable) |
| `/c/<slug>/reply` | (internal) name gate → report |
| `/c/<slug>/certificate` | HTML certificate (only if passed), print-styled |
| `/verify/<id>` | public certificate check, locale-free URL, works without JS |
| `GET /c/<slug>/slides.pptx` | `Content-Disposition: attachment`, ETag = deckSha, `Accept-Ranges` |
| `GET /c/<slug>/slides/<n>.webp` | `Cache-Control: public, max-age=31536000, immutable`; `?v=<deckSha8>` in the img src |
| `GET /api/courses?q=&locale=` | catalogue JSON (search folding server-side too, for tests) |
| `POST /api/c/<slug>/answer` | `{n, choice}` → `{ok:true}`; `409` if already answered, `422` if out of range |
| `POST /api/c/<slug>/report` | `{name}` → finalizes attempt, returns score + wrong slide numbers (+ `why` if passed) |
| `GET /c/<slug>/certificate.pdf` | pdf-lib output |

i18n: `prefix_except_default` (`sr` unprefixed, `/en/…`, `/zh-CN/…`), browser detection via `sc_lang`
cookie. `/verify/<id>` is excluded from the i18n prefix because certificate IDs are printed.

## 7. Home page

- Cards: title, one-line description, `N slajdova`, tags, ⬇ icon; whole card links to `/c/<slug>`.
- Search: instant client-side filter over the preloaded catalogue using `matchesQuery()`:
  case-, diacritic- and script-insensitive (`ciscenje` → `Čišćenje` → `чишћење`), AND over terms,
  matches title/description/slug/tags. `/` focuses, `Esc` clears, `Enter` opens the first hit.
- Empty states: no courses at all vs. no match for the query (with the query quoted back).
- Result badge: past attempt for that slug from the cookie (passed / score / "resume").
- The ⬇ is a real `<a download href="…">` so it works with JS disabled.

## 8. Player (`app/pages/c/[slug]/[n].vue`)

- Image area sized to the deck's aspect ratio (from the manifest) so nothing jumps; bottom panel
  ~34 vh, collapsible ("peek") for tall slides; on mobile the panel becomes a bottom sheet.
- Question + 4 options (A–D). Keys `1–4` select, `Enter` next, `←/→` navigate.
- **Click locks the answer** (`POST`, then the panel becomes `odgovoreno · dalje →`). Going back shows
  the choice read-only: no re-answer, no correctness hint, no colours that imply right/wrong.
- Progress `n / total`; no skipping past unanswered slide; the last one leads to the report gate.
- Prefetch slide *n+1* (`<link rel=prefetch>` or `new Image()`), resume server-side, so a closed tab
  continues where it stopped.
- SSR the slide image + question so the page is usable before hydration; no answers in the payload.

## 9. Report, certificate, verify

**Name gate** (`/c/<slug>/report` before answering is done → redirect back to the current slide):
one input, `required`, max 60 chars, trimmed, remembered in `localStorage`; a "show result" button.

**Report**: score `correct/total`, percentage, pass/fail, list of wrong slide numbers ("slajd 7"),
and — only when passed — a collapsible `why` per wrong/answered slide. Failed attempts show *which*
slides were wrong and nothing else. Actions: back to course, "try again" (new attempt, unlimited),
"download certificate" (only if passed).

**Certificate PDF** (A4 landscape, pdf-lib): border, `cert.title`, learner name (large), course
title, date passed, score, `cert.id`, `verify/<id>` URL text + QR (from `qrencode`, optional).
Fonts subset per render via fontkit, CJK bytes only when the name needs them.
`cert_id = base32(sha256(attempt_id | slug | finished_at))[:12]`, uniqueness-checked against the DB.
PDF is regenerated on demand from the DB row, so it can always be re-downloaded.

**`/verify/<id>`**: "valid", name, course, date — or 404 "unknown ID". No login, no JS needed.

## 10. Data model

```sql
attempts(id TEXT PK, slug TEXT, sid TEXT, name TEXT, lang TEXT,
         started_at TEXT, finished_at TEXT, score INT, total INT,
         passed INT, cert_id TEXT UNIQUE)
answers(attempt_id TEXT, n INT, choice INT, answered_at TEXT,
        PRIMARY KEY (attempt_id, n))
```
`total` excludes skipped slides; `score` counts `choice == answer` at finalize time (recomputed
server-side from `answers` and the validated question set, never taken from the request).

## 11. Dependencies (and what was rejected)

Runtime: `nuxt` 4.6, `@nuxtjs/i18n` 10, `pdf-lib`, `@pdf-lib/fontkit`. Dev: `vitest` 4,
`@nuxt/test-utils` 4, `@vue/test-utils`, `happy-dom`, `playwright`, `typescript`, `vue-tsc`.
(`@nuxt/test-utils` 3 + vitest 3 is NOT a valid pair with Nuxt 4 — the config silently produces an
unhandled collection error; 4.x/4.x is the working combination.)

Rejected: Next 16 + next-intl (no benefit here); Tailwind/UI kit (4 screens); an ORM (7 columns);
`better-sqlite3` (native build on NixOS, for nothing); S3/CDN for slides (a VPS serves 2 MB decks);
client-side pptx rendering; a CMS (git *is* the CMS); auth (explicitly not wanted).

## 12. Tests

| File | Covers |
|---|---|
| `tests/course.test.ts` | folder discovery, slug rules, localized title/description, order, "unbaked" course listed as unavailable |
| `tests/questions.test.ts` | numbering gaps/dupes, dup options after folding, `answer` range, missing `why`, localized option resolution, `skip` |
| `tests/search.test.ts` | folding table (`č/ć/š/ž/đ`, Cyrillic, CJK untouched), multi-term AND, empty query, no hits |
| `tests/grading.test.ts` | threshold with `ceil` (e.g. 9/10 pass, 8/10 fail; 4/4 pass; 13/15 fail/14/15 pass), cert id determinism + collision handling |
| `tests/api.nuxt.test.ts` | `/api/courses`, answer POST (`409` on second answer), report requires all slides, unknown slug 404, pptx route content-type + zip magic + ETag |
| `tests/leak.test.ts` | **the one that matters**: no correct option text / `answer` / `why` in SSR HTML or any API response before the report; on a *failed* report still no `why`; on a *passed* report `why` appears |
| `tests/bake.test.ts` | `@skipUnless(soffice && pdftoppm)` — bake `tests/fixtures/mini.pptx`, 3 webp with valid magic bytes, manifest hashes, second run is a cache hit |
| `tests/e2e/player.spec.ts` | playwright: answer → locked → reload → same slide → finish → name → report; download icon returns a `.pptx` |

`tests/fixtures/mini.pptx` = a copied 3-slide deck (`scenario-i-algoritam.pptx`) so the bake test is
deterministic. Fixtures are the only binaries besides the courses themselves.

## 13. Git

Repo is initialised; `main` only, short-lived branches per milestone (`m2-player`, `m4-cert`), one
tag per milestone (`v0.2`…). `.gitignore` covers `data/`, `.nuxt/`, `.output/`, `node_modules/`,
`test-results/`; `courses/*/slides/` and `manifest.json` are **committed on purpose**.
Deck binaries: commit as-is (~100 KB); no LFS unless decks start exceeding a few MB.

## 14. Deploy (Docker, one container)

`Dockerfile` has four stages; only `runtime` ships.

| Stage | Base | Purpose |
|---|---|---|
| `base` | `node:22-bookworm-slim` | shared env (`NITRO_PORT=3000`, `NITRO_HOST=0.0.0.0`) |
| `deps` | base | `npm ci` with a BuildKit npm cache |
| `build` | base | `npm run build` → `.output/` |
| `runtime` | `node:22-bookworm-slim` | `.output` + `courses/`, non-root `node` user, `/data` volume, `HEALTHCHECK` on `/api/health` |
| `bake` | `node:22-bookworm` | LibreOffice Impress + poppler + Noto fonts; `scripts/bake-courses.mjs` only, **never shipped** |

```bash
docker compose up -d --build        # app on 127.0.0.1:8765 → container :3000
docker compose run --rm bake        # re-bake courses/*/slides/*.webp in a container
```

- Runtime image is Node-only (~180 MB); LibreOffice lives only in the `bake` stage/profile,
  keeping the design honest: **production serves pre-baked images and a small Node process.**
- `course-data` volume → `NUXT_DATA_DIR=/data` (SQLite survives rebuilds); `courses/` is read-only
  inside the image (bind-mount it if you prefer adding decks without a rebuild).
- Behind Caddy/nginx: TLS, brotli/gzip, `immutable` caching for `/c/*/slides/*.webp`.
- CI/deploy gate: `npm run bake:check` fails when a deck changed without re-baking.
- Single instance only (SQLite + in-process state). Health: `GET /api/health` → `{ok, courses, uptime}`.

## 15. Milestones

| M | Content | Done when |
|---|---|---|
| **M0** ✅ | scaffold: nuxt config, flake, layout, catalogue page, course loader, locales, Dockerfile + compose, README/AGENTS/PLAN | `./serve` shows the catalogue with locale switcher; `./test` runs; `docker compose up` serves `/api/health` → healthy |
| **M1** | `bake-courses.mjs`, `questions.ts` validation, `new-course` script, `mini.pptx` fixture, first real deck | `npm run bake` renders a deck; bad `questions.json` fails with the exact slide; `bake:check` works |
| **M2** | player page, `store.ts`, answer POST, resume, cover page, download route, slide image route | a course can be answered end to end; reload resumes; ⬇ works |
| **M3** | report + name gate + scoring + retakes + `why` on pass | 8/10 → "failed, slide 3 wrong", no answer; 10/10 → explanation shown |
| **M4** | certificate PDF + HTML page + `/verify/<id>` | PDF has name/date/score/ID; verify resolves 200/404 |
| **M5** | content: 3–4 courses from `tmp-archive-2026-11`, zh-CN translations of the UI strings checked by eye | home page looks like a real site |
| **M6** | polish: `?preview=1` author mode (localhost only, shows answers), keyboard help, mobile sheet, reduced motion, OG meta | — |

Effort: M0–M1 ≈ 5 h, M2 ≈ 6 h, M3 ≈ 3 h, M4 ≈ 4 h, M5 ≈ 1 h per deck, M6 ≈ 3 h.

## 16. Risks

| Risk | Mitigation |
|---|---|
| LibreOffice render differs from PowerPoint (font fallback, overflow) | Fonts pinned in the dev shell; baking is author-time, so problems are seen immediately; webp images are the artifact, so **prod is stable** even if a later LibreOffice changes |
| Deck edited, questions/bakes out of sync | `bake:check` in CI + `slideXmlSha` mismatch warning; slide-count validation |
| Answer leak via SSR state / devtools | `tests/leak.test.ts` + answers never serialized; report built from server-side grading only |
| 90 % too strict on short decks | Warn when < 10 answered slides; per-course `passThreshold` override |
| CJK names in the PDF | Noto Sans SC subset embedded via fontkit; test with a Chinese name fixture |
| `node:sqlite` is marked experimental | Confined to `utils/store.ts`; swap to `better-sqlite3` in one file; deploy on node 24 LTS where it is unflagged |
| NixOS + npm native prebuilds | No native deps by design (that's why pdf-lib and node:sqlite) |

## 17. Remaining questions

1. Default UI locale: `sr` (assumed) — or should the unprefixed default be `en` since the site may be shared?
2. Should passing the same course twice issue a **new** certificate (new ID) or reuse the first?
3. Do you want the Serbian UI in Latin script only (assumed), or a `sr-Cyrl` variant as a 4th locale?
