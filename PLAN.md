# slide-course — plan

**Status:** PLAN ONLY (scaffold = this file, README, .gitignore, flake.nix, empty dirs).
**What it is:** a no-login course website where **a course *is* a `.pptx` deck**.
Each slide is a page; a 4-option question about that slide is pinned to the bottom of the page.
Answer → next slide → … → name → report → certificate. No right answers are ever revealed.

---

## 1. Decisions that shape everything

| Decision | Choice | Why |
|---|---|---|
| Rendering pptx | **Server-side bake**: `soffice --convert-to pdf` → `pdftoppm` → one image per slide | Pixel-faithful, no JS pptx engine, no font drift in the browser, offline-safe. Client-side pptx renderers (`pptxjs`, `pptx-preview`) mangle themes, tables and overflow. |
| Questions | **`questions.json` next to the deck**, one entry per slide | No database authoring, reviewable in git, diffable. Answers stay server-side. |
| Grading | **Server-side only** | The client never receives `answer`. A page source view cannot cheat. |
| Accounts | **None**. Random `sid` cookie = the learner's identity | Requirement: no login. Certificate is *claimed*, not authenticated — its value is the record in `verify/<id>`. |
| Stack | Python **stdlib** (`http.server`, `sqlite3`) + static HTML/CSS/JS inside a `nix develop` shell | Same shape as `~/nix-course` — their existing pattern, zero npm, `./serve` and go. |
| Certificate | HTML page with print CSS, PDF produced by `soffice` from that HTML | Reuses a dependency we already need. Fallback if the PDF is ugly: `reportlab` from nixpkgs. |

**Verified on this machine (2026-11-22):**
- `soffice --headless --convert-to pdf deck.pptx` works (15-slide school deck → 306 KB PDF, ~3 s).
- Host `PATH` has **no** `python3`, `pdftoppm`, `pdflatex`. `nix` 2.34.9 is present.
  → the dev shell is not optional; `./serve` must `exec nix develop -c …` like `~/nix-course/web` does.
- Example material: `/mnt/pool/nikola/tmp-archive-2026-11/Novo/ORGANIZOVANO/racunarstvo-i-informatika/`
  has ~21 Serbian informatics decks, **3–17 slides** each (most 10–16). That is the realistic
  authoring budget: 10–16 questions per course, i.e. one evening per course, not an essay.

---

## 2. Layout

```
~/slide-course/
  PLAN.md  README.md  flake.nix  .gitignore
  serve                     # exec nix develop -c python3 app/server.py "$@"
  test                      # exec nix develop -c python3 -m unittest discover -s tests
  app/
    server.py               # routes, HTTP, cookies, static
    courses.py              # discover course dirs, load+validate course.json/questions.json
    render.py               # pptx -> pdf -> webp, hash-keyed cache
    grading.py              # scoring, pass rule, cert ids
    store.py                # sqlite: attempts, answers, certificates
    static/ index.html player.html report.html verify.html  app.css  app.js
  tools/
    build.py                # bake renders + validate questions (used by tests and by serve on demand)
    new_course.py           # scaffold courses/<slug>/ from a .pptx, emit draft questions.json
  tests/  (see §8)
  courses/
    <slug>/
      course.json           # title, description, tags, lang, pass_threshold, author, cover
      questions.json        # per-slide question
      slides.pptx           # the course
      .build/               # generated: 001.webp..N.webp, manifest.json  (gitignored)
  data/                     # course.db  (gitignored)
```

## 3. Course package format

`courses/podaci-i-informacije/course.json`
```json
{
  "slug": "podaci-i-informacije",
  "title": "Podaci i informacije na internetu",
  "description": "Šta su podaci, šta informacije i kako se čuvaju na internetu.",
  "tags": ["informatika", "5. razred", "internet"],
  "lang": "sr",
  "pass_threshold": 0.8,
  "order": 30
}
```

`courses/podaci-i-informacije/questions.json`
```json
{
  "slides": [
    { "n": 1, "skip": true },
    { "n": 2, "q": "Šta je podatak?",
      "options": ["sirova činjenica bez značenja", "obrađen zaključak",
                  "uređaj koji pamti", "veza između računara"],
      "answer": 0,
      "why": "Podatak je sirov zapis; informacija nastaje kad se podatak protumači." },
    { "n": 3, "q": "…", "options": ["…","…","…","…"], "answer": 2 }
  ]
}
```

Rules enforced by `courses.py` (errors are fatal at startup, never at slide 9):
- `n` covers **1..slide_count** exactly, each once, ascending; entries may `"skip": true` (title/section slides).
- Non-skip entry: exactly 4 non-empty options, all distinct (after trim), `answer` ∈ 0..3, `q` non-empty.
- `why` is **optional and never sent to the client** (kept for authoring/future "explain after pass").
- Deck slide count comes from the baked manifest; a pptx/question mismatch fails `./serve` and `tools/build.py` with the exact slide number.

## 4. Build step (`tools/build.py <slug>`)

1. `sha256(slides.pptx)` → if `.build/manifest.json` has the same hash, skip.
2. `soffice --headless --convert-to pdf` into a temp dir (lock/serialise: LibreOffice hates concurrency).
3. `pdftoppm -webp -r 110 -scale-to-x 1600` → `001.webp …` (~60–150 KB/slide, deck ≈ 1–2 MB).
4. Write `manifest.json`: `{deck_sha, slide_count, images[], built_at}`; also verify count == `pdfinfo` pages.
5. Record per-slide `sha256(text)` of `ppt/slides/slideN.xml` so later edits can flag
   "slide 7 changed since its question was written" (warning in `build.py`, authoring aid only).

`tools/new_course.py <deck.pptx> --slug x --title "…"` copies the deck, writes `course.json`,
and writes a `questions.json` stub with one placeholder per slide + a comment field, so authoring
is fill-in-the-blank instead of from-scratch JSON.

**Known limits:** animations, video, audio and slide transitions are dropped (first frame only);
fonts not installed in the dev shell fall back. Both are acceptable for reading material; `build.py`
warns when a slide has media parts.

## 5. URLs

| Route | What |
|---|---|
| `/` | **Catalogue**: every course, searchable, pptx download per course |
| `/c/<slug>` | start or resume (redirects to first unanswered slide) |
| `/c/<slug>/<n>` | slide *n* (1-based) + its question |
| `/c/<slug>/slides.pptx` | download, `Content-Disposition: attachment`, ETag = deck hash |
| `/c/<slug>/report` | name gate → report |
| `/c/<slug>/certificate.pdf` | only when passed |
| `/verify/<cert_id>` | public, no-login check of a certificate |
| `/api/courses?q=` | JSON catalogue (used by the page; server-side `LIKE` for tests/growth) |
| `/api/c/<slug>/answer` | `POST {n, choice}` → `{ok:true}` only; no correctness in the response |

**Home page**: cards (cover = slide 1 render, title, description, N slides, tags, ⬇ pptx icon,
last-result badge). Search box, instant, client-side over the preloaded catalogue (decks number in
the dozens, not thousands): case- and diacritic-insensitive — `podaci` matches `Podaci`,
`ciscenje` matches `čišćenje`, and Latin↔Cyrillic `s/š/č/ć/ž/đ` folding so `ciscenje` also matches
`чишћење`. Keyboard: `/` focuses search, `Enter` opens the first hit, `Esc` clears. Empty state:
"nema kursa za „x”". Download icon is a plain `<a download>`, works with JS off.

## 6. Player

- Slide image fills the viewport above a fixed bottom panel (~34vh, collapsible to peek at tall slides).
- Question text + 4 buttons (A–D). Keys `1–4`, `Enter` = next, `←/→` = prev (read-only).
- **Locking:** clicking an option records it immediately (`POST`), marks it selected, and the
  panel turns to "odgovoreno · dalje →". Going back shows the choice as read-only — no re-answer,
  no feedback, no right/wrong hint. `N` of `M` progress bar; no skipping ahead past an unanswered slide.
- Answers are flushed as they happen, so a browser close mid-course resumes at the same slide.
- Prefetch slide *n+1* image; `<img>` with explicit aspect ratio to avoid layout jump.
- Resume banner on `/c/<slug>`: "nastavljaš od slajda 7 · počni iznova (briše odgovore)".
- No-jank on mobile: panel becomes a bottom sheet.

After the last answer → `/c/<slug>/report` shows a **name gate** (single input, `required`,
maxlength 60, trimmed; remembered in `localStorage` for convenience).

## 7. Report & certificate

Report shows: total, correct, percentage, pass/fail, and per-slide rows "slajd 7 — netačno".
It does **not** show the correct option, the number of the correct option, or `why`.
Bottom actions: "nazad na kurs", and if failed "pokušaj ponovo" (new attempt, same name).
If passed: "preuzmi sertifikat (PDF)".

Certificate (A4 landscape, print CSS): learner name, course title, date passed, score,
certificate ID, verify URL + QR (QR optional: `qrencode` in dev shell, else a `/verify/<id>` text line).
`cert_id = base32(sha256(attempt_id | slug | finished_at))[:12]` — deterministic, collision-checked
against the DB.
`/verify/<id>` renders "valid, <name>, <course>, <date>" from the DB, and 404s otherwise.

Data model (sqlite):
```sql
courses(slug PK, title, deck_sha, slide_count)      -- refreshed at startup from disk
attempts(id PK, slug, sid, name, started_at, finished_at, score, total, passed, cert_id)
answers(attempt_id, n, choice, answered_at, PRIMARY KEY(attempt_id, n))
```
Scoring: `correct = Σ choice == answer`; `passed = correct/total >= pass_threshold`.
`total` excludes skipped slides.

## 8. Tests (`./test`, stdlib `unittest`, no network)

| File | Covers |
|---|---|
| `test_courses.py` | question/deck validation: count mismatch, duplicate options, `answer` out of range, missing `n`, `skip` on a question slide; good fixture loads |
| `test_search.py` | folding (diacritics, Cyrillic), substring on title/description/tags, empty query, no hits |
| `test_grading.py` | score, threshold boundary (exactly 80 % = pass), cert id determinism + uniqueness |
| `test_server.py` | spins the app in a tmpdir on port 0 via `urllib`: catalogue → player → answer → resume → report → cert PDF; `/verify` 200/404; unknown slug 404; **`/c/<slug>/slides.pptx` is a valid zip and `application/vnd.openxmlformats-officedocument.presentationml.presentation`** |
| `test_leak.py` | **the important one**: for every slide, no HTML/JSON served during the attempt contains any correct option text, the string `answer`, or `why` |
| `test_render.py` | `@skipUnless(soffice)` — bake `tests/fixtures/mini.pptx` (3 slides), assert 3 images, valid webp magic bytes, hash-keyed cache hit on second run |

`tests/fixtures/mini.pptx` = a copied 3-slide deck (`scenario-i-algoritam.pptx`, 124 KB) so the
render test is deterministic. Fixtures are the only binaries in the repo.

## 9. Git

- Repo already `git init`-ed here. `main` only; short-lived branches per milestone (`m2-player`,
  `m4-cert`), merge back; tag `v0.1`… per milestone. Commit messages: `<area>: <what>`.
- `.gitignore`: `data/`, `courses/*/.build/`, `*.pdf` at root, `__pycache__`, `.direnv`, `result`.
- **pptx in git:** commit them (they are the source of truth and ~100 KB each). Revisit LFS only
  if decks grow past a few MB or the repo is pushed somewhere with limits. No LFS for now.

## 10. Milestones

| M | Content | Done when |
|---|---|---|
| **M0** | scaffold, flake (`python3`, `poppler_utils`, `libreoffice`), `serve`/`test` scripts, catalogue of zero courses | `./serve` opens an empty home page; `./test` runs (no tests yet) |
| **M1** | `render.py` + `build.py` + `courses.py` validation; `new_course.py`; one real deck (2-slide school deck) | `tools/build.py` produces webp + manifest, validation errors are human-readable |
| **M2** | catalogue page + search + pptx download; player with locked answers, resume, prefetch; sqlite store | a full course can be answered end to end and survives a reload |
| **M3** | report + name gate + scoring + retake | 3/5 correct course shows "3/5, 60 %, nije položeno" and no answers |
| **M4** | certificate HTML + PDF + `/verify/<id>` | PDF downloads, contains name/date/slug/id, `/verify` resolves |
| **M5** | real content: 3–4 courses from `tmp-archive-2026-11`, cover images, ordering | home page looks like a site, not a demo |
| **M6** | polish: keyboard help, mobile sheet, `?preview=1` author mode (shows answers + why, localhost only), authoring aid that dumps slide text next to each stub question | — |

Rough effort: M0–M1 ~4 h, M2 ~6 h, M3 ~2 h, M4 ~3 h, M5 is authoring (≈1 h per deck), M6 ~3 h.

## 11. Open questions (answer before M2)

1. **Pass threshold** — 80 % default? Retake unlimited, or lock after first pass?
2. **Report wording** — Serbian (`netacno`, `polozheno`) or English? Content is Serbian; I assume Serbian UI.
3. **After passing** — allow a second attempt? Show `why` explanations *after* passing (deferred, M6)?
4. **Deploy** — strictly `127.0.0.1` local, or does it eventually go on a server/domain (changes
   nothing in the code except `--host`/`--behind-proxy` handling and sqlite locking)?
