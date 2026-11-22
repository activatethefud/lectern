# slide-course

A no-login course website where **a course is a `.pptx` deck**. You read a slide, answer the
4-option question pinned under it, move on; at the end you get a report (wrong answers marked,
right answers *not* revealed), and if you score ≥ 90 % a certificate.

* [PLAN.md](PLAN.md) — design, formats, milestones
* [AGENTS.md](AGENTS.md) — conventions and invariants for coding agents

**Status:** scaffold + plan. Home page renders; the player/report/certificate are M2–M4.

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
- The `course-data` volume holds `course.db` (attempts, certificates) and survives rebuilds.
- Re-bake decks without installing LibreOffice on the host: `docker compose run --rm bake`
  (writes `courses/*/slides/` back into your working tree).
- Courses are baked into the image; bind-mount `./courses:/app/courses:ro` in
  `docker-compose.yml` if you would rather add courses without rebuilding.

## Add a course

```bash
mkdir -p courses/moj-kurs
cp ~/deck.pptx courses/moj-kurs/slides.pptx
$EDITOR courses/moj-kurs/course.json      # title/description/tags (sr, en, zh-CN)
$EDITOR courses/moj-kurs/questions.json   # one question per slide
npm run bake moj-kurs                     # pptx → courses/moj-kurs/slides/*.webp + manifest
```

Nothing is registered anywhere: a folder under `courses/` is a course, and the home page picks
it up on the next request. Baked images are committed, so a deploy never needs LibreOffice.

## Tests

```bash
npm run bake:check   # every deck's baked images match its pptx hash
npm run test:e2e     # playwright: answer locking, resume, no answer leakage
```
