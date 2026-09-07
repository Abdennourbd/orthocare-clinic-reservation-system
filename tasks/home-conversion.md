# Home Conversion Rebuild (2026-09-07) — what patients need before booking

## Why the current home doesn't convert (honest audit)

- Real clinic photos vendored but only 2 of 8 used. A dental homepage with
  no clinic, no results, no chair-side humanity asks for trust with words.
- Copy answers the clinic ("nos soins", "pourquoi nous choisir") instead of
  the patient's hidden questions: *will it hurt? is it clean? can I afford
  it? do they handle kids/anxiety? will my smile actually change?*
- CodeFronts referenced but never actually used. Gooey nav shipped with
  stock gray/orange palette + dead dark-mode classes.

## What the research says (sources in chat 2026-09-07)

- 71% research online first; 44% of mobile searchers book; 82% of bookings
  happen on mobile; 77–83% choose providers with online scheduling; 40% of
  bookings happen after hours → mobile-first, sticky booking path, 24/7
  online booking front and center.
- 90.4% trust online reviews; fellow-patient stories are the #1 factor for
  39.2% → real quotes + real names + Google widget, not bare stars.
- Top decision blockers (systematic review): COST, DENTAL FEAR, visible
  AESTHETIC proof, PAIN → before/after slider, fear-killer section,
  hygiene photos, "we call to confirm" promise.
- Decision path: trust (reviews/photos/bio) → fit (my problem) → friction
  (phone, hours, path). CTA must never disappear on mobile.

## New page order (each answers one patient question)

1. Hero — who (Dr Besma Moussaoui, face) + promise + book/call [EXISTS]
2. ProofBar — rating 4.8 (37), hours, phone [EXISTS]
3. SmileResults — NEW: real before/after slider (vendored photos) + caption
   "résultat réel à la clinique" + book CTA. Answers: *will it work for me?*
4. ComfortSection — NEW: "Peur du dentiste ?" + treatment photo + 3 gentle
   promises. Answers: *will it hurt / will they judge me?*
5. DoctorSection — NEW: credentials (ODF, PITTS, aligneurs) + real kindness
   quote. Answers: *who will touch my teeth?*
6. ServicesPreview — fit [EXISTS]
7. ToothBrushGame — kept in place per human decision [EXISTS]
8. ClinicSection — NEW: waiting room / reception / equipment + hygiene
   captions. Answers: *is it clean and modern?*
9. TestimonialsPreview (real seed quotes) + FeaturesSection (3) +
   FaqPreview (objections) [EXIST]
10. ReviewsSection (Google) → LocationSection → CtaBand [EXIST]
11. StickyBookBar — NEW, home-only, mobile: Call + Book always visible.

## Real CodeFronts usage (MIT, attributed in code)

- hs-09 before/after slider mechanics → already embodied by our superior
  `BeforeAfterSlider` (pointer + keyboard + RTL-isolated); SmileResults
  reuses it with real photos instead of rebuilding.
- hs-07 star-pill language → rating badge styling in SmileResults caption
  and DoctorSection quote card.
- hs-04 glass-over-aurora → already in hero; extended to ComfortSection
  photo treatment (frosted caption card over wide photo).

## Out of scope (still)

Rebrand beyond logo, pricing pages (cost question answered by "devis clair
en consultation" copy only), online payment, patient portal.

## Built 2026-09-07 (all verified: 1183 tests, typecheck, lint, build, SSR)

Nav palette fix + SmileResults + ComfortSection + DoctorSection +
ClinicSection + StickyBookBar + conversion page order. Commits:
`c65664f`, `95ad144`, `6dbd397`, `87272d4` (+ fix below). All 8 vendored
photos now used. Full review loop done: 1 eyebrow site-wide, max 2
consecutive splits, no duplicate CTA intents, copy self-audit passed.
Known follow-ups for a human with a browser: screenshots, Lighthouse,
keyboard-only pass; primary-CTA contrast (white on teal-600) is a
site-wide pre-existing pattern worth a design pass.
