# Lectern

A no-login course website where **a course is a `.pptx` deck**. You read a slide, answer the
4-option question pinned under it, move on; at the end you get a report (wrong answers marked,
right answers *not* revealed), and if you score ≥ 90 % a certificate.

* [PLAN.md](PLAN.md) — design, formats, milestones
* [AGENTS.md](AGENTS.md) — conventions and invariants for coding agents

**Status:** working end to end up to the report. Catalogue (search, 3 locales), per-course cover,
player with server-locked answers and resume, `.pptx` download, baked slides, Docker image.
Report (M3) and certificate (M4) are next. One real course is in the repo:
`courses/bezbedno-koriscenje` — 15 slides, 10 questions.

## Run

```bash
./serve     # → http://127.0.0.1:8765   (nuxt dev, inside the flake)
./test      # vitest: unit + Nuxt integration
```

The host has no `python3`/`poppler`/`node` on `PATH`, so both scripts drop into
`nix develop` (node 22, poppler, libreoffice).

## Run in Docker

```bash
docker compose up -d --build       # → http://127.0.0.1:8765
curl -s localhost:8765/api/health   # ok + course count
```

- The runtime image is **Node only** (~180 MB): slides are pre-baked, so no LibreOffice in prod.
- The `lectern-data` volume holds `course.db` (attempts, certificates) and survives rebuilds.
- Re-bake decks without installing LibreOffice on the host: `docker compose run --rm bake`
  (writes `courses/*/slides/` back into your working tree).
- Courses are baked into the image; bind-mount `./courses:/app/courses:ro` in
  `docker-compose.yml` if you would rather add courses without rebuilding.

## Add a course

```bash
mkdir -p courses/moj-kurs
cp ~/deck.pptx courses/moj-kurs/slides.pptx
$EDITOR courses/moj-kurs/course.json      # title/description/tags (sr, en, zh-CN)
$EDITOR courses/moj-kurs/questions.json   # one question per slide (strings or {sr,en,zh-CN})
./bake moj-kurs                           # pptx → courses/moj-kurs/slides/*.jpg + manifest
```

## Translate a deck

A course can carry translated decks next to the original one (`slides.en.pptx`, `slides.zh-CN.pptx`).
The tool rewrites only the text of each run, so layout, fonts and shapes are untouched:

```bash
node tools/translate-deck.mjs extract moj-kurs en   # → courses/moj-kurs/translation/en.json
#   fill in every "dst" string, same order and count
node tools/translate-deck.mjs apply moj-kurs en     # → slides.en.pptx
./bake moj-kurs                                     # → slides/en/*.jpg, manifest variants
```

The player then offers a language switch (SR / EN / 中文) and the ⬇ button downloads the deck in
the chosen language. If the deck is edited, `extract`/`apply` refuse until you re-extract — that
is what keeps a stale translation from silently shipping.

Nothing is registered anywhere: a folder under `courses/` is a course, and the home page picks
it up on the next request. Baked images are committed, so a deploy never needs LibreOffice.

## Certificates

Passing (≥ 90 %) issues a certificate carrying a **tracking number** (`SC-2026-000001`), the exact
date and time of issue, and an HMAC signature over those fields.

- `/verify/<serial>` — public: name, course, date+time, score, signature status. This is what a
  recipient checks to see that the printed name is the registered one.
- `/certificate/<verifyId>` — the PDF, downloadable **only by the browser session that earned it**
  (404 for anyone else), so the link cannot be forwarded to another person.
- `NUXT_CERTIFICATE_SECRET` signs certificates. Set it in production so signatures survive a lost
  data volume; in dev one is generated into `data/.certificate-secret`.
- One attempt ⇒ one serial. The name is frozen at issue, so a certificate cannot be re-issued to
  somebody else.

## Tests

```bash
./test               # 23 tests: search folding, player API, answer locking, translation, report, certificate
npm run bake:check   # every deck's baked images match its pptx hash
```
