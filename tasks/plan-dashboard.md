# Plan — Refonte Tableau de bord Admin OrthoCare Clinic

## Aperçu
Refonte du `DashboardHome` actuel (server component : `KpiCards` seules, sans interactivité) en un tableau de bord « dentist-first » : briefing du matin, bandeau semaine Sam–Jeu (vendredi fermé), file d'appels urgente, pulsation SMS + compositeur rapide. Le tout en FR uniquement, fuseau clinique `Africa/Algiers` via `src/lib/time/clinicTime.ts`, bento dense responsive 375/768/1024/1440, design system `design-system/orthocare-admin/MASTER.md` (cyan calme `#0891B2` + vert santé `#059669`, fond `#ECFEFF`, texte `#164E63`, radius 12–16px, ombres douces, pas de dégradés violets, pas d'emojis en icônes, contraste 4,5:1, clavier accessible). La page serveur garde le fetch KPI ; les widgets clients chargent en paresseux avec `AbortController`, un seul fetch semaine, previews limitées 5–20 avec liens vers pages complètes.

## Décisions d'architecture
- **Réutiliser, ne pas dupliquer :** `GET /api/admin/appointments?date=&status=`, `GET .../pending` (file d'appels, plus ancien d'abord + `expiresAt`/`msRemaining`), `GET .../search?q=`, `GET /api/admin/sms?limit=`, `GET /api/admin/sms/batches`, `POST /api/admin/sms/single {patientId,body}`, `GET /api/admin/kpis?from=&to=`, `GET /api/admin/waitlist?active=true`, composant `AppointmentActions`, `AppointmentStatusBadge`, `KpiCards`, types `appointmentTypes.ts`.
- **Un seul nouvel endpoint :** `GET /api/admin/appointments/range?from=&to=&status=` (Zod, dates locales clinique `YYYY-MM-DD`, max 31 jours, mêmes conventions auth/rate-limit/audit que la vue jour, `select` nommé uniquement). Justification : 6× vue jour = 6 audits + 6 tirages rate-limit ; le range = 1 audit + 1 tirage.
- **Rendu :** `page.tsx` reste server component (KPI + greeting/heure calculés côté serveur) ; chaque panneau = client component paresseux (`"use client"`, `fetch` + `AbortController` sur unmount, `aria-busy`, `role=status/alert`, squelettes). Aucune math de date hors `clinicTime.ts` (jamais le tz navigateur).
- **Sécurité :** `requireStaff(request, {roles:["ADMIN","RECEPTIONIST"]})` explicite, ordre `requireStaff → (CSRF POST) → rate-limit → Zod → checks domaine → DB`, audit `PATIENT_RECORD_VIEWED` avec compteurs/dates/enums/ids uniquement (jamais noms/tél/corps), `select` nommés Prisma.
- **Motion CSS uniquement :** `fade-up` stagger via `animation-delay` inline, `hover lift` (`translateY(-2px)` + ombre), `prefers-reduced-motion: reduce` → état final immédiat. Pas de `framer-motion` sur le dashboard (dépendance existante non requise ici).

## Liste des tâches (tranches verticales)

### Phase 1 — Fondation API

#### Tâche 1 : Endpoint semaine `GET /api/admin/appointments/range` + schéma Zod + tests — [Moyen]
**Description :** Crée le seul nouvel endpoint : `from`/`to` (requis, `YYYY-MM-DD` local clinique), `status` optionnel (enum existante), garde max 31 jours (`to >= from`, `diff <= 31`), `orderBy startTime asc, id asc`, `select` nommé identique à la vue jour. Handler : `requireStaff ADMIN+RECEPTIONIST` → rate-limit pool lecture partagé `APPOINTMENTS_READ_RATE_LIMIT` clé `staff:<userId>:appointments-read` → Zod → `getClinicDayBoundsUTC(from/to)` pour bornes UTC → `findMany` → audit `PATIENT_RECORD_VIEWED` (`{scope:"range-view", from, to, resultCount}` + `status` si présent) → `ok({from,to,appointments})`.

**Critères d'acceptation :**
- [ ] `GET /api/admin/appointments/range?from=<sam>&to=<jeu>` retourne toute la semaine clinique triée chrono, filtrable par `status`.
- [ ] `from`/`to` invalides, `to < from`, ou intervalle > 31 jours → `400 VALIDATION_ERROR` message FR.
- [ ] 401/403 avant 404/400 ; 429 sur dépassement ; audit sans PII (vérifié en test).

**Vérification :**
- [ ] Tests passent : `npm test -- src/app/api/admin/appointments/range`
- [ ] Typecheck : `npm run typecheck`
- [ ] Manuel : curl avec session staff, cas limites dates + vendredi fermé.

**Dépendances :** Aucune.

**Fichiers susceptibles d'être touchés :**
- `src/schemas/appointment.ts` (ajout `appointmentRangeQuerySchema`)
- `src/app/api/admin/appointments/range/route.ts` (nouveau)
- `src/app/api/admin/appointments/range/route.test.ts` (nouveau)

**Portée estimée :** Medium (3 fichiers)

### Checkpoint : Fondation API
- [ ] `npm run typecheck` OK, `npm test` OK sur le scope range
- [ ] Audit `detail` relu : aucune PII

### Phase 2 — Panneaux cœur

#### Tâche 2 : En-tête briefing matin (greeting + horloge clinique + compteurs + liens) — [Petit]
**Description :** Hero « pulse » : salutation selon heure clinique (`Bonjour`/`Bonsoir` via heure `Africa/Algiers` dérivée serveur, pas `new Date()` navigateur), horloge clinique live (client tick 1s à partir d'un `now` serveur + `formatClinicLocalTime`, `aria-live="off"`, `role="timer"`), compteurs aujourd'hui + file d'appels + préparation demain (issus KPI serveur + `pendingCount` global existant), liens rapides (`/admin/appointments`, `?tab=queue`, `/admin/sms`, `/admin/waitlist`). Anneau de progression « journée confirmée » (SVG pur, `% = confirmés / total jour`, texte + couleur, pas couleur seule).

**Critères d'acceptation :**
- [ ] Strings FR uniquement ; vendredi fermé affiche « Cabinet fermé — semaine précédente complétée » sans casser les compteurs.
- [ ] Horloge tick sans re-fetch ; `prefers-reduced-motion` respecté (pas de pulse animé).
- [ ] Liens clavier-focus visibles (`focus-visible:ring-teal-600`), contraste 4,5:1.

**Vérification :**
- [ ] Tests passent : `npm test -- src/components/admin/DashboardHeader`
- [ ] Build : `npm run build` (ou typecheck si itération rapide)
- [ ] Manuel 375px→1440px : pas de scroll horizontal, hero lisible.

**Dépendances :** Aucune (props KPI depuis `page.tsx` existant).

**Fichiers susceptibles d'être touchés :**
- `src/components/admin/DashboardHeader.tsx` (nouveau)
- `src/components/admin/DashboardHeader.test.tsx` (nouveau)
- `src/app/admin/(dashboard)/page.tsx` (intégration props)

**Portée estimée :** Small (≤3 fichiers)

#### Tâche 3 : Bandeau semaine Sam–Jeu + filtres jour/statut + actions inline — [Moyen]
**Description :** Client widget : un seul `fetch` vers `range?from=&to=` (semaine `getClinicWeekRange(today)` existante), filtres jour (Sam…Jeu + « Toute la semaine ») + statut (6 valeurs `APPOINTMENT_STATUSES`), tri chrono par jour, puis urgences d'abord au sein du jour ? Règle retenue : chrono `startTime asc` (prévisible pour le fauteuil) ; les PENDING expirant bientôt remontent via la file d'appels (Tâche 4), pas ici. Ligne : heure locale `formatClinicLocalTime`, badge `AppointmentStatusBadge` (couleur+texte), `tel:` link, lien patient, `AppointmentActions` inline avec `onUpdated` → re-fetch abortable. Timeline « aujourd'hui » verticale à gauche du groupe jour. Squelettes, vide (« Aucun rendez-vous ce jour » + CTA réserver), erreur (`role="alert"` + Réessayer).

**Critères d'acceptation :**
- [ ] 1 seul appel réseau par changement de semaine/filtre statut (filtre jour = filtrage client, pas de re-fetch).
- [ ] `AppointmentActions` réutilisé tel quel (Confirmer/Terminé/Absent/Annuler/Reporter) ; après action, la liste se rafraîchit.
- [ ] `tel:` + lien patient présents ; badge statut lisible sans couleur ; `aria-busy` pendant chargement ; abort sur unmount.

**Vérification :**
- [ ] Tests passent : `npm test -- src/components/admin/WeekStrip`
- [ ] Typecheck : `npm run typecheck`
- [ ] Manuel : semaine avec vendredi → 6 jours Sam–Jeu affichés, vendredi exclu.

**Dépendances :** Tâche 1.

**Fichiers susceptibles d'être touchés :**
- `src/components/admin/WeekAppointmentsStrip.tsx` (nouveau)
- `src/components/admin/WeekAppointmentsStrip.test.tsx` (nouveau)
- `src/lib/time/clinicTime.ts` (lecture seule, aucune modif attendue — si helper semaine manquant, le signaler au lieu de dupliquer)
- `src/app/admin/(dashboard)/page.tsx` (montage)

**Portée estimée :** Medium (≤4 fichiers)

#### Tâche 4 : File d'appels urgente (top 5 + compte à rebours expiry) — [Petit]
**Description :** Client widget réutilisant `GET .../pending` tel quel (`take` serveur 200, slice client 5, lien « Voir toute la file » vers `/admin/appointments?tab=queue`). Tri plus ancien d'abord conservé ; compte à rebours dérivé de `msRemaining`/`expiresAt` (tick 30s, libellé FR « expire dans 2 h 14 » / « expiré — le cron va purger », `role="status"`). Réutilise `AppointmentStatusBadge` + `tel:` + `AppointmentActions` compact. Vide → « File vide — beau travail » ; erreur → `role="alert"`.

**Critères d'acceptation :**
- [ ] Top 5 les plus anciens affichés, `msRemaining` négatif géré explicitement (pas de « -3 h » brut).
- [ ] Aucun nouvel endpoint, aucun changement de tri serveur.
- [ ] `aria-busy`, focus rings, contraste OK.

**Vérification :**
- [ ] Tests passent : `npm test -- src/components/admin/CallQueuePanel`
- [ ] Typecheck : `npm run typecheck`

**Dépendances :** Aucune (API existante).

**Fichiers susceptibles d'être touchés :**
- `src/components/admin/CallQueuePanel.tsx` (nouveau)
- `src/components/admin/CallQueuePanel.test.tsx` (nouveau)
- `src/app/admin/(dashboard)/page.tsx` (montage)

**Portée estimée :** Small (3 fichiers)

### Checkpoint : Cœur dentiste
- [ ] `npm test` OK, `npm run typecheck` OK
- [ ] Revue manuelle : semaine complète + file + header cohérents, vendredi fermé correct

### Phase 3 — SMS + assemblage créatif

#### Tâche 5 : Pulsation SMS (5 derniers + compositeur rapide) — [Moyen]
**Description :** Deux sous-blocs dans un panneau : (a) `GET /api/admin/sms?limit=5` — heure locale clinique `DD/MM HH:mm` (via `clinicTime`, jamais `toLocaleString` navigateur), label type FR, badge statut (couleur+texte SENT/FAILED/PENDING), lien « Historique complet » vers `/admin/sms` ; (b) compositeur rapide réutilisant `POST /api/admin/sms/single` : select patient peuplé depuis la semaine chargée (Tâche 3, prop — pas de `search` supplémentaire sauf si >50 patients, alors fallback `search?q=`), textarea 480 car avec compteur live (`280/480`, `maxLength=480`, `aria-describedby`), CSRF same-origin implicite via fetch même origine, erreurs inline `role="alert"`, succès `role="status"` + refresh pulse. Jamais de `body`/tél dans les logs client.

**Critères d'acceptation :**
- [ ] 5 derniers messages affichés avec date `DD/MM HH:mm` clinique correcte quel que soit le tz navigateur (test avec tz mocké).
- [ ] Compteur 480 bloquant, message succès/erreur FR, double-submit désactivé pendant envoi.
- [ ] Patient issu de la liste semaine ; si aucun patient, select désactivé avec message explicite.

**Vérification :**
- [ ] Tests passent : `npm test -- src/components/admin/SmsPulse`
- [ ] Typecheck : `npm run typecheck`
- [ ] Manuel : envoi réel vers patient test, vérif historique.

**Dépendances :** Tâche 3 (liste patients semaine en prop).

**Fichiers susceptibles d'être touchés :**
- `src/components/admin/SmsPulsePanel.tsx` (nouveau)
- `src/components/admin/SmsComposer.tsx` (nouveau, ou fusionné dans le panneau si <200 lignes)
- `src/components/admin/SmsPulsePanel.test.tsx` (nouveau)
- `src/app/admin/(dashboard)/page.tsx` (montage + passage prop)

**Portée estimée :** Medium (≤4 fichiers)

#### Tâche 6 : Assemblage bento + motion CSS + squelettes/a11y + intégration `page.tsx` — [Moyen]
**Description :** Recompose `page.tsx` (serveur, garde le fetch KPI existant + `computeKpis`/`getClinicWeekRange`) en bento 12-col : hero briefing pleine largeur (avec anneau progression), `KpiCards` existant (inchangé ou wrapper), semaine (2/3) + colonne latérale file d'appels / SMS (1/3), responsive `grid-cols-1 md:2 lg:12`. Feuille `dashboard.css` (ou classes Tailwind + `<style>` module) : keyframes `fade-up` 300–450ms avec `animation-delay` stagger (`--i * 60ms`), `hover lift`, `skeleton shimmer` (désactivé sous `prefers-reduced-motion`), tokens `MASTER.md` (`--color-primary` etc., radius 12–16px, `shadow-md/lg`). États vides/erreur FR uniformes, `aria-label`s, `focus-visible:ring-teal-600`, `aria-busy`/`role=status|alert` sur chaque widget. Vendredi : bannière « fermé » + semaine précédente (logique existante conservée).

**Critères d'acceptation :**
- [ ] Layout 375/768/1024/1440 sans scroll horizontal ni contenu sous navbar ; grille bento conforme `pages/dashboard.md` (12-col, dense).
- [ ] Stagger visible au chargement, nul sous `prefers-reduced-motion` ; aucun emoji en icône (SVG Lucide/Heroicons) ; aucun dégradé violet ; contrastes ≥4,5:1.
- [ ] `page.tsx` reste server component ; widgets en `dynamic`/`Suspense` paresseux ; 1 seul fetch range + previews limitées.

**Vérification :**
- [ ] `npm run typecheck`, `npm test`, `npm run build` tous verts
- [ ] Manuel clavier seul (Tab/Shift+Tab/Entrée) : tout atteignable, focus visible
- [ ] Lighthouse/a11y spot-check + DevTools network : 1 range + 1 pending + 1 sms + kpis serveur.

**Dépendances :** Tâches 2–5.

**Fichiers susceptibles d'être touchés :**
- `src/app/admin/(dashboard)/page.tsx` (recomposition)
- `src/app/admin/(dashboard)/dashboard.css` (nouveau, motion + bento + squelettes)
- `src/components/admin/DashboardSkeletons.tsx` (nouveau, partagé)
- `src/components/admin/KpiCards.tsx` (lecture seule sauf wrapper mineur)

**Portée estimée :** Medium (≤4 fichiers)

### Checkpoint : Final
- [ ] `npm run typecheck` OK
- [ ] `npm test` OK
- [ ] `npm run build` OK
- [ ] Revue humaine avant merge

## Risques et atténuations
| Risque | Impact | Atténuation |
|---|---|---|
| Dérive de conventions (auth/audit/rate-limit) sur le nouveau range | Élevé — faille sécu/audit | Copier-coller strict depuis `appointments/route.ts` + checklist ordre `requireStaff→rate→Zod→DB→audit` ; test audit sans PII. |
| Dates hors `clinicTime.ts` (tz navigateur) | Élevé — créneaux décalés | Interdire `toLocaleString` sans `timeZone: CLINIC_TIMEZONE` en review ; tests avec `TZ=Pacific/Auckland` pour SMS/semaine. |
| N+1 réseau (6× jour + pending + sms) | Moyen — 429 + lenteur | 1 seul range + slices client 5–20 ; filtre jour côté client ; abort sur unmount/démontage filtres. |
| Vendredi fermé mal géré (semaine vide, compteurs 0) | Moyen — confusion dentiste | Conserver `getClinicWeekRange` existante + bannière fermé explicite ; test vendredi. |
| `AppointmentActions` re-fetch en cascade | Moyen — boucles/spinners | `onUpdated` unique remonté au parent semaine ; pas de refetch file+semaine croisés sauf succès action locale. |
| Motion générique « grille IA » | Faible — UX fade | Bento asymétrique + hero pulse + timeline aujourd'hui + stagger CSS ; revue visuelle 4 breakpoints. |
| Corps SMS / PII dans logs/audit | Élevé — RGPD | Audit `{patientId,type,status}` + compteurs ; réponse single sans écho `body` (déjà ainsi) ; jamais de `console.log(body)`. |

## Questions ouvertes
- Tri intra-jour : chrono strict `startTime asc` (recommandé) vs « PENDING expirant d'abord » — trancher avec le dentiste avant Tâche 3.
- Source patients du compositeur SMS : semaine chargée suffit-elle, ou faut-il `search?q=` dès >50 patients ? (prévoir fallback, Tâche 5).
- Anneau progression hero : `confirmés / total jour` vs `terminés / total semaine` ? Proposé : jour (actionnable le matin).
