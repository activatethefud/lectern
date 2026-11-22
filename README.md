# slide-course

A no-login course website where **each course is a `.pptx` deck**. You read a slide, answer the
4-option question pinned under it, move on; at the end you get a report (wrong ones marked, right
answers never revealed) and a certificate if you pass.

See [PLAN.md](PLAN.md) for the design and milestone list. **Nothing is implemented yet.**

## Run

```bash
./serve          # → http://127.0.0.1:8765
./test           # unit + integration tests
```

Both drop into the flake's dev shell (`python3`, `poppler_utils`, `libreoffice`), because the host
has no `python3` or `pdftoppm` on `PATH`.

## Authoring a course

```bash
tools/new_course.py ~/deck.pptx --slug moj-kurs --title "Moj kurs"
# fill in courses/moj-kurs/questions.json, then
tools/build.py moj-kurs
```
