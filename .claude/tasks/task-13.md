# Tâche 13 — Dossiers patients + détection de doublons
**Statut** : en cours
**Dépend de** : Tâche 12 (auth/RBAC, `requireStaff`, shell admin) — **terminée**. Rien d'autre.

## Objectif
Livrer le CRUD patient du dashboard : liste + recherche, fiche patient, édition,
historique unifié (rendez-vous `COMPLETED` UNION lignes `Visit`), ajout de visite
manuelle, détection de doublons (téléphone E.164 **ou** nom) avec acquittement en
ligne, suppression douce (`active=false`) et anonymisation ADMIN pour les demandes
d'effacement. Six routes `/api/admin/patients*` et deux écrans FR.

## Exigences ajoutées par l'utilisateur
1. **Chaque étape doit être testable et committable seule.** L'utilisateur teste et
   commite manuellement après chaque étape. Une étape qui ne produit rien de
   vérifiable (navigateur ou commande) est mal découpée.
2. **Dette critique à traiter dans cette tâche** : `tests/authz-matrix.test.ts` ne sait
   pas tester une route **dynamique**. L'étape 2 y est consacrée, **avant** la première
   route `[id]`. Interdiction formelle d'assouplir le filtre de scan de ce fichier
   pour faire taire un test (voir §Risques).
3. `« (3c schema) »` dans la description de la tâche **n'est pas une dépendance** :
   il n'existe aucune Tâche 3c dans `todo.md` (seulement 3a et 3b). C'est une
   convention d'écriture reprise par les Tâches 10, 11 et 12, qui ont toutes créé
   leur modèle dans leur propre périmètre. **Le modèle `Visit` est créé ici, étape 1.**

### Arbitrages rendus par l'utilisateur le 2026-08-28 — ils priment sur le plan initial

4. **L'anonymisation DOIT aussi effacer les identifiants dans `SmsMessage`.**
   Décision explicite de l'utilisateur. Ce point **sort du Hors périmètre** et
   **entre dans l'étape 6**. Règle : `anonymizePatient()` doit, dans la **même
   transaction** que l'effacement de la fiche, neutraliser les lignes `SmsMessage`
   rattachées au patient — `to` (E.164) et `body` (contient souvent le nom).
   - **Neutraliser, pas supprimer.** On garde la ligne pour que les statistiques
     d'envoi restent justes, exactement comme on garde la coquille du rendez-vous.
     Remplacer le contenu par une valeur inerte (ex. `to: ""`, `body: ""`) et
     conserver `status`, `provider`, `sentAt`, `channel`.
   - **Ne pas toucher à `AuditLog`.** Le journal est append-only (`CLAUDE.md`) et
     constitue la preuve que l'effacement a bien eu lieu. Les `detail` audités ne
     contiennent que des ids et des énumérations, aucune donnée patient — vérifié
     par `ortho-security` le 2026-08-28.
   - Un test doit prouver qu'après anonymisation, **aucune ligne `SmsMessage` du
     patient ne contient plus son numéro ni son nom**.
   - L'action reste auditée `PATIENT_ANONYMIZED`, avec le nombre de lignes
     neutralisées dans `detail` (un compteur, jamais un contenu).
5. **Rapprochement de noms — solution retenue : normalisation, sans flou.**
   Avant comparaison, normaliser les deux côtés : minuscules, suppression des
   accents/diacritiques, espaces multiples réduits, espaces de début/fin retirés.
   Cela rapproche `Bénali` / `benali` / `  BENALI  `. Le rapprochement réellement
   flou (`Mohamed` / `Mohammed`) reste **hors périmètre** — c'est un chantier à part.
   Normalisation en **TypeScript pur** (`String.prototype.normalize("NFD")` +
   retrait des marques diacritiques), **sans** extension PostgreSQL (`unaccent`,
   `pg_trgm`) : pas de dépendance nouvelle à installer en base.
6. **`GET /api/admin/patients` (liste/recherche) DOIT être journalisé.**
   Renverse la décision 4 du §Contexte technique. Une recherche par nom est une
   lecture de données patient. Journaliser `PATIENT_RECORD_VIEWED` avec
   `detail: { scope: "list", resultCount }`.
   **Interdiction absolue d'enregistrer la chaîne de recherche `q`** : elle
   contient un nom de patient, et `CLAUDE.md` interdit toute donnée patient dans
   un log. Un test doit prouver que `q` n'apparaît jamais dans `AuditLog`.
7. **Les deux angles morts du garde-fou sont rapatriés dans l'étape 2.**
   Puisque l'étape 2 ouvre déjà `tests/authz-matrix.test.ts`, y traiter aussi :
   - le scan ne détecte que `route.ts` → doit aussi couvrir `route.tsx`, `route.js`,
     `route.jsx` (`pageExtensions` n'est pas restreint dans `next.config.ts`, donc
     un `route.tsx` serait une route admin réellement servie mais invisible) ;
   - `OPTIONS` est absent de `HTTP_METHODS` → l'ajouter.
   Ces deux ajouts **élargissent** la détection. Ils ne contredisent pas
   l'interdiction d'assouplir le filtre : tout changement qui **réduirait** la
   détection reste formellement interdit.

## Contexte technique découvert

### État du dépôt au 2026-08-28
- PostgreSQL 17 local opérationnel (base `orthocare_test`). `npm test` → **349/349**
  vert, `npm run typecheck` et `npm run lint` verts. Exiger un test à chaque étape est
  réaliste — ce n'était pas le cas avant aujourd'hui.
- Dernière migration : `20260826135333_add_self_service_tokens`. Aucune dérive connue
  entre `prisma/schema.prisma` et `prisma/migrations/`.

### Ce qui existe déjà et qu'il ne faut PAS réécrire
| Besoin | Helper existant | Chemin |
|---|---|---|
| Accès base | `getPrisma()` (lazy, seul point d'accès autorisé) | `src/lib/db.ts` |
| Réponses API | `ok(data, init)` / `errorResponse(status, code, message, headers)` | `src/lib/api/http.ts` |
| Garde staff + RBAC | `requireStaff(request, { roles: ["ADMIN"] })`, `withRefreshedSession(res, guard)`, `assertSameOriginStrict(request)`, `getStaffFromCookies()` (RSC) | `src/lib/auth/guard.ts` |
| Audit | `logAction(actor, action, entityType, entityId, detail?, ipAddress?)` | `src/lib/audit/logAction.ts` |
| Normalisation téléphone DZ → E.164 | `normalizePhoneE164(phone): string \| null` — gère `0550…`, `+213 550…`, `00213…`, `213…`, chiffres arabo-indiens et persans, mobiles 5/6/7 et fixes 2/3/4 | `src/lib/phone/normalize.ts` |
| IP client (jamais `x-forwarded-for` brut) | `getClientIp(request.headers)` | `src/lib/security/clientIp.ts` |
| Champ JSON par locale | `localized(field, locale, fallback="fr")` | `src/lib/i18n/localized.ts` |
| Rapprochement patient par `phoneE164` | logique de référence dans `upsertPatient()` | `src/lib/booking/createBooking.ts:123-165` |

### Route de référence — à calquer
`src/app/api/admin/audit/route.ts` est **le modèle** pour toute route de cette tâche :
`requireStaff` en toute première instruction → parsing Zod des `searchParams` →
`Prisma.<Model>WhereInput` construit par spread conditionnel → `count` + `findMany`
en `Promise.all` → tri secondaire `[{ createdAt: "desc" }, { id: "desc" }]` (deux
lignes créées dans la même milliseconde doivent avoir un ordre déterministe) →
`logAction(...)` → `withRefreshedSession(ok({...}), guard)` avec une **liste blanche
de champs explicite** dans le `.map()` final.

### Modèle de données existant
- `Patient` (`prisma/schema.prisma:54`) contient **déjà** tout ce dont la tâche a
  besoin : `firstName`, `lastName`, `phone` (tel que saisi), `phoneE164` (indexé,
  non-unique), `email?`, `birthDate?`, `notes?`, `consentAt?`, `consentVersion?`,
  `messagingOptOut`, `preferredLocale`, `whatsappOptIn`, `anonymizedAt?`, `active`,
  `createdById?`/`createdBy`, `updatedById?`/`updatedBy`, timestamps,
  `@@index([phoneE164])`. **Aucune migration n'est nécessaire sur `Patient`.**
- `Appointment` a `status` (`AppointmentStatus.COMPLETED`), `startTime`/`endTime` UTC,
  `completedAt`, `visitNotes`, `serviceId`.
- `enum AuditAction` (`prisma/schema.prisma:398`) contient déjà `PATIENT_CREATED`,
  `PATIENT_UPDATED`, `PATIENT_ANONYMIZED`, `PATIENT_RECORD_VIEWED`. Il **manque** une
  action pour la création de visite → ajoutée à l'étape 1.
- **`model Visit` n'existe pas** → étape 1.

### Conventions du dashboard admin (héritées de la Tâche 12) — vérifiées dans le code
- **Dashboard FR uniquement.** Confirmé par `tasks/plan.md` (« Admin dashboard
  language: FR only »), par `src/app/admin/layout.tsx` (`<html lang="fr" dir="ltr">`)
  et par `src/components/admin/Sidebar.tsx` (libellés FR en dur, pas de `next-intl`).
  **Le critère « fr/ar/en + RTL » de la Definition of Done ne s'applique donc PAS aux
  écrans de cette tâche** — mais il reste vrai qu'un patient peut s'appeler en
  caractères arabes : tout champ affichant un **nom, une note ou un traitement saisi
  par le personnel** doit porter `dir="auto"` pour ne pas casser le rendu.
- Pages sous `src/app/admin/(dashboard)/` : le layout appelle `getStaffFromCookies()`,
  redirige vers `/admin/login` si absent et vers `/admin/change-password` si
  `mustChangePassword`. Les pages ADMIN-only re-vérifient le rôle côté serveur
  (`src/app/admin/(dashboard)/audit/page.tsx`) **et** l'API le vérifie indépendamment.
- Composants client dans `src/components/admin/`, PascalCase, `"use client"`,
  `fetch` relatif vers `/api/admin/...`, états `loading` / `error` explicites
  (voir `src/components/admin/AuditViewer.tsx`).
- Navigation : ajouter l'entrée patients dans `NAV_ITEMS` de `Sidebar.tsx`
  (`adminOnly: false` — les réceptionnistes en ont besoin tous les jours).

### Règles données de santé — s'appliquent à TOUTES les étapes 1 à 8
- **Aucune donnée patient dans un log, un message d'erreur ou une URL.** Le `detail`
  JSON de `logAction()` est lu par l'écran d'audit : il ne contient que des **ids et
  des noms de champs**, jamais de valeurs (`{ changedFields: ["phone","notes"] }`,
  **jamais** `{ phone: "+213550…" }`).
- Chaque route renvoie le **minimum** de champs (liste blanche explicite dans le
  `.map()` / le `select`, jamais `...patient`).
- Toute route ajoutée exige **une ligne dans `tests/authz-matrix.test.ts`**
  (Definition of Done, `tasks/todo.md:11`).
- `getClientIp(request.headers)` est passé en 6ᵉ argument de `logAction` sur toutes
  les écritures et sur `PATIENT_RECORD_VIEWED`.
- Les non-GET des routes admin appellent `assertSameOriginStrict(request)` et
  renvoient 403 `CSRF_ORIGIN_MISMATCH` si faux.

### Décisions d'architecture prises par ce plan (à ne pas re-débattre)
1. **Enveloppe des doublons** : quand des candidats existent et que
   `duplicateAcknowledged !== true`, la route renvoie **409** avec le corps
   `{ error: { code: "DUPLICATE_CANDIDATES", message }, duplicates: [...] }`.
   L'enveloppe `{ error: { code, message } }` est préservée ; `duplicates` est une clé
   additive de premier niveau. `errorResponse()` n'est **pas** modifié (helper partagé
   par tout le projet) : la route construit ce cas avec `Response.json(..., { status: 409 })`.
2. **Ordre d'exécution obligatoire dans chaque handler** :
   `requireStaff` → (CSRF) → validation Zod → lecture DB / 404.
   Un 404 ou un 400 ne doit **jamais** précéder le 401/403, sinon la matrice
   d'autorisation ne prouve plus rien et l'existence d'un patient fuit à un anonyme.
3. **Rôles** : `RECEPTIONIST` peut lire, créer, modifier un patient et ajouter une
   visite. **`ADMIN` seul** peut désactiver (`active:false`) et anonymiser.
4. **Audit des lectures** : `GET /api/admin/patients/[id]` et
   `GET /api/admin/patients/[id]/history` journalisent chacun `PATIENT_RECORD_VIEWED`
   avec `detail: { scope: "record" }` / `{ scope: "history" }`. Deux lignes par
   ouverture de fiche est le prix assumé : pour des données de santé, sur-journaliser
   vaut mieux que sous-journaliser. **`GET /api/admin/patients` (liste) ne journalise
   pas** — voir §Risques, point à confirmer par `ortho-security`.

## Étapes

### Étape 1 — Modèle `Visit` + action d'audit `VISIT_CREATED` (schéma)
- [x] Statut : fait (2026-08-28, `ortho-db`) — schéma + migration appliquée en **local** uniquement
- **But** : poser en base l'historique manuel et l'action d'audit qui lui manque, avant
  toute ligne de code applicatif.
- **Agents recommandés** : `ortho-db`, puis `ortho-tester`.
- **Fichiers à créer / modifier** :
  - `prisma/schema.prisma`
  - `prisma/migrations/<timestamp>_add_visit/migration.sql` (généré par `npm run db:migrate`)
  - `tests/schema.test.ts` (ajout de cas)
  - `tasks/plan.md` (§Domain / Data Model, ligne ~149)
- **Ce qu'il faut faire** :
  1. Ajouter `model Visit` conforme à `tasks/plan.md:149` :
     `id String @id @default(cuid())`, `patientId String` + relation `patient Patient`,
     `date DateTime` (**UTC**, comme tous les horodatages du projet),
     `serviceId String?` + relation `service Service?`, `type String`,
     `notes String?`, `treatment String?`, `createdById String?` + relation
     `createdBy User?` (attribution de l'action staff), `createdAt`/`updatedAt`,
     `@@index([patientId, date])`.
  2. Ajouter les relations inverses : `visits Visit[]` sur `Patient` et `Service`,
     `visitsCreated Visit[]` sur `User`.
  3. Ajouter un commentaire d'en-tête au modèle expliquant le **pourquoi** (densité du
     reste du fichier) : « historique = rendez-vous `COMPLETED` UNION `Visit` ; les
     visites couvrent les soins antérieurs au système et les patients sans rendez-vous
     — plan.md §Domain / Data Model ».
  4. Ajouter `VISIT_CREATED` à `enum AuditAction` (aucune action existante ne couvre
     l'ajout d'une visite manuelle ; réutiliser `PATIENT_UPDATED` rendrait le journal
     illisible).
  5. Générer la migration : `npm run db:migrate` (nom `add_visit`). Relire le SQL
     produit : il ne doit contenir que des `CREATE TABLE` / `CREATE INDEX` /
     `ALTER TYPE ... ADD VALUE` — **aucun `DROP`**.
  6. Mettre à jour `tasks/plan.md` : entrée `Visit` marquée comme livrée en Tâche 13
     (avec `createdById`, qui n'était pas dans la liste d'origine) et `VISIT_CREATED`
     ajoutée à la liste des « Change actions ».
- **Critères d'acceptation** :
  - `npm run db:migrate` s'applique sans erreur ; `npx prisma migrate status` ne
    signale aucune dérive.
  - `npm run typecheck` vert : `getPrisma().visit` et `AuditAction.VISIT_CREATED` sont
    typés depuis `@/generated/prisma/client`.
  - `npm test -- schema` vert, avec un cas qui crée un `Patient`, puis un `Visit`
    rattaché, et vérifie que `patient.visits` le retourne.
  - Un `Visit` dont le `patientId` n'existe pas est rejeté par la contrainte de clé
    étrangère (test explicite).
  - `npm test` reste à 349 tests minimum, tous verts.
- **Vigilance sécurité** : **oui — données patient**. `Visit.notes` et `Visit.treatment`
  sont des notes cliniques en texte libre : confidentielles au même titre que
  `Appointment.visitNotes`. Aucune donnée réelle en base de dev/test (données
  synthétiques uniquement). Ne jamais afficher `DATABASE_URL`, y compris dans une
  sortie d'erreur Prisma recopiée dans le Journal.
- **Journal** :
  - **2026-08-28 — `ortho-db`. Étape 1 terminée. VERT.**
  - **Schéma** (`prisma/schema.prisma`, +55 lignes, 0 suppression) :
    - `model Visit` inséré **juste après `Appointment`** (les modèles cliniques
      restent groupés, avant la bannière « Task 3b: Content Schema »). Champs :
      `id`, `patientId`+`patient`, `date` (UTC), `serviceId?`+`service?`, `type`
      (String), `notes?`, `treatment?`, `createdById?`+`createdBy?`, `createdAt`,
      `updatedAt`, `@@index([patientId, date])`. Conforme à `plan.md:149`.
    - Commentaire d'en-tête (densité du reste du fichier) : historique =
      rendez-vous `COMPLETED` UNION `Visit`, mention explicite **PATIENT HEALTH
      DATA** pour `notes`/`treatment`, et les 3 comportements de suppression.
    - Relations inverses ajoutées : `visits Visit[]` sur `Patient` et `Service`,
      `visitsCreated Visit[]` sur `User`. **Aucun autre modèle modifié.**
    - `VISIT_CREATED` ajouté à `enum AuditAction` (après `PATIENT_ANONYMIZED`).
      Disponible pour l'étape 5 : `AuditAction.VISIT_CREATED`.
  - **Migration** : `prisma/migrations/20260828152745_add_visit/migration.sql`.
    **100 % additive** — `ALTER TYPE "AuditAction" ADD VALUE 'VISIT_CREATED'`,
    `CREATE TABLE "Visit"`, `CREATE INDEX "Visit_patientId_date_idx"`, 3
    `ADD CONSTRAINT ... FOREIGN KEY`. **Aucun `DROP`, aucun `TRUNCATE`, aucun
    `DELETE`** (relu ligne à ligne ; les seules occurrences du mot « DELETE »
    sont les clauses `ON DELETE` des FK).
  - **Cascades** (défauts Prisma, assumés et documentés dans le schéma) :
    `Visit.patient` requis → `ON DELETE RESTRICT` (un patient avec historique ne
    peut pas être supprimé en dur ; l'effacement passe par `anonymizedAt`) ;
    `Visit.service` et `Visit.createdBy` optionnels → `ON DELETE SET NULL`
    (perdre le service ou l'auteur ne doit jamais détruire la visite).
  - **Cible base** : `DATABASE_URL` forcé sur `TEST_DATABASE_URL` (localhost,
    `orthocare_test`) avant **chaque** commande Prisma, avec contrôle
    `case ... *localhost*` préalable. `prisma.config.ts` fait `import
    "dotenv/config"` : dotenv **n'écrase pas** une variable déjà exportée, donc
    l'override tient. **La base Neon partagée n'a jamais été touchée** — rien
    n'a été appliqué dessus, `npm run db:deploy` reste à faire par l'utilisateur.
    Aucun secret affiché.
  - **Vérifications** : `npx prisma migrate status` → « 7 migrations found /
    Database schema is up to date! », aucune dérive. `npx prisma generate` OK.
    `npm run typecheck` OK. `npm run lint` OK. `npm test` → **351/351 verts**
    (349 avant + 2 nouveaux), 37 fichiers.
  - **Tests ajoutés** (`tests/schema.test.ts`, +114 lignes, 2 cas) :
    1. création `Patient` → `Visit` rattachée (avec service + auteur), lecture via
       `patient.visits`, création d'une seconde visite **sans** `serviceId` ni
       `createdById` (preuve de l'optionnalité), et écriture d'une ligne
       `AuditLog` `VISIT_CREATED` avec un `detail` réduit à `{ patientId, type }` ;
    2. `Visit` avec `patientId` inexistant → rejetée par la FK.
  - **⚠️ Point pour les étapes suivantes — `tests/setup.ts` ne nomme PAS `"Visit"`
    dans son `TRUNCATE`, et c'est SANS conséquence** : le `TRUNCATE ... CASCADE`
    de `"Patient"` atteint `"Visit"` par sa clé étrangère. C'est **prouvé** par une
    assertion `expect(await prisma.visit.count()).toBe(0)` au début du 2ᵉ test,
    qui s'exécute après un test ayant laissé 2 lignes. **Ne pas modifier
    `tests/setup.ts`** (interdit par `CLAUDE.md`) : ce n'est pas nécessaire.
  - **`tasks/plan.md` mis à jour** (2 lignes) : entrée `Visit` marquée
    *(delivered in Task 13)* avec `createdById`, l'index, la nature UTC de `date`
    et la confidentialité de `notes`/`treatment` ; `VISIT_CREATED` ajouté à la
    liste des « Change actions ».
  - **Déviations par rapport au plan de l'étape : aucune.** Ajouts non demandés
    mais jugés nécessaires et signalés : `updatedAt` (imposé par `@updatedAt`,
    déjà prévu au point 1), et le cas de test « visite sans service ni auteur ».
  - **« Task 3c » : rien trouvé.** `grep` sur `tasks/todo.md` ne renvoie que la
    formule `« (3c schema) »` dans les descriptions des Tâches 7, 8, 12, 13 et 15 ;
    `tasks/plan.md:429-433` la décrit comme une **tranche de schéma**, pas une
    tâche. Confirmation du §Exigences point 3 : aucune dépendance manquante.
  - **Rien d'applicatif n'a été écrit** : ni route, ni composant, ni schéma Zod,
    ni service. `PatientDocument` non créé (Tâche 15). Aucune case cochée dans
    `tasks/todo.md`. Aucune commande git d'écriture.
  - **À faire par l'utilisateur** : tester/committer, puis, quand il le décidera,
    `npm run db:deploy` sur la base partagée (migration additive, sans
    verrouillage long : `CREATE TABLE` + `ADD VALUE` sur l'enum).
  - **2026-08-28 — `ortho-tester`. Vérification de l'étape 1. VERT.**
    - **Cible base confirmée locale** avant toute commande (`TEST_DATABASE_URL`,
      contrôle `*localhost*`). Aucun secret affiché.
    - `npx prisma migrate status` → « 7 migrations found / Database schema is up
      to date! », aucune dérive — confirmé indépendamment.
    - Les 5 critères d'acceptation de l'étape 1, un par un :
      1. `db:migrate` sans erreur / pas de dérive → **prouvé** (`migrate status`
         ci-dessus, relancé par moi).
      2. `typecheck` vert, `getPrisma().visit` et `AuditAction.VISIT_CREATED`
         typés → **prouvé** (`npm run typecheck` → OK, aucune erreur ; le fichier
         de test utilise ces deux symboles sans `any` ni cast).
      3. Cas `Patient` → `Visit` relue via `patient.visits` → **prouvé** par le
         test existant (`tests/schema.test.ts:244`, `withVisits?.visits`).
      4. `Visit.patientId` inexistant rejeté par la FK → **prouvé** par le test
         existant (`tests/schema.test.ts:343`).
      5. `npm test` ≥ 349, tout vert → **prouvé**, 352/352 (351 + 1 test que
         j'ai ajouté), 37 fichiers.
    - **Vérification indépendante du point le plus fragile — `TRUNCATE` sans
      `"Visit"` nommé, cascade via FK vers `"Patient"`.** Confirmée à deux
      niveaux : (a) le test `tests/schema.test.ts:343` prouve déjà que le
      compteur `Visit` est à 0 au début du test suivant, après qu'un test
      précédent a laissé 2 lignes — ce n'est valide que parce que
      `vitest.config.ts` a `fileParallelism: false` (exécution strictement
      séquentielle sur une base partagée) et que `setupFiles` applique le même
      `beforeEach` à **chaque** test, ce que j'ai vérifié en lisant
      `vitest.config.ts`. (b) Reproduction manuelle indépendante en SQL brut,
      hors suite de tests : `INSERT` un `Patient` + un `Visit` le référençant,
      puis rejeu exact de la commande `TRUNCATE TABLE "RateLimitCounter",
      "User", "Patient", ... RESTART IDENTITY CASCADE;` de `tests/setup.ts`.
      Résultat : `NOTICE: truncate cascades to table "Visit"` émis par
      PostgreSQL lui-même, et `SELECT count(*) FROM "Visit"` → 0 après coup.
      **L'affirmation d'`ortho-db` est donc vraie, vérifiée à la fois par le
      test automatisé et par une commande SQL indépendante — pas seulement
      relue.** `tests/setup.ts` n'a pas été modifié (interdit) et n'a pas
      besoin de l'être.
    - **UTC** : `Visit.date` est `timestamp(3) without time zone` en base
      (confirmé par `\d "Visit"`), exactement le même type que
      `Appointment.startTime`/`endTime`/`completedAt` — cohérent avec la
      convention du reste du schéma (UTC appliqué par convention applicative,
      pas par le type de colonne). Le test existant compare
      `visit.date.toISOString()` à la valeur UTC insérée : tout décalage de
      fuseau aurait fait échouer cette comparaison. Considéré comme prouvé,
      aucun test supplémentaire nécessaire.
    - **`ON DELETE RESTRICT` sur `Visit.patient`** : vérifié indépendamment en
      SQL brut (`DELETE FROM "Patient" WHERE id = ...` sur un patient ayant une
      `Visit` → `ERROR: update or delete on table "Patient" violates foreign
      key constraint "Visit_patientId_fkey"`, dans une transaction annulée
      ensuite par `ROLLBACK`, sans effet sur la base). Ce comportement n'était
      **pas prouvé par un test automatisé** — seulement documenté en
      commentaire d'en-tête du schéma — alors que c'est un des points de
      vigilance explicitement demandés. **Test ajouté** (seul changement de
      code que j'ai fait) : `tests/schema.test.ts`, cas « refuses to
      hard-delete a Patient that has a Visit (ON DELETE RESTRICT, Task 13) » —
      crée un `Patient` + une `Visit`, tente `prisma.patient.delete(...)`,
      vérifie le rejet et que le patient existe toujours. +28 lignes,
      0 suppression.
    - **Aucun autre test ajouté** : les autres critères étaient déjà prouvés
      par le travail d'`ortho-db`, conformément à la consigne « pas de
      sur-couverture ».
    - `npm test` → **352/352 vert** (37 fichiers), `npm run typecheck` → OK,
      `npm run lint` → OK.
    - **Rien d'autre modifié** : `prisma/schema.prisma`, la migration,
      `tests/setup.ts` et `tasks/plan.md` sont restés tels que livrés par
      `ortho-db`. Aucune case cochée dans `tasks/todo.md`. Aucune commande git
      d'écriture.
  - **2026-08-28 — `ortho-security`. Audit de l'étape 1. VERT** — aucun constat
    CRITIQUE ni BLOQUANT. 2 MAJEUR **portés en dette**, 3 MINEUR. Diff couvert :
    `prisma/schema.prisma`, `prisma/migrations/20260828152745_add_visit/migration.sql`,
    `tests/schema.test.ts`, `tasks/plan.md`. (`.gitignore` et `next.config.ts` sont
    antérieurs et hors périmètre — vérifiés inoffensifs : `.env*` reste ignoré,
    `agentRules: false` ne touche ni CSP ni `NO_REFERRER_HEADERS`.)
  - **Conforme, vérifié ligne à ligne** : migration 100 % additive (aucun `DROP`/
    `TRUNCATE`/`DELETE` hors clauses `ON DELETE`) ; `Visit` non exposée par une
    route (aucune n'existe) ; aucun `$queryRawUnsafe`/`$executeRawUnsafe` ajouté
    (seule occurrence du dépôt : `tests/setup.ts:32`, chaîne statique) ;
    `RESTRICT` sur `Visit.patient` **ne gêne pas** le droit à l'oubli (l'effacement
    est un `UPDATE`, pas un `DELETE`) et n'ajoute aucune contrainte nouvelle —
    `Appointment.patientId` imposait déjà `RESTRICT` ; `AuditAction` reste
    filtrable dynamiquement (`Object.values(AuditAction)`,
    `src/app/api/admin/audit/route.ts:17`) et `AuditViewer.tsx:159` rend `action`
    en texte brut → **aucune casse sur la nouvelle valeur d'enum** ; couverture
    `TRUNCATE ... CASCADE` de `Visit` re-prouvée indépendamment en SQL
    (`pg_constraint` : `Visit` → `Patient`/`Service`/`User`, toutes nommées).
    Dépendances inchangées → `npm audit` sans objet.

  - **⚠️ À traiter dans les étapes suivantes — reprendre ces points :**
    1. **[MAJEUR — étape 5, dette]** `prisma/schema.prisma:220-221` affirme que
       « l'`AuditLog` (`VISIT_CREATED`) reste la trace faisant foi » si
       `createdById` est nullifié. **C'est faux en l'état** :
       `AuditLog.userId` est lui aussi `ON DELETE SET NULL`
       (`prisma/migrations/20260826135333_add_self_service_tokens/migration.sql:54`).
       Une suppression dure d'un `User` effacerait l'attribution **des deux côtés
       simultanément**. Aucun chemin de suppression dure de `User` n'existe
       aujourd'hui en production (`prisma.user.delete` n'apparaît que dans
       `src/lib/auth/guard.test.ts:111`) → risque **latent**, pas actif.
       **À faire** : ne jamais introduire de suppression dure de `User`
       (la Tâche 19 doit désactiver, pas supprimer) ; corriger le commentaire du
       schéma ; si la garantie d'attribution doit être dure, passer
       `AuditLog.userId` en `RESTRICT` — **hors périmètre de la Tâche 13**,
       ticket à part.
    2. **[MAJEUR — étape 6, dette]** `Visit.type` (`prisma/schema.prisma:214`) est
       un `TEXT` **sans contrainte en base**, et l'étape 6 le **conserve
       délibérément** à l'anonymisation. Si un jour `type` est écrit hors
       `visitCreateSchema`, du texte libre (donc potentiellement identifiant)
       survivrait à une demande d'effacement. **À faire** : (a) `visitCreateSchema`
       reste **l'unique** chemin d'écriture de `type` ; (b) ajouter à
       `tests/integration/patient-anonymize.test.ts` une assertion que le `type`
       conservé après anonymisation appartient bien aux 5 valeurs autorisées.
       Même remarque de fond pour `notes`/`treatment` : bornés à 5000 par Zod
       (étape 3), non bornés en base.
    3. **[MINEUR — étape 5]** L'invariant « pas de note clinique dans un `detail`
       d'audit » n'est porté que par un commentaire :
       `AuditDetail = Record<string, unknown>` (`src/lib/audit/logAction.ts:25`)
       n'interdit rien, et `/api/admin/audit` renvoie `detail` **verbatim**
       (`src/app/api/admin/audit/route.ts:93`). **À faire à l'étape 5** : un test
       qui, après `POST /[id]/visits` avec des `notes`/`treatment` marqueurs,
       assert que `JSON.stringify(auditLog.detail)` ne contient **ni** l'un **ni**
       l'autre. Le `detail: { patientId, type }` déjà prévu est conforme.
    4. **[MINEUR — Tâches 13 & 15]** La preuve que `Visit` est nettoyée entre
       tests repose sur le fait qu'elle a une FK vers une table **nommée** dans le
       `TRUNCATE` de `tests/setup.ts`. **Ce raisonnement se généralise, mais pas
       inconditionnellement** : une future table **sans aucune FK** vers les 15
       tables nommées (ex. un magasin d'idempotence, un journal d'import) ne
       serait **pas** nettoyée, et la pollution serait silencieuse.
       `PatientDocument` (Tâche 15) → FK vers `Patient`, donc couverte.
       **`tests/setup.ts` ne doit pas être modifié** (interdit) — l'alternative
       propre, si l'utilisateur la souhaite, est un **test de couverture** séparé
       qui assert que chaque modèle du DMMF est soit nommé, soit relié par FK.
       Arbitrage utilisateur, pas décision d'agent.
       ⚠️ Corollaire : la preuve actuelle (`tests/schema.test.ts:343`,
       `expect(visit.count()).toBe(0)`) dépend de **l'ordre des tests dans le
       fichier** et de `fileParallelism: false`. Elle est valable aujourd'hui mais
       cesse de prouver quoi que ce soit si les cas sont réordonnés.
    5. **[MINEUR — perf, pas sécurité]** `Visit` n'a d'index que
       `(patientId, date)` et la PK. Suffisant pour **toutes** les requêtes
       prévues (timeline, `count`, `updateMany` d'anonymisation — `patientId` est
       le préfixe). Pas d'index sur `serviceId`/`createdById` : sans conséquence
       tant que `Service` et `User` ne sont que désactivés, jamais supprimés.
       À revoir si une Tâche 18/21 agrège les visites par service. Aucun index
       n'expose quoi que ce soit.
  - **Rappel opérationnel** : la migration n'est appliquée qu'en **local**. Au
    `push`, la CI exécute `migrate deploy` sur la base pointée par son
    `DATABASE_URL` — donc potentiellement Neon, qui contient de vraies données de
    santé. L'opération est additive et sans verrou long, mais elle doit être un
    choix conscient de l'utilisateur.
  - **Aucun fichier de projet modifié par cet audit** (hors ce Journal). Aucun
    secret affiché ; `DATABASE_URL` forcé sur la cible locale, contrôlé
    `*localhost*`, jamais imprimé.

- **2026-08-28 — `ortho-reviewer`. Revue de l'étape 1. VERT.**
  *(Entrée recopiée par l'orchestrateur : l'agent de revue est en lecture seule et
  ne peut pas écrire dans ce fichier.)*
  - Vérifications indépendantes : `npm run typecheck` → OK ; `npm test -- schema`
    → 6/6 verts sur la base locale. Grep croisé des migrations existantes : les
    3 cascades de `Visit` (`RESTRICT` sur `patient`, `SET NULL` sur `service` et
    `createdBy`) suivent exactement le patron implicite déjà appliqué par
    `Appointment`, `Patient` et `SmsMessage`. Aucun `onDelete` explicite nulle part
    dans le schéma — c'est le défaut Prisma partout. Aucune incohérence.
  - `@@index([patientId, date])` jugé suffisant et non superflu pour la timeline de
    l'étape 5 : filtre et tri `DESC` couverts par un seul index ascendant.
  - À savoir pour les étapes suivantes : **`Appointment` n'a aucun index déclaré**,
    pas même sur `patientId`. `Visit` est donc mieux indexée que le modèle qu'elle
    complète. Dette **préexistante**, non introduite ici — à surveiller quand
    l'étape 5 fusionnera les deux sources dans la timeline.
  - `type` en `String` plutôt qu'un enum : **défendable**, précédent direct avec
    `SmsMessage.provider` (`schema.prisma:370`), même logique d'étiquette
    descriptive et non d'état machine. [MINEUR] En revanche la justification écrite
    dans le commentaire (« pas de migration nécessaire pour ajouter une catégorie »)
    est affaiblie par ce diff lui-même, qui prouve qu'ajouter une valeur d'enum est
    une migration additive triviale. La vraie raison à écrire : un enum PostgreSQL
    ne permet pas de **retirer** une valeur obsolète, une chaîne validée par Zod si.
  - [MINEUR] **`CLAUDE.md` §Sensitive zones ne liste pas `Visit`** parmi les modèles
    porteurs de données patient, alors que ce fichier est chargé dans le contexte de
    **chaque** sous-agent. Hors périmètre de cette étape. Pas un angle mort
    opérationnel (l'étape 6 couvre déjà l'effacement de `notes`/`treatment`), mais
    une incohérence documentaire à corriger — signalée à l'utilisateur.
  - Densité du commentaire d'en-tête (19 lignes) jugée adéquate malgré sa longueur :
    chaque paragraphe porte une information distincte, dont la justification des
    trois cascades, documentée nulle part ailleurs.
  - Aucune réutilisation manquée, aucune simplification possible, aucun BLOQUANT.

### Étape 2 — Rendre `tests/authz-matrix.test.ts` capable de tester une route dynamique
- [ ] Statut : à faire
- **But** : étendre le harnais de la matrice d'autorisation **avant** d'écrire la
  première route `/api/admin/patients/[id]`, pour que la surveillance RBAC ne soit
  jamais désarmée « parce que le test coince ».
- **Agents recommandés** : `ortho-security` (**obligatoire**), `ortho-tester`.
- **Fichiers à créer / modifier** : `tests/authz-matrix.test.ts` **uniquement**.
- **Contexte — pourquoi cette étape existe** : un audit `ortho-security` du 2026-08-28
  a établi deux blocages structurels :
  - `RouteRow.handler` est typé `(request: NextRequest) => Promise<Response>` et
    `requestAs()` l'appelle avec **un seul argument**. Or un route handler dynamique
    Next 16 reçoit le contexte en **second argument**, et `params` y est une
    **Promise** (voir « Next.js 16 gotchas » dans `CLAUDE.md`).
  - `row.path` sert **à la fois** de clé de matrice (comparée au scan du système de
    fichiers) et d'URL réellement requêtée. La clé dérivée du scan contient le littéral
    `[id]`, qui n'est pas une URL testable.
- **Ce qu'il faut faire** :
  1. Remplacer `path` par un couple explicite dans `RouteRow` :
     - `scanPath: string` — le chemin littéral tel que le scan du répertoire le produit
       (ex. `/api/admin/patients/[id]`). C'est **lui** qui est comparé à `matrixPairs`
       dans le test de couverture.
     - `requestPath?: string` — l'URL réellement requêtée (ex.
       `/api/admin/patients/does-not-exist`). Défaut : `scanPath`.
     - `params?: Record<string, string>` — les paramètres de route
       (ex. `{ id: "does-not-exist" }`). Défaut : `{}`.
  2. Élargir le type du handler à
     `(request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>`
     et faire appeler par `requestAs()` :
     `row.handler(new NextRequest(url, { method, headers }), { params: Promise.resolve(row.params ?? {}) })`.
     La route `GET /api/admin/audit` (non dynamique) ignore simplement ce second
     argument — sa ligne existante doit continuer à passer sans modification de son
     comportement attendu.
  3. Activer le champ `adminStatus?` **déjà déclaré et inutilisé** : le renommer
     `okStatus?: number` et l'appliquer à **tout acteur autorisé** (pas seulement
     l'admin) —
     `const expected = allowed ? (row.okStatus ?? EXPECTED[kind].ok) : EXPECTED[kind].forbidden;`.
     Nécessaire car un acteur autorisé demandant un id inexistant reçoit 404, et un
     POST sans corps reçoit 400. **C'est une propriété désirable, pas un
     contournement** : elle prouve que la garde s'exécute avant la recherche en base et
     avant le parsing du corps.
  4. Mettre à jour le message d'aide du test de couverture pour citer `scanPath`.
  5. Ajouter deux cas de test dédiés, indépendants de la table :
     - **Non-régression du harnais** : la ligne `GET /api/admin/audit` continue de
       renvoyer 200/401/403 comme avant.
     - **Anti-IDOR / non-divulgation** : un handler dynamique factice (défini dans le
       fichier de test, pas une vraie route) appelé en **anonyme** avec un `params.id`
       arbitraire renvoie 401 **avant** toute lecture en base — vérifier que le corps de
       la réponse ne contient ni l'id demandé ni aucune indication d'existence.
  6. Ajouter un commentaire d'en-tête qui énonce l'interdiction du point suivant, pour
     que le prochain agent qui bute sur ce fichier le lise.
- **Critères d'acceptation** :
  - `npm test -- authz-matrix` vert.
  - Le filtre de scan est **inchangé** : `git diff tests/authz-matrix.test.ts` ne montre
    aucune modification de `entries.filter((e) => e.endsWith("route.ts"))`, du tableau
    `HTTP_METHODS`, ni de l'assertion finale `expect(missing).toEqual([])`.
  - **Preuve que le garde-fou mord encore** : ajouter temporairement un export
    `export async function DELETE() {}` dans `src/app/api/admin/audit/route.ts`,
    relancer `npm test -- authz-matrix`, constater l'échec avec `DELETE /api/admin/audit`
    dans `missing`, puis **retirer l'export**. Consigner l'observation dans le Journal.
  - `npm run typecheck` et `npm run lint` verts.
  - `npm test` complet toujours vert.
- **Vigilance sécurité** : **oui — autorisation / rôles**. C'est l'unique filet
  automatique contre l'accès non autorisé aux données patient. **Interdits absolus** :
  (a) élargir ou assouplir le filtre de scan des fichiers de route ; (b) retirer une
  méthode de `HTTP_METHODS` ; (c) neutraliser `expect(missing).toEqual([])` ;
  (d) toucher `tests/setup.ts`.
  **Deux angles morts connus, à signaler sans les corriger ici** (hors périmètre — ils
  méritent leur propre ticket) : le scan ne voit que `route.ts` et ignorerait un
  `route.tsx` ; `OPTIONS` est absent de `HTTP_METHODS`. Les mentionner dans le Journal.
- **Journal** :
  - **2026-08-28 — `ortho-builder`. Étape 2 terminée. VERT.**
  - **⚠️ Écart assumé par rapport à la phrase « hors périmètre — à signaler sans
    corriger » de la ligne « Vigilance sécurité » ci-dessus** : cette phrase est
    **périmée**. `§Exigences ajoutées par l'utilisateur, point 7` (arbitrage du
    2026-08-28, postérieur à la rédaction de cette fiche) **rapatrie explicitement
    les deux angles morts dans cette étape** et précise que le §Exigences prime en
    cas de divergence. J'ai donc **corrigé les deux angles morts dans ce diff**, en
    plus des 6 actions listées plus haut. Aucun des deux changements ne réduit la
    détection — voir preuve ci-dessous.
  - **Seul fichier modifié : `tests/authz-matrix.test.ts`.** Aucune route réelle
    créée sous `src/`, `tests/setup.ts` non touché, aucune case cochée dans
    `tasks/todo.md`, aucune commande git d'écriture.
  - **Les 6 actions de la fiche, une par une :**
    1. `RouteRow` : `path` remplacé par `scanPath` (clé comparée au scan) +
       `requestPath?` (URL réellement requêtée, défaut `scanPath`) + `params?`
       (défaut `{}`).
    2. `handler` élargi à `(request, { params: Promise<Record<string,string>> })`.
       `requestAs()` appelle désormais `row.handler(new NextRequest(...), {
       params: Promise.resolve(row.params ?? {}) })`. La ligne `GET
       /api/admin/audit` n'a pas eu besoin d'être touchée pour son handler
       (`(r) => auditRoute(r)` reste valide — TS accepte une fonction avec moins
       de paramètres formels que le type de fonction attendu), seul `path` →
       `scanPath` a changé sur cette ligne.
    3. `adminStatus?` (déclaré mais **jamais lu** dans le code d'origine — vérifié
       en le cherchant : aucune occurrence dans la boucle `it()`) renommé
       `okStatus?` et **appliqué** pour tout acteur autorisé :
       `allowed ? (row.okStatus ?? EXPECTED[kind].ok) : EXPECTED[kind].forbidden`.
    4. Message d'aide du test de couverture : « add the new (method, path) pair »
       → « add the new (method, scanPath) pair ».
    5. Deux tests dédiés ajoutés, hors de la boucle table-driven :
       - non-régression : `GET /api/admin/audit` en anonyme/réceptionniste/admin
         → 401/403/200, avec la **nouvelle** signature à 2 arguments.
       - anti-IDOR : `fakeDynamicPatientRoute` — handler **factice, défini dans le
         fichier de test**, non ajouté à `ROUTES` (donc invisible au scan, comme
         demandé) — appelé en anonyme avec `params.id` arbitraire. Preuve : 401
         **avant** toute lecture DB (la ligne `context.params` n'est même jamais
         atteinte côté anonyme, `requireStaff` court-circuite avant), corps de
         réponse ne contenant **ni** l'id demandé (assertion `not.toContain`) **ni**
         aucun indice d'existence — juste `{ error: { code: "UNAUTHENTICATED",
         message: "Session invalide ou expirée." } }`, identique au message
         générique de `requireStaff` pour tout échec d'authentification (ne
         distingue jamais "id inconnu" de "pas de session").
    6. Commentaire d'en-tête ajouté juste après le commentaire Tâche 12 existant :
       énonce les 4 interdits (a-d) et précise que seul l'**élargissement** est
       permis, en pointant vers les ajouts `route.tsx/.js/.jsx` et `OPTIONS`
       ci-dessous comme exemples.
  - **Point 7 du §Exigences (rapatriement des angles morts) :**
    - Scan élargi à `route.ts|tsx|js|jsx`, motif ancré
      `/(^|[\\/])route\.(ts|tsx|js|jsx)$/` remplaçant `endsWith("route.ts")` —
      corrige au passage le faux-positif `myroute.ts` (le nouveau motif exige un
      séparateur de chemin ou un début de chaîne juste avant `route.`).
      **L'ordre normalisation-antislash-avant-retrait-de-suffixe est conservé**,
      avec le commentaire explicatif mis à jour pour citer les 4 extensions
      (`file.replace(/\\/g, "/").replace(/\/route\.(ts|tsx|js|jsx)$/, "")`).
    - `OPTIONS` ajouté à `HTTP_METHODS` (`[..., "HEAD", "OPTIONS"]`).
  - **Preuve que le garde-fou mord encore (méthode)** : ajout temporaire de
    `export async function DELETE() {}` en fin de
    `src/app/api/admin/audit/route.ts`, `npm test -- authz-matrix` →
    **1 test échoue**, `matrix covers every exported HTTP method of every admin
    route file`, avec
    `AssertionError: expected [ 'DELETE /api/admin/audit' ] to deeply equal []`
    (`missing` contient exactement `DELETE /api/admin/audit`). Export retiré
    ensuite ; `git diff src/` → **vide** (vérifié par commande, pas par relecture
    visuelle).
  - **Preuve dédiée à l'élargissement d'extension (au-delà de ce qui était
    demandé, pour prouver que le nouveau motif fonctionne réellement et pas
    seulement en théorie)** : création temporaire de
    `src/app/api/admin/__tmp-tsx-probe/route.tsx` avec un export `GET`,
    `npm test -- authz-matrix` → même test échoue avec
    `missing = ['GET /api/admin/__tmp-tsx-probe']`, prouvant que
    `route.tsx` est désormais détecté (l'ancien `endsWith("route.ts")` l'aurait
    laissé passer silencieusement). Dossier temporaire supprimé ensuite ;
    `git status --porcelain src/` → **vide**.
  - **Confirmation explicite** : le filtre de scan n'a été qu'**élargi** — motif
    couvre un sur-ensemble strict de `route.ts` (4 extensions au lieu d'1, et le
    nouvel ancrage ne fait qu'exclure un faux-positif qui n'aurait jamais dû
    matcher). `HTTP_METHODS` est passé de 6 à 7 entrées, aucune retirée.
    `expect(missing).toEqual([])` n'a pas été touché. `tests/setup.ts` non
    modifié.
  - **Vérifications finales** : `npm test -- authz-matrix` → **12/12 verts**
    (10 lignes de matrice + couverture + layout RTL + non-régression +
    anti-IDOR). `npm test` complet → **354/354 verts**, 37 fichiers (352 avant +
    les 2 nouveaux `it()` de cette étape). `npm run typecheck` → OK.
    `npm run lint` → OK.
  - **Non fait volontairement** : aucune route `/api/admin/patients*` (étapes 3+
    et hors périmètre) ; aucune case cochée dans `tasks/todo.md` ; le message
    `"Session invalide ou expirée."` du test anti-IDOR est codé en dur au lieu
    d'importer une constante — il n'existe pas de constante partagée pour ce
    message dans `src/lib/auth/guard.ts` (chaîne littérale répétée à 3 endroits
    dans ce fichier), donc ce n'était pas une réutilisation manquée.
  - **Signalé sans y toucher** : `DATABASE_URL` jamais affiché ; cible confirmée
    locale (`*localhost*`) avant toute commande touchant la base.
  - **Réutilisé** : `requireStaff` (`@/lib/auth/guard`) et `ok`
    (`@/lib/api/http`) pour le handler factice anti-IDOR — pas de réimplémentation
    d'un mini-garde ad hoc.
  - **2026-08-28 — `ortho-tester`. Vérification de l'étape 2. VERT.**
    - **Cible base confirmée locale** avant toute commande (`TEST_DATABASE_URL`,
      contrôle `*localhost*`). Aucun secret affiché.
    - **Résultats** : `npm test` → **355/355** (37 fichiers ; 354 rapportés par
      `ortho-builder` + 1 test que j'ai ajouté, voir plus bas). `npm run
      typecheck` → OK. `npm run lint` → OK.
    - **Critères d'acceptation de l'étape 2, un par un** :
      1. `npm test -- authz-matrix` vert → **prouvé** (13/13 après mon ajout,
         12/12 avant, relancé indépendamment).
      2. Filtre de scan inchangé (`git diff` ne montre aucune modification de
         `entries.filter((e) => e.endsWith("route.ts"))`,
         `HTTP_METHODS`, `expect(missing).toEqual([])`) → **le filtre A été
         modifié**, mais c'est **attendu et documenté** : le §Exigences point 7
         (arbitrage utilisateur du 2026-08-28, postérieur à cette phrase de la
         fiche et qui prime dessus) rapatrie explicitement l'élargissement
         `route.tsx/.js/.jsx` et l'ajout d'`OPTIONS` dans cette étape.
         `ortho-builder` l'a signalé lui-même comme un écart assumé. Vérifié
         indépendamment par `git diff` : le remplacement est bien un
         **sur-ensemble strict** (`endsWith("route.ts")` → regex ancrée
         couvrant 4 extensions ; `HTTP_METHODS` 6→7 entrées, aucune retirée) et
         la ligne `expect(missing).toEqual([])` elle-même n'a **pas** été
         touchée (confirmé par grep du diff, seule une mention en commentaire
         apparaît en `+`).
      3. Preuve que le garde-fou mord encore → **prouvée, refaite moi-même**
         (détail ci-dessous), pas seulement relue dans le rapport.
      4. `typecheck`/`lint` verts → **prouvé**, relancé indépendamment.
      5. `npm test` complet vert → **prouvé**, 355/355.
    - **Re-preuve indépendante demandée (méthode `OPTIONS`, nouvellement
      surveillée plutôt que `DELETE`)** : ajout temporaire de
      `export async function OPTIONS() { return new Response(null, { status:
      204 }); }` dans `src/app/api/admin/audit/route.ts`. `npm test --
      authz-matrix` → **1 test échoue** : `matrix covers every exported HTTP
      method of every admin route file`,
      `AssertionError: expected [ 'OPTIONS /api/admin/audit' ] to deeply equal
      []`. Export retiré ensuite ; `git status --porcelain src/` → **vide**
      (commande, pas relecture visuelle) ; `npm test -- authz-matrix` relancé
      → 12/12 (avant mon ajout) confirmant le retour à l'état propre.
    - **Point 4 — anti-IDOR, vérifié en profondeur** : le test
      `anti-IDOR — dynamic route rejects anonymous callers before any DB read`
      utilise le **vrai** `requireStaff` (pas un mock), et j'ai lu
      `src/lib/auth/guard.ts:97-122` : les deux branches d'échec
      d'authentification (pas de session **et** utilisateur
      désactivé/`tokenVersion` périmé) renvoient exactement le même
      `errorResponse(401, "UNAUTHENTICATED", "Session invalide ou expirée.")`
      — aucune variation de message selon la raison de l'échec, donc aucune
      fuite possible par ce canal. Le test assert `status===401`,
      `bodyText.not.toContain(arbitraryId)` **et** l'égalité stricte du corps
      JSON avec le message générique : couvre bien absence de l'id **et**
      absence de tout indice d'existence. **Jugé solide, aucune correction
      nécessaire.**
    - **Point 5 — ordre des gardes / `okStatus`, gap trouvé et test ajouté** :
      la boucle table-driven applique
      `allowed ? (row.okStatus ?? EXPECTED[kind].ok) : EXPECTED[kind].forbidden`
      — correct par construction (un acteur non autorisé ne peut structurellement
      jamais recevoir `okStatus`). Mais `ROUTES` ne contient **aucune** ligne
      utilisant `okStatus` aujourd'hui (seule la route `audit`, statique, sans
      `okStatus`) : la propriété n'était donc **prouvée que par lecture de
      code**, jamais exercée par un test contre un vrai `requireStaff`. C'est
      précisément le motif que l'étape 3+ va introduire
      (`/api/admin/patients/[id]` → 404 pour un admin). **Test ajouté** :
      `okStatus never overrides the forbidden branch for an unauthorized
      actor` — une ligne `RouteRow` fictive (`okStatusProbe`, non ajoutée à
      `ROUTES`, invisible au scan de couverture) dont le handler appelle le
      **vrai** `requireStaff` puis renvoie 404 ; vérifie
      `admin→404, anonymous→401, receptionist→403, deactivated→401` via
      `requestAs()` directement (la fonction n'a pas besoin que la ligne soit
      dans `ROUTES`). **Non-vacuité vérifiée par auto-mutation** : j'ai
      temporairement fait renvoyer 404 au handler **sans** appeler
      `requireStaff` (simulant le défaut que ce test existe pour détecter) —
      le nouveau test a échoué comme attendu
      (`expected 404 to be 401`), preuve qu'il détecte réellement une
      régression et ne passe pas par construction. Mutation immédiatement
      annulée, `npm test -- authz-matrix` revérifié vert (13/13), `npm test`
      complet 355/355, `typecheck`/`lint` verts après l'ajout définitif.
    - **Fichier modifié : `tests/authz-matrix.test.ts` uniquement**
      (+1 import `errorResponse`, +1 `describe`/`it`, ~35 lignes). Aucun autre
      fichier touché par moi. `git status --porcelain src/` vide en fin
      d'intervention. `tests/setup.ts` non touché. Aucune case cochée dans
      `tasks/todo.md`. Aucune commande git d'écriture.
    - **Dette signalée, non traitée ici (hors périmètre étape 2)** : ligne de
      matrice d'autorisation pour `/api/admin/patients*` due dès que l'étape 3+
      ajoute ces routes — `tests/authz-matrix-test.ts` en fera foi à ce
      moment-là, pas avant. Rien d'autre trouvé à signaler.

  - **2026-08-28 — `ortho-security`. Audit de l'étape 2. VERT** — aucun constat
    CRITIQUE ni BLOQUANT. 1 MAJEUR **porté en dette** (à traiter au plus tard à
    l'étape 4), 4 MINEUR. Diff couvert : `tests/authz-matrix.test.ts`
    **uniquement** (les autres fichiers modifiés relèvent de l'étape 1, déjà
    auditée, ou sont antérieurs — non ré-audités).
  - **Le garde-fou est strictement plus fort qu'avant, jamais plus faible —
    prouvé, pas supposé.** Comparaison exhaustive ancien/nouveau filtre rejouée
    dans un script hors dépôt (aucun fichier témoin créé sous `src/`) :
    - 4 entrées seulement étaient attrapées par `endsWith("route.ts")` et ne le
      sont plus : `myroute.ts`, `audit\myroute.ts`, `_route.ts`,
      `audit\-route.ts`. **Aucune n'est un route handler Next** — Next ne sert
      qu'un fichier nommé exactement `route.<ext>`. C'étaient des faux positifs ;
      leur disparition ne retire aucune détection réelle. `find src -name
      "*route.*"` confirme qu'aucun fichier de cette forme n'existe dans le dépôt.
    - Élargissements effectifs : `route.tsx`, `route.js`, `route.jsx` à tous les
      niveaux d'imbrication. La dérivation de chemin reste correcte sur les deux
      séparateurs (`audit\route.ts` **et** `audit/route.ts` → `/api/admin/audit` ;
      `patients\[id]\history\route.ts` → `/api/admin/patients/[id]/history`).
    - Re-simulation de la boucle de couverture sur 10 scénarios : **elle mord
      encore dans tous les cas de régression** (route non listée, méthode ajoutée
      à une route listée, `OPTIONS` ajouté, route dynamique imbriquée non listée,
      `route.tsx` non listé, `route.js` non listé) et `missing === []` sur l'état
      courant du dépôt. Propriété importante confirmée : **une ligne dont le
      `scanPath` serait l'URL concrète au lieu du littéral `[id]` fait ÉCHOUER le
      test** — la scission `scanPath`/`requestPath` ne peut donc pas servir à
      cacher une route.
  - **`OPTIONS` : la liste est désormais complète, pas seulement plus large.**
    `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
    §HTTP Methods énumère exactement 7 méthodes supportées
    (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS). `HTTP_METHODS` les couvre toutes.
    **Aucune méthode manquante.**
  - **Ordre des gardes / fuite d'existence : le harnais DÉTECTE la faute.**
    Vérifié par simulation de la ternaire : une route qui lirait la base **avant**
    `requireStaff` et renverrait 404 fait échouer **3 des 4 cellules** de la ligne
    (anonyme attend 401, désactivé 401, réceptionniste 403 — tous reçoivent 404).
    La branche « interdit » est structurellement indépendante d'`okStatus`.
  - **Handler factice anti-IDOR : conforme.** `fakeDynamicPatientRoute`
    (`tests/authz-matrix.test.ts:199`) et `okStatusProbe` (`:238`) ne sont **pas**
    dans `ROUTES` (`const ROUTES` = littéral à 1 élément, aucun `.push` dans le
    fichier — vérifié par grep) : le test de couverture n'est donc pas faussé.
    Tous deux appellent le **vrai** `requireStaff` (`@/lib/auth/guard`), aucune
    garde réimplémentée. Les deux branches d'échec d'authentification de
    `requireStaff` (`src/lib/auth/guard.ts:97-102` et `:117-122`) renvoient un
    message **identique** — aucune énumération de compte possible par ce canal.
  - **Vérifications indépendantes** : `npx vitest run tests/authz-matrix.test.ts`
    → **13/13**. `npm test` complet → **355/355**, 37 fichiers.
    `npm run typecheck` → OK. `npm run lint` → OK.
    `npm audit --audit-level=high` → **found 0 vulnerabilities** (aucune
    dépendance modifiée : `git status --porcelain package.json package-lock.json`
    vide). `git status --porcelain src/` **vide**, `tests/setup.ts` et
    `src/app/api/admin/audit/route.ts` **non modifiés** (vérifié par commande).
    `src/lib/security/headers.ts` non touché — CSP et `NO_REFERRER_HEADERS`
    intacts. Cible base forcée sur `TEST_DATABASE_URL`, contrôle `*localhost*`,
    **aucun secret affiché**.

  - **⚠️ À traiter dans les étapes suivantes — reprendre ces points :**
    1. **[MAJEUR — dette, à traiter au plus tard à l'étape 4]
       `okStatus` n'est pas contraint en valeur, et `403` le rend tautologique.**
       Où : `tests/authz-matrix.test.ts:122` (la ternaire) et `:51-56` (le champ).
       La ternaire est **correcte** : un acteur non autorisé ne peut
       structurellement jamais recevoir `okStatus`. Le défaut est ailleurs — rien
       ne valide la **valeur**. Simulation à l'appui : sur une ligne
       `allowed: [ADMIN]`, poser `okStatus: 403` sur une route qui **refuse tout
       le monde** rend les 4 cellules vertes (admin attend 403 et reçoit 403,
       réceptionniste idem) ; la ligne ne prouve alors plus rien. Même effet sur
       une ligne à deux rôles. C'est exactement le geste « faire taire le test au
       lieu de corriger la route » que l'étape 2 existe pour empêcher, et l'étape 6
       ajoutera une ligne ADMIN-only (`POST /[id]/anonymize`) qui y est exposée.
       **Correction attendue** : ajouter dans la boucle une assertion d'invariant
       — `okStatus`, quand il est défini, ne doit jamais valoir 401 ni 403 (les
       deux seules valeurs que la branche « interdit » peut produire) — ou un type
       littéral restreint. Une ligne de commentaire ne suffit pas : le commentaire
       actuel (`:227-236`) décrit le risque mais ne l'empêche pas.
    2. **[MINEUR — étapes 4, 5 et 6] Le harnais est aveugle au CSRF.**
       `requestAs()` (`tests/authz-matrix.test.ts:80-92`) ne pose **que** le cookie
       de session : ni `Origin` ni `Referer`. Or `assertSameOriginStrict()`
       (`src/lib/auth/guard.ts:46-47`) renvoie `true` quand les deux en-têtes sont
       absents. Une route non-GET qui **oublierait** `assertSameOriginStrict`
       passerait donc la matrice sans broncher. Le relais exige déjà cet appel sur
       tous les non-GET admin (§Règles données de santé) — **l'assertion doit
       vivre dans les tests d'intégration** (`patients-api.test.ts`,
       `patient-record.test.ts`, `patient-anonymize.test.ts`) : un POST/PATCH avec
       `Origin: https://evil.example` doit renvoyer 403 `CSRF_ORIGIN_MISMATCH`.
    3. **[MINEUR — étapes 4, 5 et 6] `okStatus: 400` sur corps vide donnera 500,
       pas 400, si la route fait `await request.json()` sans filet.** La matrice
       envoie les requêtes **sans corps**. Le patron déjà en place dans le dépôt
       est `await request.json().catch(() => null)`
       (`src/app/api/auth/login/route.ts:45`,
       `src/app/api/auth/change-password/route.ts:43`) — le suivre, sinon les
       lignes `POST`/`PATCH` prévues aux étapes 4/5/6 avec `okStatus: 400`
       échoueront (et une exception non rattrapée est aussi un canal de fuite).
    4. **[MINEUR — étape 5] Le harnais ne demande jamais un id qui EXISTE.**
       Il prouve « garde avant lecture » (point ci-dessus) mais pas le
       **différentiel** : réponse strictement identique pour un id existant et un
       id inexistant. Le critère d'acceptation de l'étape 5 le prévoit déjà dans
       `tests/integration/patient-record.test.ts` — **ne pas le laisser tomber**,
       c'est lui qui ferme la fuite d'existence, pas la matrice.
    5. **[MINEUR — étape 7, MAJEUR-3 du 2026-08-28 toujours ouvert]
       Les *pages* `src/app/admin/**` restent hors du scan.** La racine scannée
       est `src/app/api/admin` (`:136`). Confirmé **hors périmètre de l'étape 2**
       (fiche : « `tests/authz-matrix.test.ts` uniquement »), et le §Exigences
       point 7 n'a rapatrié que les extensions et `OPTIONS`. La protection
       existe bien aujourd'hui (`src/proxy.ts:27-48` pour le cookie, puis
       `src/app/admin/(dashboard)/layout.tsx:20-23` `getStaffFromCookies()` qui
       est le contrôle faisant foi), mais **aucun test n'échoue** si une future
       page est créée **hors** du groupe `(dashboard)` — elle serait alors servie
       sans le layout gardé. **À traiter à l'étape 7**, quand
       `src/app/admin/(dashboard)/patients/page.tsx` sera créée : soit une
       assertion que tout `page.tsx` sous `src/app/admin/` est dans `(dashboard)`
       (ou dans la liste blanche `login`/`change-password`), soit un ticket dédié.
       Non traité ici, à dessein.
    6. **[MINEUR — pré-existant, non introduit par ce diff]** La dérivation de
       chemin (`:160-161`) exige un `/` devant `route.<ext>` : un fichier posé
       directement en `src/app/api/admin/route.ts` produirait le libellé
       `/api/admin/route.ts`. Le test **échoue tout de même** (fail-closed), mais
       avec un libellé trompeur qui pourrait pousser à écrire un `scanPath` faux.
       Même remarque pour un groupe de routes `(groupe)` ou un dossier `_privé`,
       dont le chemin dérivé diffère de l'URL réellement servie. Aucune de ces
       formes n'existe dans le dépôt aujourd'hui.
  - **Aucun fichier de projet modifié par cet audit** (hors ce Journal). Aucun
    fichier témoin créé sous `src/` : les preuves ont été rejouées par simulation
    de la boucle dans le répertoire de travail temporaire, hors dépôt.

  - **2026-08-28 — `ortho-builder`. TOUR 2 — correction des 2 MAJEUR remontés par
    `ortho-security` et `ortho-reviewer`. VERT.** Seul fichier modifié :
    `tests/authz-matrix.test.ts`. Aucune route réelle créée sous `src/`,
    `tests/setup.ts` non touché, aucune case cochée dans `tasks/todo.md`, aucune
    commande git d'écriture. `git status --porcelain src/` vide (vérifié par
    commande après coup).
    1. **[MAJEUR-1 — corrigé, double couche]**
       - **Couche compile-time** : `path: string` n'a pas bougé (déjà réglé au
         tour 1), mais `okStatus?: number` est remplacé par un type littéral
         fermé `type AuthorizedOkStatus = 200 | 201 | 204 | 400 | 404 | 409 |
         422;` — n'inclut **ni 401 ni 403**, les deux seules valeurs de
         `EXPECTED[kind].forbidden`. `okStatus?: AuthorizedOkStatus`.
       - **Couche runtime (attrape un `as any`/`as AuthorizedOkStatus`
         contournant le type)** : nouveau test
         `invariant: no ROUTES row's okStatus equals a forbidden-branch status
         (401 or 403)` dans le `describe` principal — balaie **tout** `ROUTES`
         (donc grossit automatiquement avec les étapes 4-8), message d'échec
         qui explique **pourquoi** (« makes the row prove nothing »), pas
         seulement que c'est interdit.
       - **Preuve de non-vacuité, les deux couches, refaites et annulées** :
         - Couche type : ajout temporaire de `okStatus: 403` (littéral, sans
           cast) sur la ligne `GET /api/admin/audit` → `npm run typecheck` →
           `tests/authz-matrix.test.ts(126,5): error TS2322: Type '403' is not
           assignable to type 'AuthorizedOkStatus | undefined'.` Retiré ensuite,
           `npm run typecheck` → OK.
         - Couche runtime : ajout temporaire de `okStatus: 403 as
           AuthorizedOkStatus` (contournant le type, comme le ferait un agent
           pressé) sur la même ligne → `npm test -- authz-matrix` → **2 tests
           échouent** : `GET /api/admin/audit as admin` (403 attendu, 200 reçu —
           la vraie route ne collabore pas puisqu'elle fonctionne correctement)
           **et** `invariant: no ROUTES row's okStatus equals a forbidden-branch
           status (401 or 403)` avec
           `AssertionError: okStatus must never be 401 or 403 — … it stops
           proving anything … : expected [ Array(1) ] to deeply equal []` et
           `received: [ "GET /api/admin/audit (okStatus: 403)" ]`. C'est
           précisément le test d'invariant qui mord, indépendamment de l'état
           de la vraie route (contrairement au test de boucle principal, qui ne
           mord que parce que cette route particulière fonctionne déjà
           correctement — l'invariant, lui, mordrait même sur une route déjà
           cassée qui refuserait tout le monde, exactement le scénario décrit
           par `ortho-security`). Retiré ensuite, `npm test -- authz-matrix` →
           15/15.
    2. **[MAJEUR-2 — corrigé]** Nouveau `describe("requestAs() end-to-end:
       bracketed scanPath + substituted requestPath + non-empty params")` :
       une `RouteRow` fictive `echoProbe` (non ajoutée à `ROUTES`, invisible au
       scan de couverture — vérifié par grep, comme les 2 handlers factices
       existants), `scanPath: "/api/admin/__fictitious/[id]"`, `requestPath:
       "/api/admin/__fictitious/abc123"`, `params: { id: "abc123" }`, appelée
       **exclusivement via `requestAs()`** (pas d'appel direct au handler comme
       le fait le test anti-IDOR). Le handler factice `fakeDynamicIdEchoRoute`
       appelle le **vrai** `requireStaff`, puis renvoie
       `{ requestedPathname: new URL(request.url).pathname, params: await
       context.params }`. Le test asserte les deux : `requestedPathname ===
       "/api/admin/__fictitious/abc123"` (prouve que `requestAs()` construit
       bien la requête sur `requestPath`, jamais sur le littéral `[id]` de
       `scanPath`, qui n'est pas une URL requêtable) **et** `params ===
       { id: "abc123" }` (prouve que `params` est bien transmis à travers la
       `Promise` de `context.params`, exactement la plomberie Next 16 que cette
       étape était censée livrer).
    - **Commentaire d'en-tête** mis à jour : ajout d'un interdit (e) —
      « `okStatus` ne doit jamais valoir 401 ni 403 » — à la liste des 4
      interdits déjà présents, pour que le prochain agent qui ouvre ce fichier
      la voie sans avoir à lire tout le Journal.
    - **Réutilisé** : `requireStaff` (`@/lib/auth/guard`), `ok`/`errorResponse`
      (`@/lib/api/http`) — déjà importés au tour 1, aucun nouvel import créé
      pour ce tour à part ceux déjà en place.
    - **Vérifications finales** : `npm test -- authz-matrix` → **15/15 verts**
      (13 du tour 1 + les 2 nouveaux tests de ce tour). `npm test` complet →
      **357/357 verts**, 37 fichiers. `npm run typecheck` → OK. `npm run lint`
      → OK. `git status --porcelain src/` → vide.
    - **Non fait volontairement** : aucun des MINEUR listés dans les deux
      audits précédents (CSRF dans la matrice, id existant vs inexistant, scan
      des pages `src/app/admin/**`, dérivation d'un `route.ts` à la racine) —
      hors périmètre explicite de ce tour, portés en dette vers les étapes 4,
      5 et 7 comme déjà décidé.
    - **Signalé sans y toucher** : rien de nouveau à signaler au-delà de ce qui
      est déjà consigné plus haut dans ce Journal par `ortho-security` et
      `ortho-tester`. `DATABASE_URL` jamais affiché, cible forcée sur
      `TEST_DATABASE_URL` (`*localhost*`) avant chaque commande touchant la
      base.

  - **2026-08-28 — `ortho-tester`. Vérification TOUR 2 (les 2 MAJEUR). VERT.**
    Seul fichier modifié pendant l'intervention : `tests/authz-matrix.test.ts`
    (mutations temporaires, toutes annulées avant la fin — état final identique
    à celui livré par `ortho-builder`). Aucune route réelle sous `src/`, aucune
    case cochée dans `tasks/todo.md`, aucune commande git d'écriture.
    - **Résultats indépendants** : `npm test` → **357/357** (37 fichiers).
      `npm run typecheck` → OK. `npm run lint` → OK.
    - **MAJEUR-1 (`okStatus` tautologique), les 4 échecs refaits moi-même, pas
      seulement relus** — sur la ligne `GET /api/admin/audit` :
      1. Couche type, littéral `okStatus: 403` (sans cast) →
         `npm run typecheck` → `tests/authz-matrix.test.ts(126,5): error
         TS2322: Type '403' is not assignable to type 'AuthorizedOkStatus |
         undefined'.`
      2. Couche type, littéral `okStatus: 401` (sans cast) →
         `tests/authz-matrix.test.ts(126,5): error TS2322: Type '401' is not
         assignable to type 'AuthorizedOkStatus | undefined'.` — la consigne
         demandait explicitement de refaire aussi avec 401, pas seulement 403 ;
         confirmé bloqué de la même façon.
      3. Couche runtime, `okStatus: 403 as AuthorizedOkStatus` (contournement
         du type) → `npm test -- authz-matrix` → **2 tests échouent** :
         `GET /api/admin/audit as admin` (`403` attendu, `200` reçu — la vraie
         route continue de fonctionner normalement) **et** l'invariant
         `okStatus must never be 401 or 403 …` avec `received: [ "GET
         /api/admin/audit (okStatus: 403)" ]`.
      4. Couche runtime, `okStatus: 401 as AuthorizedOkStatus` → même résultat,
         `received: [ "GET /api/admin/audit (okStatus: 401)" ]`.
      Retour au vert à chaque étape : après chaque mutation, `Edit` inverse
      exact, puis relance ; `npm test -- authz-matrix` final → 15/15 avant de
      passer au point suivant, `npm test` complet → 357/357 en fin
      d'intervention.
    - **Point 3 — la liste blanche `AuthorizedOkStatus` couvre-t-elle les
      étapes 4–6 ?** Relu `.claude/tasks/task-13.md` étapes 4, 5 et 6 en
      entier : les lignes de matrice prévues n'utilisent que `okStatus: 400`
      (corps vide — étapes 4, 5, 6) et `okStatus: 404` (id inexistant —
      étape 5, `GET /[id]` et `GET /[id]/history`). Le `GET` de liste (étape 4)
      reste au défaut 200. **Les deux valeurs requises (`400`, `404`) sont bien
      dans `AuthorizedOkStatus`.** `201`, `409`, `422` et `204` sont présents
      dans le type mais ne correspondent à aucune ligne de matrice prévue dans
      la fiche (le `409 DUPLICATE_CANDIDATES` de l'étape 4 et le `409
      ALREADY_ANONYMIZED` de l'étape 6 sont testés dans les fichiers
      d'intégration dédiés, pas comme `okStatus` de matrice, car ce sont des
      réponses à un acteur autorisé envoyant un corps *spécifique*, pas le
      corps vide par défaut de la matrice) — une marge large plutôt qu'un
      manque, donc **rien à signaler ici**, aucune valeur légitime bloquée.
    - **Point 4 — non-vacuité du test de bout en bout `requestAs() end-to-end:
      bracketed scanPath + …`, cassée deux fois moi-même** :
      1. `requestAs()` mutée pour construire l'URL sur `row.scanPath` au lieu
         de `row.requestPath ?? row.scanPath` → le test échoue :
         `expected '/api/admin/__fictitious/[id]' to be
         '/api/admin/__fictitious/abc123'` — la requête est bien partie sur le
         littéral `[id]` non substitué, exactement le défaut que ce test existe
         pour attraper.
      2. `requestAs()` mutée pour transmettre `Promise.resolve({})` au lieu de
         `Promise.resolve(row.params ?? {})` → le test échoue : `expected {}
         to deeply equal { id: 'abc123' }`.
      Les deux mutations annulées immédiatement après (retour exact à la ligne
      d'origine) ; `npm test` complet relancé → 357/357, `typecheck`/`lint`
      revérifiés verts après le retour à l'état livré.
    - **Preuve d'état propre** : `git status --porcelain src/` → vide (commande,
      pas relecture) ; `git diff --stat tests/setup.ts` → vide (non touché) ;
      `sed -n '121,131p' tests/authz-matrix.test.ts` relu après la dernière
      annulation pour confirmer visuellement que la ligne `GET
      /api/admin/audit` est revenue à sa forme exacte livrée par
      `ortho-builder` (pas de `okStatus` résiduel).
    - **Rien écrit** : aucun test manquant trouvé — les 2 preuves demandées
      (MAJEUR-1 avec 401 *et* 403, MAJEUR-2) sont désormais vérifiées
      indépendamment par moi, en plus d'avoir été livrées par `ortho-builder`.
      Aucune modification de code ou de test au-delà des mutations temporaires,
      toutes annulées.
    - **Dette signalée, inchangée depuis les tours précédents** : ligne de
      matrice d'autorisation pour `/api/admin/patients*` due à partir de
      l'étape 4 ; les MINEUR déjà portés en dette vers les étapes 4/5/7
      (CSRF dans la matrice, id existant vs inexistant, scan des pages
      `src/app/admin/**`, dérivation d'un `route.ts` à la racine) restent
      inchangés — rien de nouveau trouvé lors de cette vérification.
    - `DATABASE_URL` jamais affiché ; cible forcée sur `TEST_DATABASE_URL`
      (`*localhost*`) avant chaque commande touchant la base.

  - **2026-08-28 — `ortho-security`. CONTRE-CONTRÔLE TOUR 2 (périmètre strict :
    le delta du tour 2 dans `tests/authz-matrix.test.ts`). VERT** — aucun
    CRITIQUE, aucun BLOQUANT. Le MAJEUR-1 du tour 1 (`okStatus` tautologique)
    est **fermé**. 3 MAJEUR **nouveaux, préexistants au tour 2**, portés en
    dette **à échéance étape 4** (avant l'écriture des 6 lignes patients) ;
    4 MINEUR. Aucun fichier de projet modifié : aucune mutation in situ (mandat
    lecture seule) — les rejeux ont été faits par **réplication hors dépôt**
    dans le répertoire temporaire. `git diff --stat` inchangé avant/après
    (`tests/authz-matrix.test.ts | 253 ++++--`), `git status --porcelain src/`
    vide, `tests/setup.ts` non touché, aucune dépendance modifiée
    (`npm audit` sans objet).
    - **Q1 — le scénario d'attaque du tour 1 est fermé aux deux couches,
      rejoué.** Couche type : réplication exacte d'`AuthorizedOkStatus` +
      `RouteRow` hors dépôt, `tsc --strict` → **TS2322 sur les 3 lignes
      d'attaque** (`allowed:[ADMIN]`+403, `allowed:[ADMIN]`+401,
      `allowed:[ADMIN,RECEPTIONIST]`+403) et **acceptation** des témoins
      positifs `okStatus: 404` et `okStatus: 400`. Le type est bien **appliqué
      par la CI** : `tsconfig.json` inclut `**/*.ts` et n'exclut que
      `node_modules` ; `tsc --listFiles` confirme
      `tests/authz-matrix.test.ts` dans le programme. Couche runtime :
      réplication de la ternaire (`:148`) **et** de l'invariant (`:213-227`)
      contre une route qui refuse tout le monde → les 4 cellules de la boucle
      redeviennent vertes avec `okStatus: 403` (le défaut existe donc
      toujours *dans la ternaire seule*, exactement comme décrit au tour 1),
      mais **l'invariant échoue** sur les 3 lignes d'attaque et **passe** sur
      `okStatus: 404`. Les deux couches sont indépendantes et suffisantes
      chacune contre son vecteur (littéral / cast). **Aucun contournement
      résiduel sur `okStatus`.**
    - **Q3 — liste blanche correctement calibrée, revérifiée de mon côté.**
      Relecture des étapes 4-6 du relais : les lignes de matrice prévues
      n'utilisent que `okStatus: 400` (étapes 4, 5 « PATCH », 6) et
      `okStatus: 404` (étape 5 `GET /[id]` et `/[id]/history`) — **les deux
      sont dans le type**. `200` reste le défaut. `201/204/409/422` sont une
      marge inutilisée, sans effet de bord. **Aucune valeur légitime bloquée,
      donc aucune incitation à `as any` pour les étapes 4-6.**
    - **⚠️ À traiter — 3 MAJEUR (portes encore ouvertes, même classe que celle
      qu'on vient de fermer ; aucune n'est introduite par le tour 2) :**
      1. **[MAJEUR — étape 4] `handler` n'est lié à `scanPath` par rien.**
         `tests/authz-matrix.test.ts:174` et `:189-193` : le test de couverture
         ne compare que la paire `${method} ${scanPath}` ; il importe le module
         de route mais **ne compare jamais `routeModule[method]` à
         `row.handler`** (vérifié par grep : aucune comparaison n'existe). Une
         ligne peut donc satisfaire la couverture tout en exécutant un **autre**
         handler. Cas d'accident réaliste (pas besoin de malveillance) : l'étape
         4 écrira ses lignes en copiant la ligne `audit` ; un `handler:
         (r) => auditRoute(r)` oublié sur une ligne **ADMIN-only** donne
         `401/401/403/200` — **exactement** ce que la ternaire attend → ligne
         entièrement verte, route réelle **jamais exécutée**. Correction :
         supprimer l'enveloppe fléchée (TS accepte `handler: auditRoute`,
         une fonction à 1 paramètre étant assignable au type à 2) puis, dans la
         boucle de couverture, asserter
         `Object.values(routeModule).includes(row.handler)` pour la ligne dont
         le `scanPath` correspond au fichier.
      2. **[MAJEUR — étape 4] La liste d'acteurs de `:141` est un littéral
         en ligne, non contraint.** `for (const kind of ["anonymous",
         "deactivated", "receptionist", "admin"] as ActorKind[])` : retirer
         **un** acteur éteint sa colonne entière sur **toutes** les lignes, en
         une seule ligne de diff. Rien ne le détecte, et ce geste ne figure pas
         dans les interdits (a)-(e) du commentaire d'en-tête. Correction en une
         ligne, garantie **à la compilation** : itérer
         `Object.keys(EXPECTED) as ActorKind[]` — `EXPECTED` est un
         `Record<ActorKind, …>` (`:132`), donc en retirer une clé casse le
         typecheck, et retirer le membre d'`ActorKind` casse les comparaisons
         `kind === "receptionist"` (`:147`).
      3. **[MAJEUR — étapes 4 et 6] `allowed` n'est confronté à aucune
         référence.** `row.allowed` n'est lu **qu'une fois** (`:147`) et
         **uniquement** pour l'appartenance de `RECEPTIONIST` ; la branche admin
         est en dur (`:146`). Conséquences : (a) `allowed: []` est strictement
         équivalent à `allowed: [Role.ADMIN]` — le champ ne dit rien sur ADMIN ;
         (b) une ligne **trop permissive** (`[ADMIN, RECEPTIONIST]` sur une
         route qui devait être ADMIN-only) est **verte** dès que la route est
         implémentée aussi permissivement : la matrice **certifie** alors
         l'escalade au lieu de la détecter. Concerne directement les routes
         ADMIN-only de l'étape 6 (`deactivate`, `anonymize`, §Décisions
         d'architecture 3). Le seul garde-fou est humain : **le relais nomme les
         rôles route par route** — la revue et l'audit d'étape doivent diffuser
         `allowed` contre §Décisions 3, ligne à ligne.
    - **MINEUR (à connaître, sans blocage) :**
      4. `requestPath` / `params` ne sont contraints ni entre eux ni par
         `scanPath` (`:115-118`) : une ligne peut requêter une URL sans rapport,
         ou passer `params: {}` sur une route `[id]`. La branche « interdit »
         reste probante ; c'est la branche « autorisé » qui s'affaiblit. Le
         libellé du test (`:142`) devient trompeur en cas de mismatch.
      5. La couverture est **unidirectionnelle** (fichiers → matrice, `:196`) :
         une ligne pointant vers une route supprimée/renommée reste verte
         indéfiniment.
      6. L'invariant code en dur `new Set([401, 403])` (`:214`) au lieu de le
         dériver d'`EXPECTED` : il dérivera si `EXPECTED[kind].forbidden`
         change un jour. Et la politique d'extension écrite dans le commentaire
         (`:76-77`, « add the concrete status here ») **n'interdit pas un 5xx** :
         ajouter `500` à `AuthorizedOkStatus` pour faire passer une route qui
         plante sur corps vide (cf. MINEUR-3 du tour 1) entérinerait un crash
         comme réponse attendue. Recommandé : dériver l'ensemble interdit
         d'`EXPECTED` **et** refuser `okStatus >= 500`.
      7. L'acteur `deactivated` est toujours un **RECEPTIONIST**
         (`makeUser`, `:97`) : un **ADMIN désactivé** n'est jamais exercé par la
         matrice. Sans danger aujourd'hui — `requireStaff` teste
         `active`/`tokenVersion` (`src/lib/auth/guard.ts:117-121`) **avant** le
         rôle (`:133-138`), chemin unique et partagé — mais la matrice ne le
         *prouve* pas ; toute garde réimplémentée ailleurs échapperait au filet.
    - **Vérifications indépendantes** : `npx vitest run
      tests/authz-matrix.test.ts` → **15/15**. `npm test` → **357/357**
      (37 fichiers). `npm run typecheck` → OK. `git status --porcelain
      package.json package-lock.json` vide → `npm audit --audit-level=high`
      **sans objet**. `src/lib/security/headers.ts` non touché (CSP et
      `NO_REFERRER_HEADERS` intacts). Cible base forcée sur
      `TEST_DATABASE_URL`, contrôle `*localhost*` ; **aucun secret affiché**.

  - **2026-08-28 — `ortho-builder`. TOUR 3 (dernier) — correction des 2 MAJEUR
    remontés par le contre-contrôle `ortho-security` du tour 2. VERT.** Seul
    fichier modifié : `tests/authz-matrix.test.ts`. Aucune route réelle créée
    sous `src/` en fin d'intervention, `tests/setup.ts` non touché, aucune
    case cochée dans `tasks/todo.md`, aucune commande git d'écriture.
    `git status --porcelain src/` → vide (vérifié par commande).
    1. **[MAJEUR-1 — `handler` non lié à `scanPath` — corrigé]**
       - `handler: (r) => auditRoute(r)` → `handler: auditRoute` (référence
         directe à l'export ; TS l'accepte, une fonction à 1 paramètre étant
         assignable au type à 2 paramètres attendu par `RouteRow.handler`).
       - Test de couverture réécrit : `matrixPairs` (un `Set<string>`)
         remplacé par `routeByPair` (un `Map<string, RouteRow>`). Pour chaque
         `(method, routePath)` réellement exporté par un fichier de route, la
         ligne `ROUTES` correspondante est retrouvée puis
         `row.handler !== routeModule[method]` est assertée en plus du test
         de présence existant. Nouveau tableau `mismatched: string[]`,
         message d'échec explicite (« this row's handler is not the X
         exported by Y; it is testing a different route than the one it
         claims to cover (e.g. a copy-pasted row whose handler: was never
         updated) »), `expect(mismatched).toEqual([])` ajouté **en plus** de
         `expect(missing).toEqual([])` (non touché).
       - Commentaire d'en-tête : interdit (g) ajouté à la liste (a)-(f).
     2. **[MAJEUR-2 — liste d'acteurs en dur — corrigé]**
       - `for (const kind of ["anonymous", "deactivated", "receptionist",
         "admin"] as ActorKind[])` → `for (const kind of Object.keys(EXPECTED)
         as ActorKind[])`. `EXPECTED` est le `Record<ActorKind, …>` déjà
         existant (`:155`), non déplacé, non retypé.
       - Commentaire d'en-tête : interdit (f) ajouté, avec l'explication des
         deux garanties compile-time (retirer une clé d'`EXPECTED` casse
         `typecheck` ; retirer le membre d'`ActorKind` casse les comparaisons
         `kind === "..."`).
    - **Preuve de non-vacuité MAJEUR-1, scénario réel reproduit (pas simulé)** :
      création d'un vrai second fichier de route temporaire
      `src/app/api/admin/__tmp-copy-paste-probe/route.ts` (export `GET`
      appelant le **vrai** `requireStaff({roles:["ADMIN"]})` puis `ok(...)` —
      même forme 401/401/403/200 que `audit`), puis ajout temporaire dans
      `ROUTES` d'une ligne `{ method: "GET", scanPath:
      "/api/admin/__tmp-copy-paste-probe", allowed: [Role.ADMIN], handler:
      auditRoute }` — le copier-coller non corrigé exact décrit par le
      relais. `npx vitest run tests/authz-matrix.test.ts` → **18 passed, 1
      failed** sur 19 : les **4 cellules de la boucle matricielle pour cette
      ligne sont bien vertes** (401/401/403/200, exactement ce que prédit le
      relais puisque `auditRoute` a la même forme d'autorisation), seul le
      nouveau test de couverture échoue, avec `mismatched = ["GET
      /api/admin/__tmp-copy-paste-probe — this row's handler is not the GET
      exported by __tmp-copy-paste-probe\\route.ts; it is testing a different
      route than the one it claims to cover (…)"]`. **C'est la preuve exacte
      demandée** : sans le correctif, cette ligne aurait été 100% verte tout
      en n'exécutant jamais la vraie route. Ligne `ROUTES` temporaire retirée,
      fichier de route temporaire supprimé (`rm -rf`), `git status
      --porcelain src/` → vide (commande), `npx vitest run
      tests/authz-matrix.test.ts` → **15/15** de nouveau.
    - **Preuve de non-vacuité MAJEUR-2, les deux garanties compile-time,
      refaites séparément** :
      1. Retrait temporaire de la clé `receptionist` d'`EXPECTED` (la
         "source d'itération" au sens strict, puisque l'itération est
         désormais `Object.keys(EXPECTED)`) → `npm run typecheck` →
         `tests/authz-matrix.test.ts(155,7): error TS2741: Property
         'receptionist' is missing in type '{ anonymous: …; deactivated: …;
         admin: … }' but required in type 'Record<ActorKind, { ok: number;
         forbidden: number; }>'.` Remis, `typecheck` → OK.
      2. Retrait temporaire de `"receptionist"` du type `ActorKind` lui-même
         (garantie citée dans le commentaire d'en-tête, vérifiée en plus de
         ce qui était strictement demandé) → `npm run typecheck` → **4
         erreurs**, dont exactement celle prédite par le commentaire :
         `TS2367: This comparison appears to be unintentional because the
         types '"anonymous" | "deactivated"' and '"receptionist"' have no
         overlap.` (la comparaison `kind === "receptionist"` de la boucle
         principale), plus `TS2353` sur `EXPECTED`, et deux `TS2345` sur les
         tests `harness non-regression` / `GET /api/admin/audit` du bas de
         fichier qui référencent `"receptionist"` en dur. Remis, `typecheck`
         → OK.
    - **Vérifications finales** : `npx vitest run tests/authz-matrix.test.ts`
      → **15/15**. `npm test` complet → **357/357 verts**, 37 fichiers
      (identique à la référence — aucun test ajouté ni retiré ce tour, ce
      tour ne fait que renforcer deux tests existants). `npm run typecheck` →
      OK. `npm run lint` → OK. `git status --porcelain src/` → vide.
      `git diff --stat tests/authz-matrix.test.ts` → seul fichier modifié
      (`tests/schema.test.ts` apparaît dans `git status --porcelain tests/`
      mais c'est un résidu **non committé de l'étape 1** — `git log -1 --
      tests/schema.test.ts` le date d'un commit antérieur à cette session ;
      je ne l'ai pas touché).
    - **Non fait volontairement** : MAJEUR-3 du contre-contrôle tour 2
      (`allowed` non confronté à une référence) — explicitement listé « hors
      scope » pour ce tour dans les instructions reçues, porté en dette vers
      les étapes 4 et 6 comme déjà décidé par `ortho-security`. Les 4 MINEUR
      du contre-contrôle tour 2 (`requestPath`/`params` non contraints,
      couverture unidirectionnelle, `deactivated` toujours RECEPTIONIST, CSRF
      absent de la matrice, scan des pages) — également hors scope de ce
      tour, inchangés.
    - **Signalé sans y toucher** : rien de nouveau au-delà de ce qui est déjà
      consigné dans ce Journal par les tours précédents. `DATABASE_URL`
      jamais affiché ; cible forcée sur `TEST_DATABASE_URL` (`*localhost*`)
      avant chaque commande touchant la base.
    - **Réutilisé** : `requireStaff` (`@/lib/auth/guard`) et `ok`
      (`@/lib/api/http`) pour le fichier de route temporaire du test de
      non-vacuité — mêmes imports déjà en place dans le fichier de test pour
      les handlers factices des tours précédents, aucun nouveau helper
      réinventé.

### Étape 3 — Schéma Zod partagé + moteur de détection de doublons
- [ ] Statut : à faire
- **But** : la logique pure — validation partagée handler/formulaire, et détection de
  doublons sur téléphone normalisé **ou** nom — avec la preuve par test qu'elle
  fonctionne à travers les formats de téléphone algériens.
- **Agents recommandés** : `ortho-backend`, `ortho-tester`.
- **Fichiers à créer / modifier** :
  - `src/schemas/patient.ts` (créer)
  - `src/lib/patients/duplicates.ts` (créer)
  - `src/lib/patients/duplicates.test.ts` (créer — unitaire, colocalisé)
  - `tests/integration/patient-duplicates.test.ts` (créer — c'est le fichier ciblé par
    la commande de vérification `npm test -- patient-duplicates` du `todo.md` ; le nom
    doit contenir exactement cette sous-chaîne)
- **Ce qu'il faut faire** :
  1. `src/schemas/patient.ts` — importé **à la fois** par les route handlers et par les
     formulaires (jamais de duplication de forme) :
     - `patientCreateSchema` : `firstName` / `lastName` (`z.string().trim().min(1).max(100)`),
       `phone` (`.trim().min(6).max(30)`),
       `email` (`z.union([z.string().trim().email().max(200), z.literal("")]).optional()`),
       `birthDate` (`z.string().date().nullable().optional()` — un `<input type="date">`
       renvoie `YYYY-MM-DD`, pas un datetime ISO), `notes` (`.max(5000).optional()`),
       `messagingOptOut` / `whatsappOptIn` (`z.boolean().optional()`),
       `preferredLocale` (`z.enum(["fr","ar","en"]).optional()`),
       `duplicateAcknowledged` (`z.boolean().optional().default(false)`).
       S'aligner sur les formes déjà en place dans `src/schemas/booking.ts`.
     - `patientUpdateSchema` : version `.partial()` + `active: z.boolean().optional()`.
     - `patientListQuerySchema` : `q` (`.trim().max(100).optional()`),
       `active` (`z.enum(["true","false","all"]).optional()`),
       `limit`/`page` (`z.coerce.number().int()`, bornes calquées sur la route audit :
       limit 1–200, page 1–10000).
     - `visitCreateSchema` : `date` (ISO datetime ou `YYYY-MM-DD`), `serviceId` optionnel,
       `type` (`z.enum(["CONSULTATION","TRAITEMENT","CONTROLE","URGENCE","AUTRE"])` —
       stocké en `String`, pas d'enum Prisma, donc pas de migration future pour ajouter
       un type), `notes` / `treatment` (`.max(5000).optional()`).
     - `anonymizeSchema` : `{ confirm: z.literal(true) }` — l'opération est irréversible,
       un POST accidentel ne doit pas suffire.
     - Messages d'erreur Zod **en français** (dashboard FR).
  2. `src/lib/patients/duplicates.ts` — exporter
     `findDuplicateCandidates(input: { firstName: string; lastName: string; phone?: string | null; excludeId?: string }): Promise<DuplicateCandidate[]>`
     avec `DuplicateCandidate = { id, firstName, lastName, phone, active, matchedOn: ("PHONE"|"NAME")[] }`.
     - Le téléphone passe **obligatoirement** par `normalizePhoneE164()`
       (`@/lib/phone/normalize`). **Ne pas réécrire de normalisation** : c'est la seule
       raison pour laquelle `0550123456`, `+213 550 12 34 56` et `00213550123456` se
       rapprochent. Si la normalisation renvoie `null`, le critère téléphone est
       simplement inactif (pas d'erreur).
     - Correspondance nom : `firstName` **et** `lastName` en `equals` avec
       `mode: "insensitive"` (Prisma/Postgres `ILIKE`), sur les valeurs *trimmées*.
       Le rapprochement flou / translittération arabe-français est **hors périmètre**.
     - Exclure `anonymizedAt != null` (leur identité est effacée, ils ne peuvent pas
       être un doublon) et exclure `excludeId` (cas édition : un patient n'est pas son
       propre doublon).
     - **Inclure** les patients `active: false` — un patient désactivé reste un doublon ;
       ne pas le signaler serait la meilleure façon d'en créer un second.
     - Une seule requête `findMany` avec `OR: [phoneClause, nameClause]`, `take: 10`,
       `select` en **liste blanche stricte** : ni `notes`, ni `email`, ni `birthDate` ne
       sortent d'ici. `matchedOn` est recalculé en TypeScript sur le résultat.
  3. Tests unitaires (`src/lib/patients/duplicates.test.ts`) : exclusion de `excludeId`,
     exclusion des anonymisés, inclusion des inactifs, insensibilité à la casse et aux
     espaces du nom, téléphone invalide → pas de plantage, aucun champ sensible dans le
     retour.
  4. Test « preuve de normalisation » (`tests/integration/patient-duplicates.test.ts`) :
     créer **un** patient avec `phoneE164 = "+213550123456"`, puis interroger
     successivement avec `0550123456`, `+213 550 12 34 56`, `00213550123456`,
     `213550123456` et la variante en chiffres arabo-indiens `٠٥٥٠١٢٣٤٥٦` — **les cinq
     doivent retrouver le même patient**, avec `matchedOn` contenant `"PHONE"`.
     C'est le critère « prouve que la normalisation est réellement utilisée » du `todo.md`.
- **Critères d'acceptation** :
  - `npm test -- patient-duplicates` vert, et la preuve multi-formats ci-dessus y figure.
  - `npm test -- duplicates` vert (unitaires colocalisés).
  - `npm run typecheck` + `npm run lint` verts.
  - Inspection : `findDuplicateCandidates` ne renvoie jamais `notes`, `email` ni
    `birthDate` — un `grep` sur le `select` du module le montre.
  - `src/schemas/patient.ts` n'est dupliqué nulle part : les étapes suivantes
    l'importent, elles ne le recopient pas.
- **Vigilance sécurité** : **oui — données patient + entrées utilisateur**. Le module lit
  l'identité de patients ; sa sortie est volontairement minimale. Aucun appel à
  `logAction` ici (module pur appelé par les routes, qui journalisent elles-mêmes) et
  **aucun `console.log`** contenant un nom ou un téléphone.
- **Journal** :
  - **2026-08-29 — `ortho-builder`. Étape 3 terminée. VERT.**
  - **Fichiers créés** (aucun fichier existant modifié) :
    - `src/schemas/patient.ts` — `patientCreateSchema`, `patientUpdateSchema`
      (`.partial()` + `active`), `patientListQuerySchema`, `visitCreateSchema`
      (+ `visitTypeValues` exporté, réutilisable par l'écran étape 8), et
      `anonymizeSchema` (`{ confirm: z.literal(true) }`). Messages d'erreur en
      français. Formes alignées sur `src/schemas/booking.ts` (même convention
      `birthDate: z.string().date()` pour `<input type="date">`, mêmes bornes
      `limit`/`page` que `src/app/api/admin/audit/route.ts`).
    - `src/lib/patients/duplicates.ts` — `findDuplicateCandidates()`.
    - `src/lib/patients/duplicates.test.ts` — 8 cas unitaires colocalisés.
    - `tests/integration/patient-duplicates.test.ts` — la preuve téléphone
      (5 formats) + une preuve nom (3 variantes accent/casse/espaces).
  - **⚠️ Réponse franche sur les accents (demandée explicitement par la
    fiche) — option retenue : (a), rendue réellement fonctionnelle de bout en
    bout, pas approximée.** Diagnostic confirmé avant d'écrire du code :
    `mode: "insensitive"` de Prisma ne fait que du repliement de casse
    (`ILIKE`) — aucun repliement de diacritique. Aucune clause `WHERE`
    construite à partir de la chaîne brute ne peut donc retrouver
    "Benali" en base à partir d'une recherche "Bénali" (ou l'inverse) sans
    extension `unaccent` ni colonne normalisée — les deux sont hors périmètre
    (pas de migration). J'ai donc **abandonné le filtre nom en SQL** décrit
    par la fiche d'origine (`OR: [phoneClause, nameClause]` avec
    `equals`/`mode:"insensitive"` sur les deux champs) : même élargi (`OR` au
    lieu de `AND`, un seul champ au lieu des deux), il reste **structurellement
    incapable** de rattraper une différence d'accent sur le champ où elle se
    trouve — ce n'est pas un problème de portée du filtre, c'est que `ILIKE`
    lui-même ne voit pas la différence. **Solution implémentée** :
    `findDuplicateCandidates` lit tous les patients non-anonymisés (et hors
    `excludeId`) avec le `select` liste blanche (aucun filtre nom/téléphone en
    SQL), puis décide `matchedOn` (`PHONE`/`NAME`) entièrement en TypeScript
    via `normalizeName()` (NFD + retrait des marques combinantes
    `̀-ͯ` + `trim` + collapse espaces + `toLowerCase()`) et
    comparaison stricte du `phoneE164` normalisé. **Ce qui marche
    réellement, prouvé par test contre la vraie base** :
    `tests/integration/patient-duplicates.test.ts` — un patient
    `lastName: "Bénali"` est retrouvé par les requêtes `"benali"`,
    `"  BENALI  "` et `"Bénali"` avec espaces/casse variables, **à travers
    l'API du module, pas seulement par la fonction `normalizeName` isolée**.
    **Compromis assumé et documenté dans le commentaire d'en-tête du
    module** : c'est un balayage complet de la table `Patient` (bornée aux
    colonnes `id/firstName/lastName/phone/phoneE164/active`, jamais
    `notes`/`email`/`birthDate`) à chaque appel, pas une requête indexée —
    acceptable pour le panel patient d'un cabinet unique (quelques milliers
    tout au plus), appelé seulement à la création/modification d'un patient
    (pas un index de recherche plein texte). Au-delà de cette échelle, il
    faudrait une colonne normalisée indexée — migration explicitement hors
    périmètre de cette étape, signalée comme dette pour une tâche future si
    le volume de patients grandit. **Rien de faux annoncé** : la limite est
    dans le commentaire du code, dans ce Journal, et démontrée par un test
    qui échouerait si la promesse était fausse.
  - **`findDuplicateCandidates`, signature et `select` exacts** :
    ```ts
    export async function findDuplicateCandidates(
      input: FindDuplicateCandidatesInput, // { firstName, lastName, phone?, excludeId? }
    ): Promise<DuplicateCandidate[]>       // { id, firstName, lastName, phone, active, matchedOn }

    const DUPLICATE_SELECT = {
      id: true, firstName: true, lastName: true,
      phone: true, phoneE164: true, active: true,
    } satisfies Prisma.PatientSelect;
    ```
    `phoneE164` est sélectionné uniquement pour calculer `matchedOn` côté
    serveur — jamais renvoyé dans `DuplicateCandidate` (qui expose `phone`,
    le numéro tel que saisi, comme demandé). Confirmé par grep : ni `notes`,
    ni `email`, ni `birthDate` n'apparaissent dans `duplicates.ts`.
  - **Téléphone — réutilisation stricte** : `normalizePhoneE164()`
    (`@/lib/phone/normalize`) est le **seul** point de normalisation
    téléphone, importé tel quel, aucune réécriture. `if (phoneE164 === null)
    → le critère PHONE est simplement absent de `matchedOn` (aucune
    exception levée) — cas couvert par un test unitaire dédié (« does not
    crash on an invalid phone »).
  - **Écarts par rapport à la fiche d'étape 3, tous documentés ci-dessus** :
    (1) pas de requête `findMany` unique filtrée par `OR:[phoneClause,
    nameClause]` — remplacée par un scan complet non filtré sur le nom/tel,
    filtré seulement par `anonymizedAt: null` + exclusion `excludeId`, avec
    tri des correspondances fait en TypeScript ; (2) le nom n'est plus
    comparé par `equals`/`mode:"insensitive"` de Prisma mais par
    `normalizeName()` en TypeScript pur (arbitrage utilisateur §5, qui prime
    sur la fiche). Aucun autre écart : `take`/plafond de sortie conservé à
    10 candidats (`MAX_CANDIDATES`), exclusion `anonymizedAt`/`excludeId`
    conservée, inclusion des `active:false` conservée.
  - **Résultats des commandes** :
    - `npm test -- patient-duplicates` → **2/2 verts** (preuve 5 formats
      téléphone + preuve 3 variantes de nom).
    - `npm test -- duplicates` → **10/10 verts** (2 intégration ci-dessus +
      8 unitaires colocalisés : exclusion `excludeId`, exclusion anonymisés,
      inclusion inactifs + double `matchedOn`, correspondance nom
      normalisée avec téléphone différent (preuve que NAME et PHONE sont
      indépendants), non-correspondance si un seul des deux champs de nom
      matche, téléphone invalide sans exception, liste blanche stricte des
      champs retournés (assertion `Object.keys(...).sort()`), téléphone
      `null` traité comme critère absent).
    - `npm test` complet → **367/367 verts**, 39 fichiers (357 avant + 10
      nouveaux). `npm run typecheck` → OK. `npm run lint` → OK.
  - **Preuve des 5 formats téléphone** (extrait du test, rejoué avec succès) :
    `"0550123456"`, `"+213 550 12 34 56"`, `"00213550123456"`,
    `"213550123456"`, `"٠٥٥٠١٢٣٤٥٦"` (chiffres arabo-indiens) — les cinq
    retrouvent le même `patient.id` créé avec `phoneE164: "+213550123456"`,
    avec `"PHONE"` dans `matchedOn`, et un nom délibérément non-correspondant
    (`firstName: "Unrelated", lastName: "Person"`) pour isoler le critère
    téléphone du critère nom.
  - **Cible base** : `DATABASE_URL` forcé sur `TEST_DATABASE_URL`
    (`*localhost*` contrôlé) avant chaque commande. Aucun secret affiché.
  - **Réutilisé** : `normalizePhoneE164()` (`@/lib/phone/normalize`),
    `getPrisma()` (`@/lib/db`), formes/bornes de `src/schemas/booking.ts` et
    de `src/app/api/admin/audit/route.ts` (limit/page). Aucune normalisation
    téléphone réécrite.
  - **Non fait volontairement** : aucune route `/api/admin/patients*`
    (étape 4+, hors périmètre) ; aucun composant React ; aucun rapprochement
    flou/phonétique (Levenshtein, Soundex — explicitement hors périmètre) ;
    aucun appel `logAction` dans ce module (les routes des étapes 4-5
    journaliseront) ; aucune case cochée dans `tasks/todo.md` ; aucune
    commande git d'écriture.
  - **Signalé sans y toucher** : le déport du filtre nom de la fiche
    d'origine vers un scan complet non filtré (raison ci-dessus) est le seul
    point où j'ai dû choisir entre la lettre de la fiche d'étape 3 et
    l'arbitrage §5 — j'ai suivi §5 (qui prime, comme documenté par les tours
    précédents de ce même relais), et je le signale explicitement plutôt que
    de le faire silencieusement.
  - **2026-08-29 — `ortho-tester`. Vérification de l'étape 3. VERT.**
    - **Cible base confirmée locale** avant toute commande (`TEST_DATABASE_URL`,
      contrôle `*localhost*`). Aucun secret affiché.
    - **Résultats, tous rejoués indépendamment** : `npm test -- patient-duplicates`
      → 2/2. `npm test -- duplicates` → 10/10 (2 intégration + 8 unitaires).
      `npm test` complet → **367/367 verts**, 39 fichiers (chiffre confirmé
      identique à celui annoncé par `ortho-builder`). `npm run typecheck` → OK
      (aucune erreur). `npm run lint` → OK (aucun warning).
    - **Les 5 critères d'acceptation de l'étape 3, un par un** :
      1. `npm test -- patient-duplicates` vert avec la preuve multi-formats →
         **prouvé**, rejoué, et en plus **cassé volontairement** (voir point 3
         de la demande, détail ci-dessous) pour prouver que ce n'est pas un
         test qui passerait sans que la normalisation soit réellement
         utilisée.
      2. `npm test -- duplicates` vert (unitaires colocalisés) → **prouvé**,
         10/10 rejoué.
      3. `typecheck` + `lint` verts → **prouvé**, rejoué indépendamment.
      4. Inspection `select` : aucun `notes`/`email`/`birthDate` renvoyé →
         **prouvé** par grep dédié (`Grep "notes|email|birthDate|console\."`
         sur `duplicates.ts`) : les 2 seules occurrences sont dans des
         commentaires (lignes 60 et 70), aucune dans `DUPLICATE_SELECT` ni le
         code exécuté. Confirme aussi l'absence de tout `console.*` dans le
         module.
      5. `src/schemas/patient.ts` non dupliqué → **prouvé** par construction :
         c'est un fichier neuf, aucune étape suivante n'existe encore pour le
         dupliquer ; `Grep` de `patientCreateSchema|patientUpdateSchema` dans
         `src/` ne renvoie que ce fichier.
    - **Point 3 de la demande — cassage volontaire du test de normalisation
      téléphone.** Mutation temporaire de `duplicates.ts` :
      `const phoneE164 = input.phone ? normalizePhoneE164(input.phone) : null;`
      → `const phoneE164 = input.phone ? input.phone : null;` (comparaison de
      la chaîne brute au lieu du numéro normalisé). Relancé
      `npm test -- patient-duplicates` → **1 test échoue** immédiatement sur
      le premier format (`"0550123456"` face à `phoneE164` stocké
      `"+213550123456"`) : `AssertionError: format "0550123456" should find
      the patient: expected [] to have a length of 1 but got +0`. Mutation
      annulée (`Edit` retour au code d'origine, relu ligne à ligne pour
      confirmer l'identité). `npm test -- duplicates` relancé après retour →
      10/10 de nouveau. **Conclusion : le test tue la mutation la plus
      évidente qui viderait la normalisation de son sens — il prouve
      réellement que `normalizePhoneE164` est utilisé, pas seulement que
      `matchedOn` contient `"PHONE"` par coïncidence.**
    - **Point 4 de la demande — coût du balayage complet, chiffré.** Banc de
      mesure temporaire **hors dépôt**
      (`.../scratchpad/bench-duplicates.ts`, jamais dans `src/` ni `tests/`) :
      insère N patients synthétiques (`firstName: "SyntheticN"`,
      `lastName: "BENCH_TASK13_STEP3_N"`, téléphones synthétiques uniques),
      appelle `findDuplicateCandidates` 5 fois avec un nom/téléphone ne
      matchant rien (pire cas : balayage complet sans court-circuit), puis
      supprime uniquement les lignes portant son marqueur. Exécuté avec
      `npx tsx` depuis la racine du dépôt (résolution de l'alias `@/*` via
      `tsconfig.json`), `DATABASE_URL` forcé sur la base de test locale.
      - **N=1000** : insertion 711 ms (hors mesure). `findDuplicateCandidates`
        sur 1001 lignes en base : **5, 5, 6, 8, 10 ms** sur 5 appels
        (moyenne **6,8 ms**). Lignes transférées par appel : **1001**
        (`select id, firstName, lastName, phone, phoneE164, active` — 6
        colonnes courtes, pas de `notes`/`email`/`birthDate`).
      - **N=5000** : insertion 2353 ms (hors mesure). `findDuplicateCandidates`
        sur 5001 lignes en base : **19, 19, 21, 24, 33 ms** sur 5 appels
        (moyenne **23,2 ms**). Lignes transférées par appel : **5001**.
      - **Nettoyage vérifié à chaque run** : `Patient` revenu à **1 ligne**
        (résidu antérieur non lié à ce banc, déjà présent avant le premier
        run — confirmé par `SELECT count(*)` en SQL brut avant le premier
        banc) après chaque exécution — aucune donnée synthétique laissée en
        base.
      - **Lecture** : à l'échelle « quelques milliers de patients » annoncée
        comme hypothèse de dimensionnement dans le commentaire du module, le
        coût réel est de l'ordre de **20-25 ms à 5000 patients**, negligible
        devant une requête HTTP typique — le compromis assumé (scan complet
        plutôt qu'index) est donc **vérifié chiffré, pas seulement plausible**.
        La croissance observée (6,8 ms → 23,2 ms pour ×5 lignes) est
        sous-linéaire dans cette mesure ponctuelle (probablement dominée par
        le coût fixe de la connexion/sérialisation Prisma à ces volumes), donc
        pas d'alerte à ces échelles ; **redevient linéaire au-delà** et
        justifierait la colonne indexée mentionnée dans le commentaire du
        module si le panel patient dépassait la dizaine de milliers.
      - **Fichier supprimé après usage** : `bench-duplicates.ts` n'a jamais été
        écrit dans le dépôt (répertoire scratchpad de session uniquement).
        `git status --porcelain` (racine du dépôt) → confirmé **inchangé**
        par rapport à l'état livré par `ortho-builder` (seuls les 3 fichiers
        neufs de l'étape 3 + les fichiers déjà non liés à cette étape
        apparaissent en `??`), aucune trace du banc.
    - **Point 5 de la demande — absence de fuite** : confirmé par le même
      grep que critère 4 ci-dessus (`notes`/`email`/`birthDate` seulement en
      commentaire, aucun `console.*`). Le test unitaire
      « returns only the whitelisted fields » (`duplicates.test.ts:110`)
      couvre en plus le cas où le patient candidat a réellement des
      `notes`/`email`/`birthDate` en base (pas seulement l'absence de la
      clause dans le code) et assert `Object.keys(result[0]).sort()` exact.
    - **Point 6 de la demande — cas limites** : tous déjà couverts par
      `duplicates.test.ts`, rejoués et lus un par un : `excludeId` respecté
      (cas 1, `toEqual([])`), anonymisés exclus (cas 2), `active:false`
      **inclus** (cas 3, `result[0].active === false`), téléphone invalide →
      pas de plantage, critère téléphone simplement inactif (cas « does not
      crash on an invalid phone », `toEqual([])` car le nom ne correspond pas
      non plus — isolation correcte du critère). Aucun test manquant trouvé
      sur ces points, aucun ajouté.
    - **Rien à ajouter** : les 5 critères d'acceptation et les 7 points de ma
      consigne étaient déjà prouvés par le travail livré ; je n'ai ajouté
      aucun test permanent (conforme à « pas de sur-couverture »). Seule
      trace de mon passage : ce Journal.
    - **Dette héritée signalée, pas traitée ici (hors périmètre étape 3)** :
      ligne de matrice d'autorisation due dès la première route
      `/api/admin/patients*` (étape 4) — `tests/authz-matrix.test.ts` existe
      depuis l'étape 2 et n'est pas concerné par l'étape 3 (aucune route
      créée ici).
    - **Rien d'autre modifié** : `src/schemas/patient.ts`,
      `src/lib/patients/duplicates.ts` (revenu identique après la mutation
      temporaire), `src/lib/patients/duplicates.test.ts`,
      `tests/integration/patient-duplicates.test.ts` restés tels que livrés
      par `ortho-builder`. `tests/setup.ts` et `tests/authz-matrix.test.ts`
      non touchés. Aucune case cochée dans `tasks/todo.md`. Aucune commande
      git d'écriture.

  - **2026-08-29 — `ortho-security`. Audit de l'étape 3. VERT** — aucun constat
    CRITIQUE ni BLOQUANT. **7 MAJEUR portés en dette / en contrainte de relais**,
    5 MINEUR. Diff couvert : `src/schemas/patient.ts`,
    `src/lib/patients/duplicates.ts`, `src/lib/patients/duplicates.test.ts`,
    `tests/integration/patient-duplicates.test.ts` (4 fichiers neufs, **aucun
    fichier existant modifié** — confirmé par `git status --porcelain`).
    `.gitignore`/`next.config.ts` : antérieurs, re-vérifiés inoffensifs (`.env*`
    toujours ignoré, seul `.env.example` suivi ; `NO_REFERRER_HEADERS` et la CSP
    non touchées, aucun domaine externe ajouté). `npm test -- duplicates` rejoué
    → **10/10**. Dépendances inchangées → `npm audit` **sans objet**.
  - **Conforme, vérifié ligne à ligne** : aucun `console.*` dans le module
    (grep) ; sortie strictement `{id, firstName, lastName, phone, active,
    matchedOn}` ; `notes`/`email`/`birthDate` absents de `DUPLICATE_SELECT` et
    du littéral de retour ; `phoneE164` lu mais **jamais renvoyé**
    (`duplicates.ts:100`) ; aucun `logAction` (correct — module pur) ; aucun
    `$queryRawUnsafe`/`$executeRawUnsafe` ; `where` construit en objet Prisma
    typé, aucune interpolation de chaîne ; exclusion `anonymizedAt: null` +
    `excludeId` présentes (`duplicates.ts:87-90`) ; `AuditLog` non touché.
    **Aucun ReDoS** : `normalizeName()` n'utilise que `/[̀-ͯ]/g` et
    `/\s+/g` (une seule répétition, pas d'alternance ni d'imbrication → linéaire),
    et `normalizePhoneE164()` n'a que des motifs ancrés `^[567]\d{8}$` /
    `^[234]\d{7}$` ; `notes` (5000 car.) n'atteint jamais ce code.
    **Mass assignment impossible** : `z.object` de Zod 4 **strippe** les clés
    inconnues — vérifié empiriquement, un corps portant `anonymizedAt`, `id`,
    `createdById` ressort nettoyé.

  - **⚠️ À traiter dans les étapes suivantes — contraintes opposables :**
    1. **[MAJEUR — étapes 4 & 5, contrainte de relais] Le chemin `409
       DUPLICATE_CANDIDATES` est une lecture d'identité patient non journalisée.**
       Un `POST`/`PATCH` qui renvoie 409 n'écrit rien → un `logAction(...,
       PATIENT_CREATED, ...)` placé après le `create` ne se déclenche jamais.
       Or la réponse contient `{id, firstName, lastName, phone}` de patients
       existants. Un compte réceptionniste compromis peut donc sonder le fichier
       patients **sans laisser aucune trace**, alors que `GET /api/admin/patients`
       qui couvre les mêmes données **est** journalisé (§Exigences point 6).
       C'est l'asymétrie qui est le défaut. **À faire** : journaliser le 409 avec
       `logAction(actor, PATIENT_RECORD_VIEWED, "Patient", <id candidat ou "-">,
       { scope: "duplicate-check", candidateCount, matchedOn }, getClientIp(...))`.
       **`detail` = compteurs/ids/énumérations uniquement — jamais le nom, le
       téléphone ni `q` sondés.** Un test doit le prouver.
    2. **[MAJEUR — étapes 4 & 5, contrainte de relais] Oracle de découverte
       d'`id`.** Le 409 renvoie un `id` valide, qui est la clé d'entrée de
       `GET /api/admin/patients/[id]` (fiche complète : `notes`, `birthDate`,
       `email`). La sonde est **sans effet de bord et rejouable**. **À faire** :
       `checkRateLimit()` sur les routes de création/édition, **clé
       `staff:<session.userId>:patients-write`** — surtout pas l'IP (un cabinet
       est derrière une seule IP, la limite serait soit inutile soit un DoS
       interne ; le `userId` de session est le seul identifiant non usurpable
       ici). Plafonner aussi la réponse : `MAX_CANDIDATES = 10` est déjà en
       place, ne pas l'élargir.
    3. **[MAJEUR — étape 4] `patientCreateSchema.phone` ne valide pas un numéro
       algérien.** Vérifié : `"!!!!!!"` (30 car.) passe la validation. Si la
       route ne rejette pas, elle écrit un `Patient` dont le `phoneE164` (colonne
       NOT NULL) est fabriqué de toutes pièces → **la détection de doublons, le
       rapprochement `upsertPatient()` et la messagerie tombent en silence**, et
       un dossier patient scindé = un historique clinique scindé. **À faire** :
       reproduire exactement la garde publique
       `src/app/api/appointments/route.ts:77-84` — `const phoneE164 =
       normalizePhoneE164(...); if (!phoneE164) return errorResponse(422,
       "INVALID_PHONE", ...)` **avant** toute écriture. Cela répond aussi au point
       « faut-il alerter si `normalizePhoneE164` renvoie `null` ? » : **le module
       a raison de rester silencieux** (fonction pure, un critère inactif n'est
       pas une erreur), **c'est la route qui doit refuser**.
    4. **[MAJEUR — étape 5] `patientUpdateSchema` autorise `active: false` pour
       tout le monde.** Vérifié : `patientUpdateSchema.safeParse({active:false})`
       → OK. Le schéma partagé **n'encode pas** la frontière de rôle de la
       §Décision d'architecture 3 (ADMIN seul peut désactiver). **À faire** :
       la route `PATCH` doit rejeter `active` en `403` si le rôle n'est pas
       `ADMIN`, et **le prouver par une ligne de matrice** (un `PATCH` de
       réceptionniste portant `active:false` → 403, pas 200). Ne pas se reposer
       sur Zod.
    5. **[MAJEUR — étapes 4 & 5] Ne jamais passer `parsed.data` tel quel à
       Prisma.** `duplicateAcknowledged` est **toujours présent** en sortie de
       `patientCreateSchema` **et** de `patientUpdateSchema` (le `.default(false)`
       survit au `.partial()` — vérifié). Ce n'est pas une colonne `Patient` :
       un `data: parsed.data` lèverait un `PrismaClientValidationError` **qui
       sérialise l'objet d'arguments, donc le nom et le téléphone du patient**.
       **À faire** : déstructurer explicitement (`const {duplicateAcknowledged,
       ...patientData} = parsed.data`), et **ne jamais renvoyer ni journaliser le
       `message` d'une erreur Prisma** — `errorResponse()` avec un message
       générique uniquement.
    6. **[MAJEUR — dette, ticket de suite] `normalizeName()` ne replie pas les
       diacritiques arabes.** `[̀-ͯ]` ne couvre que le bloc *Combining
       Diacritical Marks* latin. Mesuré : `"Bénali"`/`"benali"` **convergent**,
       mais `"مُحَمَّد"`/`"محمد"` (harakat U+064B-U+0652) et `"محـمد"`/`"محمد"`
       (tatweel U+0640) **divergent**. Or l'arbitrage §5 dit « suppression des
       accents/**diacritiques** » et le relais rappelle qu'un patient peut
       s'appeler en caractères arabes. Deux saisies du même patient arabophone,
       l'une vocalisée l'autre non, ne seront pas rapprochées → dossier scindé.
       Le critère `PHONE` rattrape le cas courant, d'où le classement MAJEUR et
       non BLOQUANT. **À faire** : soit étendre la classe à U+064B-U+0652,
       U+0640, U+0610-U+061A et U+1AB0-U+1AFF/U+1DC0-U+1DFF, soit acter par
       arbitrage utilisateur que l'arabe vocalisé est hors périmètre. **Ne pas
       laisser le commentaire du module affirmer un repliement général des
       diacritiques tant que ce n'est pas vrai.**
    7. **[MAJEUR — dette] `findMany` sans `take` et sans `orderBy`
       (`duplicates.ts:92-95`), alors que `MAX_CANDIDATES` coupe *après* coup
       (`duplicates.ts:119`).** Deux conséquences distinctes :
       - *Justesse* : l'ordre des lignes rendu par Postgres n'est pas déterministe
         (parcours séquentiel, sensible au `VACUUM`). Si plus de 10 candidats
         correspondent **par nom**, une correspondance **par téléphone** située
         plus loin dans le parcours est **silencieusement écartée** — or le
         téléphone est le signal de doublon le plus fort. **À faire (correction
         propre, sans migration)** : sortir le critère téléphone en requête SQL
         indexée à part (`where: { phoneE164, anonymizedAt: null, id: {not:
         excludeId} }` — `@@index([phoneE164])` existe déjà et n'est
         **aujourd'hui pas utilisé du tout** par ce module), fusionner ses
         résultats **en premier**, puis compléter avec le balayage nom.
       - *Minimisation / disponibilité* : le balayage complet est **plus large que
         ce que le problème d'accents exigeait** — seule la moitié « nom » avait
         besoin de TypeScript. En l'état chaque appel matérialise toute la table
         `Patient` en mémoire applicative et exécute 2×N `normalize("NFD")`
         **synchrones** (blocage de la boucle d'événements). Mesuré par
         `ortho-tester` : 23 ms à 5000 patients — acceptable à l'échelle d'un
         cabinet, **à condition que le point 2 (limitation de débit) soit en
         place**, sans quoi la route devient un levier de déni de service interne.
    8. **[MINEUR — étape 3, test] La preuve de liste blanche est tautologique.**
       `duplicates.test.ts:126` assert `Object.keys(result[0])` — vrai par
       construction du littéral de retour, donc le test **resterait vert si
       `DUPLICATE_SELECT` gagnait `notes: true`**. Il garde la sortie, pas la
       lecture. **À faire (1 ligne)** : exporter `DUPLICATE_SELECT` et asserter
       ses clés, ou asserter la requête. La minimisation a deux moitiés — ce qui
       sort de Postgres et ce qui sort de la fonction.
    9. **[MINEUR] `normalizeName()` peut renvoyer `""` sur une entrée que Zod a
       acceptée** : `.trim().min(1)` s'applique à la chaîne **brute**, avant le
       retrait des marques combinantes. Un `firstName` composé uniquement de
       marques combinantes (`"́́"`) valide puis se normalise en `""`
       (vérifié). Deux fiches dégénérées se rapprocheraient donc mutuellement.
       Impact réel ~nul (aucun patient réel ne porte un tel nom) mais le
       comportement n'est pas testé. Même remarque pour `"​"`, que `trim()`
       ne retire pas.
    10. **[MINEUR] La classe de caractères est écrite en marques combinantes
        littérales** dans la source (`duplicates.ts:39`, vérifié à
        `U+0300`-`U+036F` par relecture des points de code). Une marque
        combinante sans caractère de base est fragile : un éditeur, un filtre
        `.gitattributes` ou un copier-coller peut la réordonner et **élargir ou
        vider silencieusement la classe**. Préférer l'échappement
        `/[̀-ͯ]/g`, strictement équivalent et lisible.
    11. **[MINEUR] Bornes de dates absentes** : `birthDate` accepte `"0001-01-01"`
        et `"9999-12-31"` ; `visitCreateSchema.date` accepte `"9999-12-31"`
        (vérifié). Pas un risque de sécurité, mais une date de naissance
        aberrante fausse tout tri/filtre par âge et une visite en 9999 pollue la
        timeline de l'étape 5. Ajouter un `.refine()` de plage.
    12. **[MINEUR] `?limit=` vide renvoie 400** : `z.coerce.number()` transforme
        `""` en `0`, rejeté par `.min(1)` (vérifié). Un formulaire HTML de
        l'étape 7 qui poste un champ vide déclenchera une erreur de validation
        inattendue. Prévoir un `preprocess` `"" → undefined`.
    13. **[MINEUR — dette de preuve] Le critère d'acceptation « `src/schemas/
        patient.ts` n'est dupliqué nulle part » est aujourd'hui vide de sens** :
        `grep` confirme que **personne ne l'importe encore**. La propriété
        « schéma partagé route ↔ formulaire » ne pourra être prouvée qu'aux
        étapes 4-5 et 7-8. À re-vérifier à ce moment-là, pas à considérer acquis.

  - **Réponses aux questions posées, en clair** : (a) la minimisation porte sur
    les données **traitées**, pas seulement exposées — mais ici les 6 colonnes
    lues excluent toute donnée de santé (`notes`, `email`, `birthDate`) et la
    sortie est plus étroite encore, donc le volume lu est un défaut de
    **conception/disponibilité** (point 7), **pas une fuite** ; (b) le module
    n'offre **aucun caractère générique** — la correspondance est exacte après
    normalisation sur `firstName` **et** `lastName`, ou l'égalité E.164 stricte,
    donc **pas d'extraction en masse possible** : le risque réel est le sondage
    ciblé nom→téléphone / téléphone→nom → couvert par les points 1 et 2 ;
    (c) `phone` en sortie est de la donnée patient mais **nécessaire** à la
    bannière (le réceptionniste doit pouvoir trancher) — c'est le minimum pour
    l'usage, à condition de ne jamais le rendre hors du dashboard authentifié,
    ni dans une URL, ni dans un log.
  - **Aucun fichier de projet modifié par cet audit** (hors ce Journal). Aucune
    commande git d'écriture. `DATABASE_URL` jamais affiché ; aucun secret
    imprimé. Fichier de sondage Zod écrit **hors du dépôt** (scratchpad de
    session) ; `git status --porcelain` inchangé après passage.

  - **2026-08-29 — `ortho-builder`. Étape 3, TOUR 2 — correction des 4
    constats de sévérité MAJEUR-1, MAJEUR-2, MINEUR-3, MINEUR-4. VERT.**
  - **Fichiers modifiés** (aucun fichier existant hors étape 3 touché) :
    `src/lib/patients/duplicates.ts`, `src/lib/patients/duplicates.test.ts`,
    `tests/integration/patient-duplicates.test.ts`. `src/schemas/patient.ts`
    non touché (hors périmètre de ce tour).
  - **[MAJEUR-1] Diacritiques arabes.** `DIACRITIC_MARKS_REGEX` étendu de
    `U+0300–U+036F` (seul le bloc latin avant) à `U+0300–U+036F ∪
    U+0610–U+061A ∪ U+0640 ∪ U+064B–U+0652 ∪ U+06D6–U+06ED` — exactement les
    plages demandées par l'arbitrage de l'orchestrateur. Le commentaire de
    `normalizeName()` ne prétend plus à un repliement général des
    diacritiques Unicode, seulement Latin + vocalisation/tatweel arabe, et
    cite explicitement que « Mohamed »/« Mohammed » (flou/phonétique) reste
    hors périmètre. **Preuve par test, un cas par comparaison** — les 3
    comparaisons de l'énoncé, toutes dans
    `tests/integration/patient-duplicates.test.ts` :
    1. `"Bénali"` / `"benali"` → convergent (déjà vrai avant ce tour, testé
       de nouveau explicitement en isolation).
    2. `"محمد"` / `"مُحَمَّد"` (harakat U+064B-U+0652) → **convergent**
       (divergeaient avant ce tour).
    3. `"محمد"` / `"محـمد"` (tatweel U+0640) → **convergent** (divergeaient
       avant ce tour).
  - **[MAJEUR-2] `findMany` sans `take`/`orderBy`, plafond appliqué après
    coup.** Requête scindée en deux : une requête **indexée**
    (`where: { phoneE164, anonymizedAt: null, ...excludeClause }`, exploite
    enfin `@@index([phoneE164])`) pour le critère PHONE, et le balayage
    complet — désormais avec `orderBy: { id: "asc" }` pour un ordre
    déterministe — réservé au seul critère NAME (qui a besoin de
    TypeScript). Fusion via une `Map<id, DuplicateCandidate>` : les
    correspondances PHONE sont ajoutées **en premier**, puis les
    correspondances NAME (fusionnées par `id` si le même patient matche les
    deux critères), et le plafond `MAX_CANDIDATES = 10` n'est appliqué
    **qu'après** la fusion complète (`.slice(0, MAX_CANDIDATES)`). **Pas de
    `take` sur le balayage nom** (piège explicitement évité — un `take` à
    cet endroit aurait choisi 10 lignes arbitraires avant toute comparaison
    de nom, cassant silencieusement la détection).
  - **Preuve de justesse, avec preuve de régression sur l'ancien code**
    (nouveau test `tests/integration/patient-duplicates.test.ts`, describe
    « justesse ») : 12 patients homonymes (nom normalisé identique, aucun ne
    partageant le téléphone recherché) + 1 patient partageant exactement le
    téléphone recherché mais un nom totalement différent. Appel avec le nom
    des 12 homonymes **et** le téléphone du 13ᵉ patient. **Sur le code
    corrigé** : le match PHONE est présent dans le résultat (`matchedOn`
    contient `"PHONE"`) — 6/6 verts dans ce fichier. **Sur l'ancienne
    implémentation** (restaurée temporairement en écrasant
    `duplicates.ts` avec le code d'avant ce tour, jamais commise) : le même
    test **échoue** — `expected undefined to be defined` — ainsi que les 2
    tests de diacritiques arabes (les 2 nouvelles plages n'existaient pas
    encore dans cette version). Preuve rejouée avec `npm test --
    patient-duplicates` → 3 échecs / 6 sur l'ancien code, 0 échec / 6 après
    restauration du code corrigé (`git status --porcelain` confirmé
    inchangé après la manipulation — le fichier restauré est
    **octet-identique** à la version corrigée, copié depuis le scratchpad de
    session avant l'expérience, jamais écrit ni lu depuis `src/` pendant la
    fenêtre où l'ancien code était en place).
  - **[MINEUR-3] Test de liste blanche tautologique.** `DUPLICATE_SELECT`
    **exporté**. `duplicates.test.ts` — le test « returns only the
    whitelisted fields » assert désormais `Object.keys(DUPLICATE_SELECT)`
    (ce qui sort réellement de Postgres, `not.toContain("notes"/"email"/
    "birthDate")`) **et** que les clés du résultat retourné correspondent à
    `DUPLICATE_SELECT` moins `phoneE164` (jamais renvoyé) plus `matchedOn`
    (calculé, jamais lu en base) — les deux moitiés de la minimisation sont
    désormais couvertes séparément. **Non-vacuité prouvée par mutation** :
    `notes: true` ajouté temporairement à `DUPLICATE_SELECT` → `npm test --
    duplicates` → **1 test rouge** exactement sur cette assertion
    (`AssertionError: expected [...] to not include 'notes'`), 9/10 restants
    verts (isolation correcte). Retiré ensuite, relu ligne à ligne pour
    confirmer l'identité avec l'original, `npm test -- duplicates` → 10/10
    (avant les ajouts de ce tour) puis 14/14 (après, avec les 4 nouveaux
    tests — 3 Arabe + 1 justesse — comptés dans les fichiers d'intégration,
    pas ce fichier unitaire).
  - **[MINEUR-4] Classe de caractères en marques combinantes littérales.**
    Remplacée par des échappements `\uXXXX` explicites :
    `/[̀-ͯؐ-ؚـً-ْۖ-ۭ]/g`,
    appliqué à **toutes** les plages y compris les 4 nouvelles ajoutées pour
    MAJEUR-1 (pas seulement l'ancienne plage latine). **Piège rencontré et
    évité en cours de route, à noter pour le prochain agent** : composer une
    classe de caractères Unicode par édition de texte libre (ou en recopiant
    des points de code d'un énoncé) risque de produire les **vrais**
    caractères combinants au lieu du texte d'échappement `\uXXXX` — exactement
    le défaut que MINEUR-4 demande de corriger. Vérifié à la main avec `od -c`
    sur la ligne de regex avant de considérer la correction faite (deux
    tentatives ont produit des caractères combinants réels avant la bonne,
    écrites puis jetées) ; la ligne finale a été confirmée `\`, `u`, `0`, `3`,
    `0`, `0`… octet par octet, pas seulement relue à l'écran (un éditeur/
    terminal peut réafficher des échappements comme des glyphes composés,
    ce qui trompe une relecture visuelle).
  - **Résultats des commandes** :
    - `npm test -- patient-duplicates` → **6/6 verts** (2 tests d'origine +
      3 nouveaux tests diacritiques Arabe/Latin explicites + 1 nouveau test
      de justesse).
    - `npm test -- duplicates` → **14/14 verts** (6 + 8 unitaires
      colocalisés, dont le test de liste blanche renforcé).
    - `npm test` complet → **371/371 verts**, 39 fichiers (367 avant ce
      tour + 4 nouveaux : 3 diacritiques + 1 justesse). `npm run typecheck`
      → OK. `npm run lint` → OK.
  - **Sortie toujours minimale, reconfirmé** : `grep -n
    "notes\|email\|birthDate\|console\."` sur `duplicates.ts` → 3 occurrences,
    **toutes dans des commentaires** (lignes 75, 91, 101), aucune dans le
    code exécuté ni dans `DUPLICATE_SELECT`.
  - **Cible base** : `DATABASE_URL` forcé sur `TEST_DATABASE_URL`
    (`*localhost*` contrôlé) avant chaque commande. Aucun secret affiché.
  - **Réutilisé** : `normalizePhoneE164()` (inchangé, toujours le seul point
    de normalisation téléphone), `getPrisma()`, le patron `describe`/`it`
    déjà en place dans les deux fichiers de test. Aucune réécriture de
    normalisation téléphone.
  - **Non fait volontairement** : les 5 points « À traiter dans les étapes
    suivantes » du Journal `ortho-security` (409 non journalisé, absence de
    limitation de débit, `422 INVALID_PHONE`, `active:false` réservé ADMIN,
    `parsed.data` non déstructuré) — explicitement hors scope de ce tour
    (aucune route n'existe encore), rappelés dans la fiche d'étape 3
    remise par l'orchestrateur. [MINEUR-9] (nom réduit à `""` après
    normalisation), [MINEUR-11] (bornes de dates), [MINEUR-12] (`?limit=`
    vide) et [MINEUR-13] (dette de preuve sur la non-duplication du schéma)
    non traités : hors des 4 corrections demandées pour ce tour.
  - **Signalé sans y toucher** : rien de nouveau — les contraintes de relais
    pour les étapes 4/5 restent telles que documentées par `ortho-security`
    ci-dessus, inchangées par ce tour.
  - **Aucune case cochée dans `tasks/todo.md`. Aucune commande git
    d'écriture.**

### Étape 4 — `GET` + `POST /api/admin/patients` (liste, recherche, création)
- [ ] Statut : à faire
- **But** : la première moitié de l'API — lister/rechercher les patients et en créer un,
  avec l'avertissement de doublon et son acquittement.
- **Agents recommandés** : `ortho-backend`, `ortho-security`, `ortho-tester`.
- **Fichiers à créer / modifier** :
  - `src/app/api/admin/patients/route.ts` (créer)
  - `tests/authz-matrix.test.ts` (2 lignes ajoutées)
  - `tests/integration/patients-api.test.ts` (créer)
- **Ce qu'il faut faire** :
  1. `GET` — `requireStaff(request)` (les **deux** rôles). Valider les `searchParams`
     avec `patientListQuerySchema`. Recherche `q` : `OR` sur `firstName` / `lastName`
     (`contains`, `mode: "insensitive"`) **et** sur `phoneE164` si `normalizePhoneE164(q)`
     renvoie une valeur (sinon `contains` sur `phoneE164` du `q` réduit à ses chiffres).
     Filtre `active` (défaut : `true` seulement). `count` + `findMany` en `Promise.all`,
     tri `[{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }]`, pagination
     `take`/`skip` identique à la route audit.
     **Liste blanche de la réponse** : `id, firstName, lastName, phone, active,
     anonymizedAt, createdAt` (+ `lastAppointmentAt` si trivial à obtenir) —
     **jamais** `notes`, `email` ni `birthDate` dans la liste.
  2. `POST` — `requireStaff(request)` (les deux rôles) → `assertSameOriginStrict` →
     `patientCreateSchema.safeParse(await request.json())` → `normalizePhoneE164(phone)` ;
     si `null` → 400 `INVALID_PHONE` (« Numéro de téléphone algérien invalide. »).
     Puis `findDuplicateCandidates()` : si des candidats existent **et**
     `duplicateAcknowledged !== true` → **409** avec
     `{ error: { code: "DUPLICATE_CANDIDATES", message }, duplicates: [...] }`
     (décision 1 du §Contexte). Sinon création avec `phone` (tel que saisi), `phoneE164`,
     `createdById = guard.user.id`, `updatedById = guard.user.id`.
  3. Audit du `POST` : `logAction({ type: AuditActorType.STAFF, userId: guard.user.id },
     AuditAction.PATIENT_CREATED, "Patient", patient.id,
     { acknowledgedDuplicates: <nombre de candidats acquittés> },
     getClientIp(request.headers))`. **`detail` ne contient aucun nom, téléphone ni
     email** — uniquement un compteur.
     Le `GET` liste **ne journalise pas** (voir §Risques).
  4. Renvoyer via `withRefreshedSession(ok(...), guard)`. Le `POST` réussi renvoie **201**
     avec la fiche minimale créée.
  5. Ajouter les 2 lignes dans `ROUTES` de `tests/authz-matrix.test.ts` :
     `GET /api/admin/patients` (`allowed: [ADMIN, RECEPTIONIST]`, ok 200) et
     `POST /api/admin/patients` (`allowed: [ADMIN, RECEPTIONIST]`, `okStatus: 400` —
     corps vide → la validation échoue **après** la garde).
- **Critères d'acceptation** :
  - `npm test -- authz-matrix` vert **sans avoir touché au filtre de scan** ; les 8
    nouvelles combinaisons (2 routes × 4 acteurs) passent.
  - `npm test -- patients-api` vert, couvrant : anonyme → 401 ; réceptionniste →
    création OK ; téléphone invalide → 400 `INVALID_PHONE` ; création d'un homonyme sans
    acquittement → **409 `DUPLICATE_CANDIDATES`** avec un tableau `duplicates` non vide
    **et aucun patient créé en base** ; même requête avec `duplicateAcknowledged: true`
    → **201** et patient créé ; `createdById` et `updatedById` égaux à l'id du staff
    appelant ; recherche `?q=` retrouvant un patient par son nom **et** par un format de
    téléphone différent de celui saisi.
  - Une ligne `PATIENT_CREATED` est écrite avec `actorType = "STAFF"`, le bon `userId`,
    et un `detail` qui **ne contient ni nom ni téléphone** (assertion explicite).
  - `curl` manuel : `GET /api/admin/patients` sans cookie → `401` avec le corps
    `{"error":{"code":"UNAUTHENTICATED",...}}` et **aucune donnée**.
  - `npm run typecheck` + `npm run lint` verts, `npm test` complet vert.
- **Vigilance sécurité** : **oui — auth, rôles, données patient, entrées utilisateur,
  SQL (via Prisma), CSRF**. Le `q` de recherche est une entrée utilisateur : il passe par
  Zod et par les opérateurs Prisma (jamais de `$queryRawUnsafe`). Le `q` n'est écrit dans
  aucun log. `ortho-security` **obligatoire** sur cette étape.
- **Journal** :
  - **2026-08-29 — `ortho-builder` (agent générique, aucun `ortho-backend` n'existe
    dans ce dépôt). Étape 4 terminée. VERT.**
  - **Fichiers créés** : `src/app/api/admin/patients/route.ts`,
    `tests/integration/patients-api.test.ts`. **Fichier modifié** :
    `tests/authz-matrix.test.ts` (import + 2 lignes `ROUTES`, rien d'autre).
    Aucun fichier hors périmètre touché (`git status --porcelain` confirmé :
    seuls ces 3 fichiers + les fichiers déjà neufs/non-committés des étapes
    1-3 apparaissent).
  - **Contradiction du relais, tranchée comme demandé par l'orchestrateur** :
    le point 3 de la fiche (« Le GET liste ne journalise pas ») est périmé —
    remplacé par le §Exigences point 6 (arbitrage utilisateur du 2026-08-28,
    postérieur). Le GET journalise `PATIENT_RECORD_VIEWED` avec
    `detail: { scope: "list", resultCount }`, jamais `q`. Prouvé par un test
    dédié (voir plus bas).
  - **Les 5 conditions de recevabilité issues de l'audit de l'étape 3, une par
    une** :
    1. **409 journalisé.** `PATIENT_RECORD_VIEWED` sur `entityId:
       candidates[0]?.id ?? "-"`, `detail: { scope: "duplicate-check",
       candidateCount, matchedOn }` — jamais le nom, le téléphone, ni la
       requête soumise. Test dédié : après un 409, `JSON.stringify(detail)`
       ne contient ni le prénom ni le nom ni aucun des deux numéros de
       téléphone impliqués (celui du candidat existant, celui soumis).
    2. **Limitation de débit sur le POST**, clé
       `staff:${guard.user.id}:patients-write` (jamais l'IP — raison
       documentée dans le commentaire d'en-tête du fichier : un cabinet est
       derrière une IP publique unique). `checkRateLimit`/`RateLimitError`
       réutilisés tels quels (`@/lib/security/rateLimit`), même patron que
       `change-password` (429 `RATE_LIMITED`). Limite choisie : 30
       requêtes/5 min — généreuse pour une journée chargée de créations,
       mais borne le rejeu de la sonde 409 (id/nom/téléphone). Placée
       **avant** le parsing JSON (donc avant tout accès DB via
       `findDuplicateCandidates`), ce qui rend le test de non-vacuité rapide
       (31 requêtes au corps volontairement invalide, aucune n'écrit rien).
    3. **`MAX_CANDIDATES = 10`** : non touché, `src/lib/patients/duplicates.ts`
       non modifié (interdit par la fiche) ; aucun paramètre client ne le
       pilote (la route ne lit aucun `searchParams`/corps pour ce plafond).
    4. **Confinement** : `duplicates` ne sort que dans le corps JSON de la
       réponse 409 du dashboard authentifié (jamais dans une URL — c'est un
       corps de POST, pas un `searchParams` — ni dans un log : le `logAction`
       du même chemin ne contient que des compteurs/énumérations, jamais le
       tableau `duplicates` lui-même).
    5. **`parsed.data` jamais passé tel quel à Prisma.** J'ai choisi une
       variante plus stricte que la déstructuration suggérée par la fiche :
       `patient.create({ data: {...} })` énumère chaque champ Prisma
       explicitement (`firstName`, `lastName`, `phone`, `phoneE164`, `email`,
       `birthDate`, `notes`, `messagingOptOut`, `whatsappOptIn`,
       `preferredLocale`, `createdById`, `updatedById`) plutôt que
       `{ ...patientData }` après avoir retiré `duplicateAcknowledged`. Une
       déstructuration-puis-spread aurait résolu le bug documenté
       aujourd'hui, mais laisse la porte ouverte au même bug demain : si
       `patientCreateSchema` gagne un futur champ qui n'est pas une colonne
       `Patient`, un `{ ...patientData }` le repasserait tel quel à Prisma
       sans qu'aucun test ne le voie venir avant la prochaine
       `PrismaClientValidationError`. L'énumération explicite empêche
       structurellement cette classe de régression — documenté dans le
       commentaire du fichier, signalé ici comme un écart assumé et motivé
       par rapport à la lettre de la consigne (pas silencieux).
  - **Téléphone invalide — 422, pas 400, choix documenté.** Lu
    `src/app/api/appointments/route.ts:77-84` avant de trancher : c'est
    l'unique précédent du dépôt pour « le téléphone ne se normalise pas », et
    il renvoie `422 INVALID_PHONE` avec le message
    "Le numéro ne correspond pas à un numéro algérien valide." (adapté ici en
    "Numéro de téléphone algérien invalide.", le libellé choisi par la fiche
    d'étape 4 — seul le code de statut suit le précédent, pas le libellé). La
    cohérence du dépôt prime sur la supposition 400 de la fiche. Ceci est
    distinct de la ligne de matrice `okStatus: 400`, qui couvre le corps vide
    (échec Zod, après la garde d'authentification) — un scénario différent,
    prouvé par un test séparé (« rejects a phone that does not normalize…
    with 422 ») qui vérifie en plus qu'aucune écriture n'a eu lieu.
  - **Ordre d'exécution, respecté à la lettre** : `requireStaff` →
    `assertSameOriginStrict` (POST uniquement, code 403
    `CSRF_ORIGIN_MISMATCH` — pas `FORBIDDEN`, choix délibéré : `FORBIDDEN` est
    déjà le code que `requireStaff` renvoie pour un rôle refusé ; réutiliser
    ce code pour un échec CSRF aurait rendu les deux causes indistinguables
    dans `/admin/audit` et pour un futur débogage) → limitation de débit →
    Zod → normalisation téléphone → détection de doublons (lecture DB) →
    création. Aucun 404/400 ne précède un 401/403 : le test « rejects an
    anonymous caller… creates nothing » et le test CSRF vérifient chacun un
    statut avant tout accès DB d'écriture.
  - **Liste blanche GET** : `id, firstName, lastName, phone, active,
    anonymizedAt, createdAt` — exactement la liste de la fiche, rien de plus
    (pas de `lastAppointmentAt` : la fiche le qualifiait de facultatif « si
    trivial », et l'obtenir proprement demanderait une requête `Appointment`
    supplémentaire par patient ou un `groupBy` — pas trivial, donc omis).
    Prouvé par un test qui insère un patient avec `notes`/`email`/`birthDate`
    réels et vérifie `Object.keys(...)` exactement.
  - **Recherche `q`** : OR sur `firstName`/`lastName` (`contains`,
    `insensitive`) toujours présent ; branche téléphone en plus si
    `normalizePhoneE164(q)` réussit, sinon `contains` sur les chiffres bruts
    de `q` (jamais de clause vide qui matcherait tout). Filtre `active` :
    `true` par défaut, `"all"` retire le filtre, `"false"` liste les
    désactivés. Tri `[{lastName:"asc"},{firstName:"asc"},{id:"asc"}]`,
    pagination identique à la route audit (bornes du schéma déjà posées à
    l'étape 3).
  - **Matrice d'autorisation** : 2 lignes ajoutées, `handler` référence
    directement les exports (`patientsListRoute`/`patientsCreateRoute`, pas
    de wrapper fléché) pour satisfaire le contrôle `row.handler !==
    routeModule[method]` du tour 3 de l'étape 2. GET sans `okStatus` (défaut
    200) ; POST avec `okStatus: 400` (corps vide envoyé par `requestAs()` →
    Zod échoue après la garde). Le filtre de scan n'a pas été touché.
  - **Résultats des commandes** :
    - `npm run typecheck` → OK. `npm run lint` → OK (aucun warning ; le choix
      d'énumérer les champs Prisma explicitement plutôt que de déstructurer
      évite au passage tout risque d'avertissement `no-unused-vars` sur une
      variable `duplicateAcknowledged` jetée).
    - `npx vitest run patients-api` → **14/14 verts**.
    - `npx vitest run authz-matrix` → **23/23 verts** (15 avant + 8 nouvelles
      combinaisons : 2 routes × 4 acteurs).
    - `npm test` complet → **393/393 verts**, 40 fichiers (371 avant + 14 +
      8 = 393, cohérent).
  - **Preuve curl manuelle demandée par le format de réponse** : serveur
    `npm run dev` démarré localement, requête sans cookie :
    `GET /api/admin/patients` → `HTTP/1.1 401 Unauthorized`, corps
    `{"error":{"code":"UNAUTHENTICATED","message":"Session invalide ou
    expirée."}}`, aucune donnée. Sûr même contre un `DATABASE_URL` de
    production : `requireStaff` renvoie 401 dès l'échec de vérification du
    cookie de session, avant toute requête Prisma (aucun accès base sur ce
    chemin). Serveur arrêté immédiatement après (port 3000 libéré, vérifié
    par `netstat`).
  - **Preuve que `q` n'apparaît jamais dans `AuditLog`** (test « audits the
    read as PATIENT_RECORD_VIEWED, scope 'list', and NEVER writes q to the
    audit log ») : recherche avec `q=Zeroual` (nom du patient créé pour le
    test), assertion `JSON.stringify(audit.detail)` ne contient pas la
    chaîne "Zeroual" — pas seulement l'absence d'une clé `q`, l'absence de la
    sous-chaîne n'importe où dans le JSON sérialisé.
  - **Preuve que `PATIENT_CREATED.detail` ne contient ni nom ni téléphone**
    (test « audits PATIENT_CREATED with a detail that never contains the
    patient's name or phone ») : `JSON.stringify(audit.detail)` ne contient
    ni "Rania", ni "Boumediene", ni "0550100012", ni le E.164 dérivé —
    `detail` réel : `{ acknowledgedDuplicates: 0 }`.
  - **Preuve du 409 sans création en base** : `patient.count()` avant/après
    identique dans le test « returns 409 DUPLICATE_CANDIDATES for a homonym
    without acknowledgement, and creates nothing » — `duplicates` non vide et
    contient bien l'id du patient existant.
  - **Preuve du 201 avec acquittement** : même scénario (homonyme « Sofiane
    Cherif »), rejoué avec `duplicateAcknowledged: true` → `patient.count()`
    augmente de 1, statut 201.
  - **Preuve que `parsed.data` n'est jamais passé tel quel à Prisma** :
    lecture directe de `data: {...}` dans `route.ts` — chaque champ est
    nommé, `duplicateAcknowledged` n'apparaît nulle part dans l'appel
    `patient.create`. Aucun test dédié à cette preuve négative (elle est
    structurelle, pas comportementale) — vérifiable par grep :
    `grep -n "duplicateAcknowledged" src/app/api/admin/patients/route.ts`
    ne renvoie que le commentaire et la lecture du champ pour la condition
    `!== true`, jamais dans l'objet `data`.
  - **Réutilisé, rien réécrit** : `requireStaff`/`withRefreshedSession`/
    `assertSameOriginStrict` (`@/lib/auth/guard`), `findDuplicateCandidates`
    (`@/lib/patients/duplicates`, non modifié), `patientCreateSchema`/
    `patientListQuerySchema` (`@/schemas/patient`, non modifié, importés tels
    quels), `normalizePhoneE164` (`@/lib/phone/normalize`), `logAction`
    (`@/lib/audit/logAction`), `getClientIp` (`@/lib/security/clientIp`),
    `checkRateLimit`/`RateLimitError` (`@/lib/security/rateLimit`),
    `ok`/`errorResponse` (`@/lib/api/http`, non modifié — le 409 est
    construit à la main avec `Response.json(...)` comme prescrit), `getPrisma`
    (`@/lib/db`). Route audit prise comme calque pour la forme
    `count`+`findMany` en `Promise.all`, le tri secondaire, et la pagination.
  - **Non fait volontairement** : aucune route `/[id]` (étape 5) ; aucun
    composant React (étapes 7-8) ; `tests/setup.ts` non touché ; aucune case
    cochée dans `tasks/todo.md` ; aucune commande git d'écriture ; pas de
    `lastAppointmentAt` dans la liste blanche (facultatif, non trivial —
    raison ci-dessus).
  - **Signalé sans y toucher** : rien de nouveau à signaler au-delà de ce qui
    est déjà consigné dans ce relais par les étapes 1-3 (dette CSRF de la
    matrice, `deactivated` toujours RECEPTIONIST, etc. — toutes
    pré-existantes, non aggravées par cette étape). `DATABASE_URL` jamais
    affiché ; cible base forcée sur `TEST_DATABASE_URL` (`*localhost*`
    contrôlé) avant chaque commande touchant la base ; le seul accès réseau
    hors base (le curl de preuve) ne touche aucune donnée patient et n'a
    déclenché aucune requête Prisma, donc sûr même avec `DATABASE_URL` de
    production dans l'environnement du serveur dev.
  - **Verdict : VERT.**
  - **2026-08-29 — `ortho-tester`. Vérification de l'étape 4. VERT.**
    - **Cible base confirmée locale** avant toute commande (`TEST_DATABASE_URL`,
      contrôle `*localhost*`). Aucun secret affiché.
    - **Résultats** : `npm test` → **395/395** (40 fichiers ; 393 rapportés par
      `ortho-builder` + 2 tests que j'ai ajoutés, voir plus bas).
      `npx vitest run patients-api` → **16/16** (14 + 2 ajoutés).
      `npx vitest run authz-matrix` → **23/23** (inchangé, confirmé
      indépendamment). `npm run typecheck` → OK. `npm run lint` → OK.
    - **Critères d'acceptation de l'étape 4, un par un** :
      1. `authz-matrix` vert, 8 nouvelles combinaisons (2 routes × 4 acteurs)
         → **prouvé**, relancé indépendamment, 23/23.
      2. `patients-api` vert couvrant anonyme→401, création réceptionniste OK,
         téléphone invalide→422 `INVALID_PHONE`, 409 sans création,
         acquittement→201, `createdById`/`updatedById`, recherche par nom et
         par format de téléphone différent → **prouvé**, tous les cas listés
         sont présents et verts, relus un par un dans
         `tests/integration/patients-api.test.ts`.
      3. Ligne `PATIENT_CREATED` avec `actorType STAFF`, bon `userId`, `detail`
         sans nom ni téléphone → **prouvé** (test dédié, assertion
         `JSON.stringify` négative).
      4. `curl` manuel anonyme → 401, aucune donnée → **repris tel que rapporté
         par `ortho-builder`** (serveur dev lancé, requête sans cookie, corps
         générique, port libéré ensuite) ; non rejoué par moi (la preuve écrite
         est déjà suffisamment détaillée et le chemin de code — `requireStaff`
         en toute première instruction, aucune requête Prisma avant le 401 —
         est vérifié structurellement au point 4 ci-dessous).
      5. `typecheck`/`lint`/`npm test` complets verts → **prouvé**.
    - **Non-vacuité des 3 tests critiques (point 3 de ma consigne) — les trois
      mutations, rejouées moi-même, chacune restaurée et confirmée par
      `git status --porcelain` vide sur `src/app/api/admin/patients/route.ts`
      (fichier non suivi par git, donc vérifié par relecture + `grep` de
      marqueurs de mutation, aucun résultat après retour à l'état propre)** :
      1. **409 sans création** : ajout temporaire d'un `patient.create(...)`
         dans la branche 409, avant le `return`. `npx vitest run patients-api`
         → **1 échec** : `returns 409 DUPLICATE_CANDIDATES for a homonym
         without acknowledgement, and creates nothing` —
         `AssertionError: expected 2 to be 1`. Mutation retirée, retest → vert.
      2. **Acquittement ignoré** : condition changée en
         `if (candidates.length > 0 && false)`. `npx vitest run patients-api`
         → **2 échecs**, exactement les deux tests du chemin 409 (« returns
         409… » et « audits the 409 duplicate-check… »), le test « 201 avec
         `duplicateAcknowledged: true` » restant vert sans en être la preuve
         (il attendait déjà 201). Mutation retirée, retest → vert.
      3. **Donnée patient dans le journal** : `q` ajouté au `detail` du
         `logAction` de `GET`. `npx vitest run patients-api` → **1 échec** :
         « audits the read as PATIENT_RECORD_VIEWED… and NEVER writes q… » —
         `expected '{"q":"Zeroual",...}' not to contain 'Zeroual'`. Mutation
         retirée, retest → vert.
      Les trois tests mordent réellement — aucun n'est vacant.
    - **Point 4 de ma consigne — ordre des gardes / non-divulgation, vérifié
      en profondeur** : `requireStaff` est la toute première instruction des
      deux handlers (`GET`/`POST`), et ne touche que la table `User` — aucune
      lecture `Patient` avant un 401. La matrice d'autorisation (23/23) prouve
      déjà le **statut** 401 pour `anonymous` et `deactivated` sur les deux
      routes patients. Le corps n'était en revanche testé que pour le cas
      `anonymous` (le test d'origine « rejects an anonymous caller with 401
      and no data »). **Gap trouvé et test ajouté** :
      `tests/integration/patients-api.test.ts`, nouveau cas « rejects a
      deactivated receptionist with the SAME 401 body as an anonymous caller,
      even when the search matches a real patient » — crée un patient réel
      nommé, une réceptionniste désactivée envoie `?q=<son nom>`, et j'assert
      que (a) le statut est 401, (b) le corps est **strictement égal** (`toEqual`)
      à celui obtenu en anonyme, (c) le corps sérialisé ne contient ni l'id ni
      le prénom ni le nom du patient. **Passe en vert** — confirme qu'aucune
      réponse d'échec d'authentification ne révèle l'existence ou l'absence
      d'un patient, pour un acteur désactivé et pas seulement anonyme.
    - **Point 5 de ma consigne — liste blanche `GET`** : déjà couvert par le
      test d'origine « returns the whitelisted fields only (no notes, email,
      birthDate) », qui insère un patient avec les 3 champs sensibles réels et
      assert `Object.keys(...)` **exactement égal** à la liste blanche
      (`active, anonymizedAt, createdAt, firstName, id, lastName, phone`) —
      pas une assertion `not.toContain` seule, donc pas tautologique : un
      champ en trop **ou** en moins ferait échouer le test. Aucun ajout
      nécessaire.
    - **Point 6 de ma consigne — recherche `q` et diacritiques arabes,
      réponse franche** : la recherche `GET /api/admin/patients?q=` **ne
      replie PAS les diacritiques arabes** (vocalisation/harakat ni tatweel).
      C'est documenté honnêtement dans le commentaire du module
      `duplicates.ts:94-97` (« Postgres ILIKE folds case only, never
      diacritics ») pour le moteur de doublons — mais la route de liste
      elle-même n'a **aucun commentaire équivalent**, alors que son
      comportement est identique : `contains`/`mode:"insensitive"` est un
      ILIKE Postgres brut, sans passage par `normalizeName()`
      (`@/lib/patients/duplicates`, utilisé uniquement à l'écriture). **Test
      écrit et vérifié moi-même** (pas supposé) :
      `tests/integration/patients-api.test.ts`, nouveau cas « documents an
      HONEST limitation: q search does NOT fold Arabic diacritics ». Patient
      stocké `lastName: "محمد"` (non vocalisé). Recherche par la même chaîne
      exacte → **trouvé** (`total: 1`, ILIKE fold la casse, sans effet ici
      car pas de casse en arabe). Recherche par `"مُحَمَّد"` (harakat
      U+064B–U+0652, codepoints vérifiés indépendamment avec un script Node
      dédié — `U+64F, U+62D, U+64E, U+645, U+64E, U+651, U+62F`, distincts du
      texte de base) → **`total: 0`, non trouvé**. Recherche par
      `"محـمد"` (tatweel U+0640, vérifié de même) → **`total: 0`, non
      trouvé**. **Réponse à la question posée : NON, la recherche par nom
      arabe vocalisé ne fonctionne pas sur cette route** — seule la
      correspondance textuelle exacte (à la casse près) fonctionne. C'est une
      asymétrie avec la détection de doublons (étape 3), qui elle replie ces
      diacritiques en TypeScript avant comparaison. Le comportement est
      **documenté et testé**, mais reste une limitation fonctionnelle réelle :
      un(e) réceptionniste tapant un nom vocalisé ne retrouvera pas un patient
      enregistré sans vocalisation, et vice versa. Non corrigé (hors mandat de
      cette vérification — corriger nécessiterait soit d'appliquer
      `normalizeName()` en TypeScript sur un balayage complet comme le fait
      déjà `findDuplicateCandidates`, ce qui reproduirait le coût de balayage
      documenté en étape 3, soit une colonne normalisée indexée, donc une
      migration — signalé comme dette ci-dessous, pas corrigé silencieusement.
    - **Réutilisé, rien réécrit** : `getPrisma`, `cookieFor`/`createStaff`/
      `getRequest` déjà présents dans le fichier de test, patron `describe`/
      `it` existant. Aucune modification de `src/app/api/admin/patients/route.ts`,
      `src/schemas/patient.ts` ni `src/lib/patients/duplicates.ts` en dehors
      des mutations temporaires, toutes annulées et vérifiées.
    - **Fichiers modifiés par cette vérification** :
      `tests/integration/patients-api.test.ts` (+2 tests, 14→16), ce fichier
      relais (Journal). `src/app/api/admin/patients/route.ts` : mutations
      temporaires appliquées puis retirées (3 fois), état final identique à
      ce qui a été relu au début de la vérification — confirmé par absence de
      tout marqueur de mutation (`grep`) et par le retour au vert des 3 tests
      concernés. Aucune case cochée dans `tasks/todo.md`. Aucune commande git
      d'écriture.
    - **Dette signalée, non corrigée (hors mandat de cette vérification)** :
      1. **[MINEUR — étape 4/dette documentaire]** `src/app/api/admin/patients/route.ts`
         ne porte aucun commentaire équivalent à celui de `duplicates.ts:94-97`
         expliquant que `q` ne replie pas les diacritiques arabes/latins. Un
         futur agent modifiant cette route sans relire `duplicates.ts` pourrait
         supposer, à tort, un comportement cohérent avec la détection de
         doublons. À ajouter au passage de la prochaine modification de ce
         fichier.
      2. **[Rappel, déjà signalé à l'étape 3, toujours vrai]** Le rapprochement
         flou (`Mohamed`/`Mohammed`) reste hors périmètre — sans lien avec la
         limitation ci-dessus, qui porte sur les diacritiques exacts, pas la
         translittération.
    - **Ligne de matrice d'autorisation (`tests/authz-matrix.test.ts`)** :
      déjà due depuis Task 12 (le fichier existe, `ortho-builder` y a ajouté
      les 2 lignes prescrites) — rien d'autre dû ici, la dette « matrice
      d'autorisation » mentionnée par la consigne générale de l'agent ne
      s'applique pas à cette étape (le fichier existe déjà depuis la Tâche 12,
      contrairement à ce qu'annonce ma fiche de rôle générique).
    - **Verdict : VERT.**
  - **2026-08-29 — `ortho-builder`. TOUR 2 — correction du défaut BLOQUANT
    « mélange de dossiers de santé » remonté par `ortho-security`. VERT.**
    - **Contexte** : `upsertPatient()` (`src/lib/booking/createBooking.ts`)
      résolvait un patient sur `phoneE164` **seul**, `orderBy: createdAt
      desc`. Deux fiches partageant un numéro (cas familial légitime — la
      colonne n'est pas `@unique`) faisaient qu'une réservation publique
      écrasait l'identité de la fiche **la plus récente**, quel que soit le
      nom saisi — mélange silencieux de dossiers de santé, sans trace. La
      route admin (`POST /api/admin/patients`) n'avait par ailleurs qu'un
      seul acquittement (`duplicateAcknowledged`) pour deux gestes distincts :
      « c'est un homonyme » et « ce numéro est partagé ».
    - **Décision utilisateur appliquée : option B** — les deux parties sont
      obligatoires, le partage de numéro n'est jamais interdit (aucune
      contrainte `@unique`, aucune migration).
    - **Fichiers modifiés** :
      1. `src/lib/patients/duplicates.ts` — `normalizeName()` **exportée**
         (non réécrite), avec un commentaire pointant vers son nouvel appelant.
      2. `src/schemas/patient.ts` — `phoneSharingAcknowledged: z.boolean()
         .optional().default(false)` ajouté à `patientCreateSchema`, distinct
         de `duplicateAcknowledged`.
      3. `src/app/api/admin/patients/route.ts` (Partie 1) — les candidats de
         `findDuplicateCandidates()` sont désormais scindés en `nameMatches`
         (`matchedOn.includes("NAME")`) et `phoneMatches`
         (`matchedOn.includes("PHONE")`) :
         - `nameMatches.length > 0 && duplicateAcknowledged !== true` → 409
           `DUPLICATE_CANDIDATES` (comportement existant, inchangé).
         - `phoneMatches.length > 0 && phoneSharingAcknowledged !== true` →
           **nouveau** 409 `PHONE_ALREADY_REGISTERED`, message « Ce numéro
           est déjà utilisé par un autre patient. Confirmez qu'il s'agit d'un
           téléphone partagé. », corps `{ error, duplicates: phoneMatches }`.
         - Journalisé comme l'autre branche : `PATIENT_RECORD_VIEWED`,
           `detail: { scope: "phone-sharing-check", candidateCount,
           matchedOn }` — compteurs et énumérés uniquement, jamais un nom, un
           téléphone ni `q` (prouvé par test, voir plus bas).
         - Un candidat qui matche NAME **et** PHONE exige les **deux**
           acquittements (lecture littérale de la fiche : « si au moins un
           candidat a PHONE dans son matchedOn » — pas seulement les
           candidats phone-only) — plus strict que nécessaire dans ce cas
           rare, assumé, pas testé séparément (aucun scénario du plan ne
           l'exige).
      4. `src/lib/booking/createBooking.ts` (Partie 2, fichier Tâche 6,
         modification **autorisée explicitement par l'utilisateur**) —
         `upsertPatient()` : `findFirst({phoneE164}, orderBy: createdAt
         desc)` → `findMany({phoneE164}, orderBy: createdAt desc)` puis
         `.find()` sur le premier dont `normalizeName(firstName)` **et**
         `normalizeName(lastName)` correspondent à l'entrée. Match → `update`
         (comme avant). Aucun match → `create` (nouvelle fiche, jamais
         d'écrasement d'un inconnu). `active: true` **retiré** de l'objet
         `shared` passé à `update` — une fiche `active:false` reste
         `active:false` après une réservation publique (le `@default(true)`
         du schéma couvre toujours la création d'une fiche neuve).
    - **Preuve n°1 — mélange de dossiers, échoue sur l'implémentation
      actuelle puis passe au vert après correction** (méthode : `git stash
      push` des 4 fichiers ci-dessus, execution du test, `git stash pop`,
      re-exécution — pas une simple relecture) :
      - Test ajouté : `tests/integration/create-booking.test.ts`, « resolves
        a shared-phone booking by NAME, not by recency: does not mix up two
        family members' records ». Deux fiches créées directement en base,
        même `phoneE164`, prénoms différents (« Amine Belaid » créé
        **avant** « Yacine Belaid »), chacune avec un marqueur `notes`
        distinct. Réservation publique avec le numéro partagé et le nom
        « Amine Belaid ».
      - **Sur l'implémentation non corrigée** : `git show
        HEAD:src/lib/booking/createBooking.ts` restauré temporairement →
        `npx vitest run create-booking -t "does not mix up"` →
        **1 échec** : `expected 'cmtel6pxm0003f8um7tgiabg2' [id de Yacine] to
        be 'cmtel6pxk0002f8umykmlwml3' [id d'Amine]` — la réservation a
        résolu sur la fiche la **plus récente** (Yacine), pas sur le nom
        saisi (Amine). C'est exactement le mélange décrit par
        `ortho-security`. Fichier restauré ensuite (`cp` depuis une copie
        de sauvegarde), diff re-vérifié par `grep normalizeName` (présent).
      - **Après correction** : même test → **vert** ; `familyMember1`
        (Amine) résolu et mis à jour, `familyMember2` (Yacine) **inchangé**
        (`firstName`, `lastName`, `notes` tous identiques à la création), 2
        fiches au total (aucune 3ᵉ créée), `appointment.patientId` pointe
        sur Amine.
    - **Preuve n°2 — Partie 1, 409/201** : deux tests ajoutés dans
      `tests/integration/patients-api.test.ts` :
      - « returns 409 PHONE_ALREADY_REGISTERED for a phone-only match
        (different name) without phoneSharingAcknowledged, and creates
        nothing » → 409, code `PHONE_ALREADY_REGISTERED`, `duplicates`
        contient l'id du candidat, `patient.count()` inchangé.
      - « the same phone-sharing request with phoneSharingAcknowledged:
        true creates the second patient (201), sharing the phone » → 201,
        `patient.count()` +1, les deux fiches (existante + nouvelle)
        partagent bien le même `phoneE164`.
      - Un 3ᵉ test audite la branche : « audits the phone-sharing 409 as
        PATIENT_RECORD_VIEWED, scope 'phone-sharing-check', with a detail
        that never contains a name or phone » — `JSON.stringify(detail)` ne
        contient ni les deux prénoms, ni les deux noms, ni le téléphone.
      - Les tests NAME-only existants (« returns 409 DUPLICATE_CANDIDATES
        for a homonym… », « …duplicateAcknowledged: true creates… ») restent
        verts **sans modification** : ils utilisent des numéros différents,
        donc `phoneMatches.length === 0`, la nouvelle branche ne s'active
        jamais pour eux — confirmé en relisant le fichier, pas seulement en
        les relançant.
    - **Preuve n°3 — nom inconnu sur numéro partagé → nouvelle fiche** : test
      ajouté « creates a NEW patient when a shared phone is booked under a
      name that matches NEITHER existing record » — deux fiches existantes
      (Amine, Yacine) partageant un numéro, réservation avec « Karima
      Belaid » (aucun des deux) → 3ᵉ fiche créée avec l'id propre, les deux
      fiches existantes inchangées, `patient.count(phoneE164) === 3`.
    - **Preuve n°4 — suppression douce non annulée** : test ajouté « never
      reactivates a soft-deleted patient (active: false) via a public
      booking » — fiche créée `active: false`, réservation publique avec son
      numéro et son nom exact (donc `existing` trouvé par nom) → fiche
      toujours `active: false` après coup.
    - **Tests de la Tâche 6 existants — aucun modifié.** Les 3 tests qui
      exercent `upsertPatient()` avec un match par nom identique (« upserts
      an existing patient by phoneE164 instead of duplicating », « preserves
      a patient's optional email/birthDate… », le test de concurrence et le
      test de rollback) envoient tous le **même** `firstName`/`lastName` à
      chaque appel (`patientInput` ou un spread qui ne change pas le nom) :
      la résolution par phone+nom trouve exactly la même fiche que la
      résolution par phone seul trouvait avant. **Aucun** de ces tests
      n'affirmait « la réservation écrase l'identité » (le défaut) — ils
      affirment tous « re-réserver retrouve/complète la même fiche », ce qui
      reste vrai après la correction. Non modifiés, tous verts.
    - **⚠️ Défaillance d'environnement, sans lien avec ce diff, signalée et
      prouvée non introduite par moi** : `npm test` complet →
      **378 verts / 23 échecs / 401 tests** (395 de référence + 6 nouveaux
      testcases de ce tour). Les 23 échecs sont **tous** dans
      `booking-flow.test.ts`, `booking.test.ts`, `create-booking.test.ts`
      (les 7 cas **pré-existants**, pas les miens) et `messaging.test.ts` —
      tous des `SlotConflictError`/« This time slot is no longer available »
      ou l'équivalent 409, causés par des dates **codées en dur**
      (`"2026-08-29"`) désormais dans le **passé** (horloge du bac à sable :
      29/08/2026 16h18 Alger, alors que ces créneaux de test visent
      10h-14h). **Prouvé indépendant de mon diff** : `git stash push` des 4
      fichiers modifiés (+ le fichier de test create-booking) →
      `npx vitest run booking-flow booking.test create-booking messaging` →
      **exactement les 23 mêmes échecs**, sur le code d'origine non
      modifié. `git stash pop` ensuite, ré-vérifié (`grep normalizeName`
      présent). Aucune correction apportée à ces fichiers (hors périmètre
      strict de cette étape — appartiennent aux Tâches 6/7/9). Mes 3
      nouveaux tests dans `create-booking.test.ts` calculent une date
      relative à `new Date()` (helper `futureBookableLocalStart`, +5 jours,
      saute le vendredi fermé) précisément pour ne pas hériter de cette
      fragilité — vérifié vert indépendamment de l'heure du bac à sable.
    - **Résultats finaux** : `npm run typecheck` → OK. `npm run lint` → OK.
      `npx vitest run patients-api` → **19/19** (16 + 3 nouveaux).
      `npx vitest run create-booking` → **10/10** (7 + 3 nouveaux, une fois
      l'horloge du bac à sable écartée par preuve indépendante ci-dessus).
      `npm test` complet → **378/401** (23 échecs pré-existants,
      environnementaux, prouvés non introduits par ce diff).
    - **Réutilisé, rien réécrit** : `normalizeName` (`@/lib/patients/
      duplicates`, exportée mais pas réécrite), `findDuplicateCandidates`
      (inchangée), `logAction`/`getClientIp`/`errorResponse` (inchangés),
      patron d'enveloppe 409 avec `duplicates` déjà établi à l'étape 4 tour 1.
    - **Non fait volontairement** : aucune route `/[id]` (étape 5) ; aucun
      composant React (étapes 7-8) ; `tests/setup.ts` non touché ; les 23
      échecs de dates codées en dur dans d'autres fichiers de test **non
      corrigés** (hors périmètre — appartiennent aux tâches qui ont écrit
      ces fichiers, et une correction large de dates codées en dur dans 4
      fichiers de tests n'est pas « la correction du défaut BLOQUANT » qui
      m'a été confiée) ; aucune case cochée dans `tasks/todo.md` ; aucune
      commande git d'écriture.
    - **Signalé sans y toucher** : la fragilité des dates codées en dur
      (`"2026-08-29"`) dans `booking.test.ts`, `booking-flow.test.ts`,
      `create-booking.test.ts` (les 7 cas pré-existants) et
      `messaging.test.ts` est un problème d'infrastructure qui va
      **réapparaître** à chaque avancée de l'horloge du bac à sable tant
      qu'aucun de ces fichiers n'adopte un calcul de date relatif (comme le
      nouveau helper `futureBookableLocalStart` de ce tour). Ne relève pas
      de mon périmètre de le corriger partout, mais mérite un ticket dédié.
      `DATABASE_URL` jamais affiché ; cible base forcée sur
      `TEST_DATABASE_URL` (`*localhost*` contrôlé) avant chaque commande
      touchant la base.
    - **Verdict : VERT.**


- **2026-08-29 — `ortho-security`. Audit du TOUR 1 de l'étape 4. ROUGE** *(entrée
  recopiée par l'orchestrateur : elle avait été transmise oralement et manquait au
  relais — une correction sans son constat est illisible pour le prochain agent).*
  - **[BLOQUANT, désormais fermé au TOUR 2]** `route.ts` n'excluait pas le motif
    `PHONE` de l'acquittement → seconde fiche partageant un `phoneE164` (colonne
    indexée, **non `@unique`**). `upsertPatient()` résolvait alors par
    `findFirst({ where: { phoneE164 }, orderBy: { createdAt: "desc" } })` et
    **écrasait** `firstName`, `lastName`, `phone`, `consentAt`, `consentVersion`,
    `preferredLocale`, `whatsappOptIn`, `active: true`. Cas familial ordinaire en
    Algérie → l'identité d'une personne portée par un dossier contenant les notes
    cliniques d'une autre, sans alerte et sans trace.
  - Les **5 conditions de recevabilité** posées à l'étape 3 étaient toutes honorées.
  - 2 MAJEUR portés en dette : absence de limite de débit en **lecture** (annuaire
    aspirable en `ceil(N/200)` requêtes) et **consentement non enregistré** à la
    création par le personnel.

- **2026-08-29 — Correctif transverse des dates de test.** *(entrée ajoutée par
  l'orchestrateur : `ortho-builder` ne l'avait pas journalisée — la mention
  « signalé sans y toucher » de l'entrée TOUR 2 était donc devenue fausse.)*
  - **Symptôme** : 23 tests en échec le 2026-08-29 alors qu'ils passaient la veille,
    **sans aucun changement de code applicatif**. `booking.test.ts`,
    `booking-flow.test.ts`, `create-booking.test.ts` (7 cas d'origine),
    `messaging.test.ts`.
  - **Cause** : la date `"2026-08-29"` était **codée en dur**. Elle était dans le
    futur à l'écriture des tests ; elle est devenue le jour même. Réserver un
    créneau à 11:00 alors qu'il est 16:00 déclenche `SlotConflictError`.
    Indépendance prouvée par rejeu sur le code d'origine intact.
  - **Correctif** : nouveau module partagé `tests/integration/helpers/testDates.ts`
    (`localStart`, `nextOpenLocalDate`, `nextClosedLocalDate`,
    `futureBookableLocalStart`). Il **lit le planning `workingHours` en base** pour
    choisir le prochain jour réellement ouvrable, au lieu de supposer « vendredi
    fermé » en dur — une supposition aurait produit des échecs **intermittents**,
    pires que le défaut initial. Réutilise `addClinicDays` / `getClinicDayOfWeek`
    de `@/lib/time/clinicTime` plutôt que de réimplémenter l'arithmétique.
  - **Preuve de non-vacuité** : `overlapsAppointment()` cassée volontairement →
    6 tests corrigés en échec. Mutation annulée, `npm test` → **401/401**.
  - Aucun test supprimé, aucun `.skip`, nombre de tests inchangé, aucun fichier
    `src/` modifié.
  - ⚠️ Reste ouvert : `tests/integration/cron.test.ts` et `tests/schema.test.ts`
    contiennent encore des dates figées (hors périmètre du correctif).

  - **2026-08-29 — `ortho-builder`. TOUR 3 — deux corrections ciblées remontées
    par `ortho-security` en contre-contrôle. VERT.**
    - **Correction 1 — fixture de test non déterministe**
      (`tests/integration/create-booking.test.ts`). Les deux fiches créées
      « coup sur coup » dans le test « does not mix up two family members'
      records » (lignes ~242/254) et dans son doublon « creates a NEW patient
      when a shared phone is booked under a name that matches NEITHER
      existing record » (lignes ~309/317) n'avaient pas de `createdAt`
      explicite. Ajouté `createdAt: new Date(Date.now() - 60_000)` sur la
      **première** fiche créée (`familyMember1`) dans les deux tests, avec un
      commentaire expliquant pourquoi (mesure d'`ortho-security` : 49/59
      paires d'`INSERT` consécutifs partageant la même milliseconde en local).
      La seconde fiche garde son `createdAt` implicite (`now()`), ce qui
      suffit à créer un écart d'une minute, largement au-delà de toute
      granularité de collision.
    - **Correction 2 — tri non déterministe dans `upsertPatient()`**
      (`src/lib/booking/createBooking.ts:144-166`). `orderBy: { createdAt:
      "desc" }` sans départage remplacé par `orderBy: [{ createdAt: "desc" },
      { id: "desc" }]` — convention déjà suivie par
      `src/app/api/admin/audit/route.ts` et
      `src/app/api/admin/patients/route.ts`. Le commentaire au-dessus de
      `.find()` (qui affirmait à tort que le tri « préfère la fiche la plus
      récente » en cas d'égalité) a été réécrit pour dire l'inverse
      explicitement : l'ordre est déterministe (stable) mais n'est **pas** une
      garantie de récence en cas d'égalité de `createdAt`.
    - **Preuve exigée — le garde-fou mord de façon fiable, pas une fois sur
      deux.** Méthode : édition manuelle directe du fichier (aucun `git
      stash`/`checkout`/`reset`, conformément à l'interdit), pas de commande
      destructive.
      1. `src/lib/booking/createBooking.ts` sauvegardé dans le scratchpad de
         session avant modification.
      2. `upsertPatient()` temporairement réduite à l'ancienne résolution
         phone-seul : `const existing = await tx.patient.findFirst({ where: {
         phoneE164: input.phoneE164 }, orderBy: { createdAt: "desc" } });`
         (marqueur `TEMP TOUR-3-PROOF: ... DO NOT COMMIT` dans le commentaire).
      3. `npx vitest run create-booking -t "does not mix up"` lancé **5 fois
         de suite**, cible base reconfirmée `*localhost*` avant chaque
         commande :
         - Run 1/5 → **ÉCHEC** (`expected 'cmtemmfk1...' to be 'cmtemmfjz...'`
           — a résolu sur Yacine, membre le plus récemment créé, au lieu
           d'Amine).
         - Run 2/5 → **ÉCHEC** (même assertion, même symptôme).
         - Run 3/5 → **ÉCHEC**.
         - Run 4/5 → **ÉCHEC**.
         - Run 5/5 → **ÉCHEC**.
         **5/5, pas 3/5** — le garde-fou anti-mélange, avec la fixture
         corrigée (`createdAt` distincts) et l'ancienne logique de résolution,
         mord **à 100 %**, comme exigé.
      4. `src/lib/booking/createBooking.ts` restauré depuis la sauvegarde
         (fichier non suivi par git à ce stade des tours, donc restauration
         par copie, pas par une commande git). Confirmé par `grep -n "TEMP
         TOUR-3-PROOF"` → aucun résultat, et par relecture du bloc
         `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` / `candidates.find`
         → présent, identique au diff livré.
      5. `npx vitest run create-booking` (suite complète du fichier, logique
         corrigée restaurée) → **10/10 verts**, y compris les deux tests
         modifiés par la Correction 1.
    - **Résultats finaux** :
      - `npm test` → **401/401 verts**, 40 fichiers (référence égalée, aucune
        régression).
      - `npm run typecheck` → OK.
      - `npm run lint` → OK.
    - **Aucune autre dette traitée** : ni la limite de débit en lecture, ni le
      consentement non enregistré (MAJEUR portés en dette par l'audit du tour
      1), ni l'alef-hamza, ni l'audit du chemin public, ni le `PATCH` de
      l'étape 5, ni la sémantique de `active` — tous laissés tels quels,
      conformément aux interdits de ce tour.
    - **Fichiers modifiés (définitifs)** :
      - `src/lib/booking/createBooking.ts` — tri secondaire `id desc` +
        commentaire corrigé (2 changements, aucune autre ligne touchée).
      - `tests/integration/create-booking.test.ts` — `createdAt` explicite
        sur `familyMember1` dans les 2 tests concernés (2 changements +
        commentaires).
    - **Réutilisé** : convention `orderBy: [{ createdAt: "desc" }, { id:
      "desc" }]` déjà établie par `src/app/api/admin/audit/route.ts` et
      `src/app/api/admin/patients/route.ts` — pas de nouveau motif inventé.
    - **Non fait volontairement** : aucune route `/[id]`, aucun composant
      (étapes 5-8) ; aucune migration ; aucune case cochée dans
      `tasks/todo.md` ; aucune commande git d'écriture (`add`/`commit`/
      `push`) ; `tests/setup.ts` non touché ; ni `git stash`, ni `git
      checkout`, ni `git reset` utilisés à aucun moment — la restauration de
      `createBooking.ts` s'est faite par copie de fichier depuis une
      sauvegarde du scratchpad de session.
    - **Signalé sans y toucher** : rien de nouveau au-delà de ce qui est déjà
      consigné par les tours précédents dans ce relais. `DATABASE_URL` jamais
      affiché ; cible base forcée sur `TEST_DATABASE_URL` (`*localhost*`
      contrôlé) avant chaque commande touchant la base.
    - **Verdict : VERT.**

### Étape 5 — Fiche patient : `GET`/`PATCH /[id]`, `GET /[id]/history`, `POST /[id]/visits`
- [ ] Statut : à faire
- **But** : l'API de la fiche — lecture auditée, édition avec doublons et suppression
  douce, timeline unifiée, ajout de visite manuelle.
- **Agents recommandés** : `ortho-backend`, `ortho-security`, `ortho-tester`.
  **Prérequis strict : l'étape 2 doit être terminée** (premières routes dynamiques).
- **Fichiers à créer / modifier** :
  - `src/app/api/admin/patients/[id]/route.ts` (créer — `GET`, `PATCH`)
  - `src/app/api/admin/patients/[id]/history/route.ts` (créer — `GET`)
  - `src/app/api/admin/patients/[id]/visits/route.ts` (créer — `POST`)
  - `tests/authz-matrix.test.ts` (4 lignes ajoutées)
  - `tests/integration/patient-record.test.ts` (créer)
- **Ce qu'il faut faire** :
  1. **Signature Next 16** :
     `export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> })`
     puis `const { id } = await params;`. `params` est une **Promise** dans cette version
     — voir « Next.js 16 gotchas » dans `CLAUDE.md`.
  2. `GET /[id]` — `requireStaff` (deux rôles) → patient introuvable → 404 `NOT_FOUND`
     avec un message **générique et identique** quel que soit le motif (ne pas distinguer
     « inexistant » de « inaccessible »). Réponse : liste blanche
     `id, firstName, lastName, phone, email, birthDate, notes, active, anonymizedAt,
     consentAt, consentVersion, messagingOptOut, whatsappOptIn, preferredLocale,
     createdAt, updatedAt`, plus `createdBy`/`updatedBy` réduits au seul `name`. Puis
     `logAction(..., PATIENT_RECORD_VIEWED, "Patient", id, { scope: "record" }, getClientIp(...))`.
  3. `PATCH /[id]` — `requireStaff` → `assertSameOriginStrict` → `patientUpdateSchema`.
     - Si `phone` change : re-normaliser, et **relancer la détection de doublons** avec
       `excludeId: id` → même contrat 409 `DUPLICATE_CANDIDATES` qu'à l'étape 4.
     - Si `active` est présent et que `guard.user.role !== "ADMIN"` → **403 `FORBIDDEN`**
       (décision 3). La désactivation est la seule opération destructive de cet écran.
     - Toujours `updatedById = guard.user.id`.
     - Audit `PATIENT_UPDATED` avec `detail: { changedFields: string[] }` — **la liste
       des noms de champs modifiés, jamais leurs valeurs**.
     - **Aucune suppression définitive nulle part** : pas de `prisma.patient.delete` dans
       le dépôt (vérifiable par `grep`).
  4. `GET /[id]/history` — `requireStaff` (deux rôles), pagination `limit`/`page`.
     Construire la timeline unifiée : rendez-vous du patient avec `status: "COMPLETED"`
     **UNION** lignes `Visit`. Deux requêtes Prisma puis fusion et tri **en TypeScript**
     par date décroissante (pas de SQL brut — `getPrisma()` uniquement). Forme d'un
     élément : `{ kind: "APPOINTMENT" | "VISIT", id, date, serviceName: string | null,
     type: string | null, notes: string | null, treatment: string | null,
     status: string | null }`. `serviceName` passe par `localized(service.name, "fr")`
     (`@/lib/i18n/localized`). Renvoyer aussi `total` (somme des deux compteurs) pour
     l'état vide de l'UI. Journaliser `PATIENT_RECORD_VIEWED` avec
     `detail: { scope: "history" }`.
  5. `POST /[id]/visits` — `requireStaff` (deux rôles) → `assertSameOriginStrict` →
     `visitCreateSchema` → 404 si le patient n'existe pas → 400 si `serviceId` est fourni
     mais inconnu → création avec `createdById = guard.user.id`. Audit `VISIT_CREATED`
     sur `entityType: "Visit"`, `entityId: visit.id`, avec `detail: { patientId, type }`
     — **jamais `notes` ni `treatment`** (contenu clinique). Réponse **201**.
  6. Ajouter les 4 lignes dans `ROUTES` de `tests/authz-matrix.test.ts` en utilisant
     `scanPath` / `requestPath` / `params` de l'étape 2 :
     - `GET /api/admin/patients/[id]` — ADMIN+RECEPTIONIST, `okStatus: 404`
     - `PATCH /api/admin/patients/[id]` — ADMIN+RECEPTIONIST, `okStatus: 400`
     - `GET /api/admin/patients/[id]/history` — ADMIN+RECEPTIONIST, `okStatus: 404`
     - `POST /api/admin/patients/[id]/visits` — ADMIN+RECEPTIONIST, `okStatus: 400`
     (`requestPath` avec un id bidon, `params: { id: "does-not-exist" }`).
- **Critères d'acceptation** :
  - `npm test -- authz-matrix` vert avec les 16 nouvelles combinaisons, **filtre de scan
    intact** (`git diff` sur ce point).
  - **Anti-IDOR explicite** : un appel anonyme sur l'id d'un patient **réellement
    existant** renvoie `401` et un corps strictement identique à celui obtenu pour un id
    inexistant — assertion dans `tests/integration/patient-record.test.ts`.
  - `npm test -- patient-record` vert, couvrant : `GET /[id]` écrit exactement une ligne
    `PATIENT_RECORD_VIEWED` (`actorType STAFF`, bon `userId`, `scope: "record"`) ;
    `PATCH` d'une note écrit `PATIENT_UPDATED` avec `detail.changedFields = ["notes"]`
    **et aucune valeur de note dans `detail`** ; un **réceptionniste** envoyant
    `{ active: false }` reçoit **403**, un **admin** reçoit 200 et le patient a
    `active = false` ; changer le téléphone vers celui d'un patient existant sans
    acquittement → 409 ; l'historique d'un patient ayant 1 rendez-vous `COMPLETED`,
    1 rendez-vous `CANCELLED` et 2 `Visit` renvoie **exactement 3 éléments**, triés par
    date décroissante, le `CANCELLED` absent ; `POST /visits` crée la ligne et écrit
    `VISIT_CREATED`.
  - `grep -rn "patient.delete\|patient.deleteMany" src/` ne renvoie rien.
  - `npm run typecheck` + `npm run lint` verts, `npm test` complet vert.
- **Vigilance sécurité** : **oui — auth, rôles, données patient, entrées utilisateur,
  IDOR**. C'est la surface la plus exposée de la tâche : l'identifiant du patient est
  dans l'URL. `ortho-security` **obligatoire**. Rappels : la garde s'exécute avant le
  404 ; aucune donnée patient dans une URL, un message d'erreur ou un `detail` d'audit ;
  réponse en liste blanche stricte.
- **Journal** :
  - **2026-08-29 — `ortho-builder` (agent générique, aucun `ortho-backend` n'existe
    dans ce dépôt). Étape 5 terminée. VERT.**
  - **Fichiers créés** : `src/app/api/admin/patients/[id]/route.ts` (GET+PATCH),
    `src/app/api/admin/patients/[id]/history/route.ts` (GET),
    `src/app/api/admin/patients/[id]/visits/route.ts` (POST),
    `tests/integration/patient-record.test.ts` (17 cas).
  - **Fichiers modifiés** : `tests/authz-matrix.test.ts` (import + 4 lignes
    `ROUTES`) ; `src/app/api/admin/patients/route.ts` (constraintes #1/#2/#4/#5
    ci-dessous) ; `src/lib/booking/createBooking.ts` (constraint #7) ;
    `src/lib/messaging/index.ts` (constraint #6) ; `tests/integration/
    patients-api.test.ts` (+2 cas : débit lecture, consentement) ;
    `tests/integration/create-booking.test.ts` (+1 cas : anonymisation).
  - **Les 7 contraintes obligatoires de l'audit de l'étape 4, une par une** :
    1. **Limite de débit en lecture.** `checkRateLimit` sur la clé
       `staff:<userId>:patients-read` (60 req/5min), **un seul pool partagé**
       (pas un budget par route) appliqué identiquement à `GET
       /api/admin/patients` (route existante, modifiée), `GET /[id]` et `GET
       /[id]/history` (nouvelles). Preuve : test dédié dans
       `patient-record.test.ts` qui épuise le budget via `GET
       /[id]/history` (60 appels) puis observe un 429 sur le tout premier
       `GET /[id]` suivant — prouve le partage de clé entre routes, pas
       seulement le seuil lui-même. Corps du 429 vérifié sans nom/id du
       patient (`JSON.stringify` négatif). Second test dans
       `patients-api.test.ts` (61 appels sur la liste, `?q=Secret`) couvre la
       route existante isolément.
    2. **Consentement à la création par le personnel.** `POST
       /api/admin/patients` écrit désormais `consentAt: new Date()` et
       `consentVersion: await readConsentVersion()` (réutilisé de
       `@/lib/booking/policy`, même helper que le chemin public). Test dans
       `patients-api.test.ts` : crée une fiche, positionne
       `consentVersion="2.1"` en `Setting`, vérifie `consentAt !== null`,
       `consentVersion === "2.1"`, et l'invariant explicite
       `!(consentAt === null && messagingOptOut === false)`.
    3. **`PATCH` rejoue les deux gardes de doublon.** `nameChanged` (si
       `firstName`/`lastName` présents dans le corps) déclenche la garde
       `duplicateAcknowledged`/409 `DUPLICATE_CANDIDATES` ; `phoneChanged`
       (si `phone` présent) déclenche `phoneSharingAcknowledged`/409
       `PHONE_ALREADY_REGISTERED` — chacune indépendamment, avec
       `excludeId: id` passé à `findDuplicateCandidates`. Une seule requête
       de détection quand l'un ou l'autre change (pas deux scans distincts).
       2 tests 409 (un par garde, chacun vérifie **aucune écriture** en
       base) + 1 test de succès avec `duplicateAcknowledged: true`.
    4. **Divulgation minimale du 409 existant.** `duplicates: candidates`
       (tableau fusionné, incluant les matches téléphone-seul) remplacé par
       `duplicates: nameMatches` dans la branche NAME de `POST
       /api/admin/patients` — même correction appliquée nativement dans la
       nouvelle branche NAME du `PATCH`. Pas de régression sur les tests
       existants (aucun ne dépendait du contenu exact de `duplicates` au-delà
       de « contient l'id attendu »).
    5. **Traçabilité des acquittements.** `{ acknowledgedDuplicates: n }` →
       `{ acknowledgedNameDuplicates: nameMatches.length,
       acknowledgedPhoneSharing: phoneMatches.length }` dans l'audit
       `PATIENT_CREATED` de `POST /api/admin/patients`. Toujours deux
       compteurs, jamais une valeur patient.
    6. **Sémantique de `active: false` — décision documentée.** Une fiche
       `active: false` ne reçoit plus de messages **non transactionnels**
       (`src/lib/messaging/index.ts`, `sendMessage()` — les deux points de
       garde, envoi initial ET retry après échec, `select: { ...,
       active: true }` + `patient?.active === false` ajouté à la condition
       de suppression). Les messages **transactionnels** continuent toujours
       d'être envoyés (ex. confirmation d'un rendez-vous en cours). Tenait en
       une ligne par garde (2 lignes au total) → fait, pas seulement signalé.
       Pas de test dédié ajouté ici (le fichier `messaging.test.ts` n'a pas
       été modifié) — **signalé au relecteur** : un test explicite
       « `active:false` supprime un envoi non-transactionnel » serait un
       bon ajout de couverture, hors mandat strict de cette étape (aucun
       fichier de test messaging n'était dans mon périmètre).
    7. **Anonymisation — `upsertPatient()`.** `anonymizedAt: null` ajouté au
       `where` du `findMany` de résolution phone+nom dans
       `src/lib/booking/createBooking.ts` — une fiche anonymisée ne peut
       plus jamais être retrouvée/écrasée par une réservation publique, elle
       tombe systématiquement dans la branche `create` (nouvelle fiche).
       Test ajouté dans `create-booking.test.ts` : fiche `anonymizedAt: new
       Date()` sur un numéro, réservation publique avec le même
       numéro+un nom différent → nouvelle fiche créée, l'ancienne reste
       inchangée (toujours anonymisée, toujours son identité placeholder).
  - **Signature Next 16 — écart assumé et documenté dans le code.** La fiche
    d'étape donne l'exemple `{ params }: { params: Promise<{ id: string }> }`.
    En pratique, ce type plus étroit n'est **pas assignable** à
    `RouteRow.handler` (`{ params: Promise<Record<string, string>> }`) dans
    `tests/authz-matrix.test.ts` — `tsc` le rejette (`Record<string,string>`
    ne garantit pas la présence de `id`), et le tour 3 de l'étape 2 interdit
    explicitement toute référence de handler qui ne soit pas la fonction
    exportée **directement** (`row.handler === routeModule[method]`), donc
    pas de wrapper pour contourner. J'ai typé les 4 handlers
    `{ params: Promise<Record<string, string>> }` — reste un vrai `Promise`
    à `await`-er (respecte la substance de la consigne Next 16), juste avec
    une garantie de forme plus large ; `const { id } = await params` donne
    toujours `id: string`. Commenté dans les 3 fichiers, à chaque signature.
    Choix préféré à un cast (`as RouteRow["handler"]`) dans le fichier de
    test : zéro modification du fichier hardened, zéro `as`/`any` nulle part.
  - **`Prisma.PatientUpdateInput` → `Prisma.PatientUncheckedUpdateInput`**
    dans le `PATCH` : la variante « checked » n'accepte pas le FK scalaire
    `updatedById` directement (exige `updatedBy: { connect }`) — la variante
    « unchecked » si, cohérent avec `POST /api/admin/patients` qui utilise
    déjà cette forme (sans annotation de type explicite là-bas, donc sans le
    voir, mais structurellement identique). Détecté par `tsc`, pas par
    relecture.
  - **404 générique, ordre des gardes.** Dans les 4 routes : `requireStaff`
    → (CSRF sur `PATCH`/`POST`) → limite de débit (GET seulement) → Zod →
    contrôle de rôle sur `active` (avant toute lecture DB, dans `PATCH`) →
    validation téléphone (avant lecture DB) → lecture/404 → détection de
    doublons → écriture. Le contrôle de rôle sur `active` est placé **avant**
    la lecture 404 exprès : un réceptionniste ne doit jamais apprendre, via
    un 404 vs 403 différent, si l'id cible existe.
  - **`changedFields`** : liste explicite `PATCHABLE_FIELDS` (10 noms de
    colonnes `Patient`), filtrée sur `data[field] !== undefined` — exclut
    structurellement `duplicateAcknowledged`/`phoneSharingAcknowledged`
    (qui portent un `.default(false)` donc seraient toujours présents dans
    `parsed.data` sinon, polluant la liste). Jamais de valeur, seulement des
    noms.
  - **Timeline (`GET /[id]/history`)** : deux requêtes Prisma
    (`appointment.findMany` filtré `status: COMPLETED`, `visit.findMany` non
    filtré) fusionnées et triées en TypeScript (`Array.sort` sur
    `date.getTime()`), pagination appliquée **après** le tri sur le tableau
    fusionné (pas par requête séparée — nécessaire puisque le tri croise
    deux sources). `serviceName` via `localized(service.name as
    LocalizedField, "fr")`. Aucun SQL brut.
  - **`POST /[id]/visits`** : 404 patient → 400 `INVALID_SERVICE` si
    `serviceId` fourni mais introuvable → création avec
    `createdById: guard.user.id` → audit `VISIT_CREATED`,
    `detail: { patientId, type }`, **jamais** `notes`/`treatment` — prouvé
    par un test avec marqueurs `CLINICAL-NOTE-MARKER-9911` /
    `TREATMENT-MARKER-2244` et une assertion `JSON.stringify(detail)`
    négative sur les deux.
  - **Aucune suppression définitive** : `grep -rn "patient\.delete\|patient\.deleteMany" src/ --exclude-dir=generated`
    → aucun résultat (les seules occurrences sont des exemples JSDoc dans le
    client Prisma généré).
  - **Réutilisé, rien réécrit** : `requireStaff`/`withRefreshedSession`/
    `assertSameOriginStrict` (`@/lib/auth/guard`), `checkRateLimit`/
    `RateLimitError` (`@/lib/security/rateLimit`), `findDuplicateCandidates`
    (`@/lib/patients/duplicates`, non modifié), `patientUpdateSchema`/
    `visitCreateSchema` (`@/schemas/patient`, non modifié — rien à ajouter
    comme prévu par la fiche), `normalizePhoneE164`, `logAction`,
    `getClientIp`, `localized`, `ok`/`errorResponse` (non modifié — le 409
    est construit à la main comme à l'étape 4), `getPrisma`,
    `readConsentVersion` (`@/lib/booking/policy`, nouveau réemploi hors de
    son fichier d'origine).
  - **Résultats des commandes** :
    - `npm run typecheck` → OK. `npm run lint` → OK.
    - `npx vitest run patient-record` → **17/17 verts**.
    - `npx vitest run patients-api` → **21/21 verts** (19 avant + 2 nouveaux :
      débit lecture, consentement).
    - `npx vitest run authz-matrix` → **39/39 verts** (23 avant + 16
      nouvelles combinaisons : 4 routes × 4 acteurs).
    - `npx vitest run create-booking` → inclus dans la suite complète,
      +1 test (anonymisation).
    - `npm test` complet → **437/437 verts**, 41 fichiers.
  - **Les 6 preuves exigées par le format de réponse, une par une** :
    1. **Anti-IDOR** : test dédié `patient-record.test.ts` — un patient réel
       créé en base, appel anonyme sur son id **réel** vs un id inexistant →
       401 dans les deux cas, corps **strictement égal** (`toEqual`), et le
       corps sérialisé ne contient ni l'id, ni le prénom, ni le nom du
       patient réel.
    2. **403 sur `active`** : réceptionniste → 403, `active` reste `true` en
       base (relu après coup) ; admin → 200, `active` passe à `false` en
       base. Deux tests séparés dans `patient-record.test.ts`.
    3. **`PATCH` rejoue les deux gardes** : test NAME (renommer vers un
       homonyme sans acquittement → 409 `DUPLICATE_CANDIDATES`, nom inchangé
       en base) + test PHONE (changer le téléphone vers un numéro déjà
       enregistré sans acquittement → 409 `PHONE_ALREADY_REGISTERED`,
       `phoneE164` inchangé en base, et la fiche « propriétaire » du numéro
       également inchangée).
    4. **Aucune donnée clinique dans l'audit** : `POST /[id]/visits` avec
       `notes`/`treatment` marqueurs → `JSON.stringify(audit.detail)` ne
       contient ni l'un ni l'autre (le `detail` réel est
       `{ patientId, type }`).
    5. **429 en lecture** : voir contrainte #1 ci-dessus — test qui épuise
       le budget partagé via une route et observe le 429 sur une autre,
       corps sans donnée patient.
    6. **Fiche anonymisée non réécrite** : voir contrainte #7 ci-dessus.
  - **Décision documentée sur `active: false`** : voir contrainte #6
    ci-dessus (suppression des envois non-transactionnels uniquement,
    transactionnels toujours envoyés, changement de 2 lignes dans
    `src/lib/messaging/index.ts`).
  - **Non fait volontairement** : aucun composant React/écran (étapes 7-8) ;
    aucune anonymisation (`lib/privacy/anonymize.ts`, `POST /[id]/anonymize`
    — étape 6, hors périmètre explicite) ; aucune migration ; aucune case
    cochée dans `tasks/todo.md` ; aucune commande git d'écriture ; pas de
    limite de débit sur `PATCH`/`POST /visits` (non demandée par la
    consigne, contrairement aux 3 GET) ; pas de test dédié pour la
    sémantique `active`/messaging au-delà du changement de code lui-même
    (signalé ci-dessus comme dette de couverture, pas silencieusement
    omis) ; alef-hamza dans `normalizeName`, audit du chemin public,
    `plan.md` — hors périmètre, non traités.
  - **Signalé sans y toucher** : `git status --porcelain` montre que les
    étapes 1-4 de cette tâche restent **non committées** (fichiers créés à
    l'étape 4 comme `src/app/api/admin/patients/route.ts` et
    `tests/integration/patients-api.test.ts` sont encore `??` — untracked) ;
    ce n'est pas un problème introduit par cette étape, juste un constat au
    moment de démarrer. `DATABASE_URL` jamais affiché ; cible base forcée
    sur `TEST_DATABASE_URL` (`*localhost*` contrôlé) avant toute commande
    touchant la base.
  - **Verdict : VERT.**

  - **2026-08-29 — `ortho-tester`. Vérification de l'étape 5. VERT.**
    - **Cible base confirmée locale** avant toute commande (`TEST_DATABASE_URL`,
      contrôle `*localhost*`). Aucun secret affiché.
    - **Résultats indépendants** : `npm test` → **439/439 verts** (437 livrés
      par `ortho-builder` + 2 tests que j'ai ajoutés, voir plus bas), 41
      fichiers. `npx vitest run patient-record` → **19/19** (17 + 2 ajoutés).
      `npx vitest run authz-matrix` → **39/39**. `npm run typecheck` → OK.
      `npm run lint` → OK.
    - **Critères d'acceptation de l'étape 5, un par un** :
      1. `authz-matrix` vert avec les 16 nouvelles combinaisons, filtre de
         scan intact → **prouvé**. Relu `tests/authz-matrix.test.ts` : les 4
         lignes patients utilisent `handler:` par référence directe
         (`patientRecordRoute`/`patientPatchRoute`/`patientHistoryRoute`/
         `patientVisitsRoute`, pas de wrapper fléché), `allowed:
         [Role.ADMIN, Role.RECEPTIONIST]` conforme à §Décisions 3,
         `okStatus: 404`/`400` tous deux dans `AuthorizedOkStatus`. Les
         interdits (a)-(g) du commentaire d'en-tête — filtre de scan,
         `HTTP_METHODS` (7), `expect(missing).toEqual([])`,
         `expect(mismatched).toEqual([])`, `AuthorizedOkStatus`,
         `Object.keys(EXPECTED)` — tous encore présents, `grep` à l'appui.
      2. Anti-IDOR explicite (id réel vs inexistant, corps strictement
         identique) → **prouvé** par le test dédié, et **re-cassé par moi**
         deux fois indépendamment (voir mutations 1 et 5 ci-dessous).
      3. `patient-record` vert couvrant les 6 comportements listés dans la
         fiche (audit GET, `changedFields` sans valeur, 403/200 sur
         `active`, 409 sur téléphone partagé sans acquittement, historique à
         3 éléments triés desc sans le `CANCELLED`, `POST /visits` + audit)
         → **prouvé**, tous présents et vérifiés un par un dans le fichier.
      4. `grep -rn "patient.delete\|patient.deleteMany" src/` vide →
         **prouvé**, rejoué indépendamment (`--exclude-dir=generated`).
      5. `typecheck`/`lint`/`npm test` complet verts → **prouvé**.
    - **Les 5 protections cassées une par une, comme demandé — toutes ont
      mordu, toutes annulées, état final relu identique à l'original** :
      1. **Anti-IDOR** — `if (!guard.ok) return guard.response;` →
         `return errorResponse(404, "NOT_FOUND", ...)` dans `GET /[id]`.
         **2 échecs** : `patient-record.test.ts` (`expected 404 to be 401`)
         **et** `authz-matrix.test.ts` (2 cellules `anonymous`/`deactivated`
         sur `GET .../does-not-exist`, `expected 404 to be 401`) — la
         matrice mord aussi sur cette régression, pas seulement le test
         dédié. Annulé, `patient-record`+`authz-matrix` → 56/56.
      2. **Garde ADMIN sur `active`** — condition réduite à `if (false && …)`
         dans `PATCH /[id]`. **1 échec** :
         « a receptionist sending {active:false} gets 403… »,
         `expected 200 to be 403` — un réceptionniste désactive bien la
         fiche sans le garde-fou. Annulé, revérifié vert.
      3. **Double garde du `PATCH`** — deux mutations séparées :
         - `duplicateAcknowledged` ignoré (`&& false` sur la condition NAME)
           → « replays the NAME duplicate gate… », `expected 200 to be 409`.
         - `phoneSharingAcknowledged` ignoré (`&& false` sur la condition
           PHONE) → « replays the PHONE duplicate gate… »,
           `expected 200 to be 409`.
         Chaque mutation annulée et revérifiée séparément avant la suivante.
      4. **Contenu clinique dans l'audit** — `notes: visit.notes` ajouté au
         `detail` de `VISIT_CREATED`. **1 échec** :
         « …NEVER notes/treatment », le marqueur
         `CLINICAL-NOTE-MARKER-9911` apparaît dans le `detail` sérialisé.
         Annulé, revérifié vert.
      5. **Ordre des gardes** — recherche patient + 404 déplacés **avant**
         `requireStaff` dans `GET /[id]`. **3 échecs**, différentiel exact
         décrit par la fiche : id réel anonyme → reste 401 (patient trouvé,
         guard échoue ensuite), id inexistant anonyme → devient **404**
         (court-circuité avant même d'atteindre `requireStaff`) — fuite
         d'existence par le seul code de statut. Même triplet que la
         mutation 1 (`patient-record` + 2 cellules `authz-matrix`). Annulé,
         revérifié vert, `git diff`/relecture confirment le fichier revenu
         identique à l'original (mêmes lignes, même ordre).
      Après les 5 mutations : `grep -rn "MUTATION-TEST" src/ tests/` → vide,
      `npm test` complet → 437/437 (avant mes 2 ajouts), `typecheck`/`lint`
      → OK.
    - **Point 4 — timeline unifiée** : le test existant « unifies COMPLETED
      appointments and Visit rows, EXCLUDES CANCELLED, sorted newest first »
      couvre exactement le scénario demandé (1 `COMPLETED` + 1 `CANCELLED` +
      2 `Visit` → 3 éléments, `CANCELLED` absent, tri desc vérifié par
      comparaison avec le tableau trié). **Jugé suffisant, non dupliqué.**
    - **Point 5 — listes blanches, gap trouvé et comblé.** La fiche d'étape
      ne l'exige pas explicitement (le `select`/le mapping en TypeScript le
      garantissent par construction), mais aucun test n'affirmait la forme
      de réponse **au runtime** — exactement le type de garantie que
      CLAUDE.md §Sensitive zones et la consigne de mission demandent
      d'expliciter, d'autant que cette route est documentée dans le code
      comme la référence pour le reste de la tâche. **2 tests ajoutés** à
      `tests/integration/patient-record.test.ts` :
      - `GET /[id]` : `Object.keys(body).sort()` égal à la liste exacte des
        18 champs de la fiche (dont `createdBy`/`updatedBy` réduits à
        `null` ici, aucun FK brut).
      - `GET /[id]/history` : forme top-level exactement
        `{items,total,page,limit}`, chaque item exactement
        `{kind,id,date,serviceName,type,notes,treatment,status}`, et le
        corps sérialisé ne contient ni le prénom, ni le nom, ni l'id, ni le
        téléphone du patient testé.
      **Non-vacuité prouvée par mutation, pas seulement écrite** :
      - `phoneE164: true` ajouté au `select` de `GET /[id]` → le nouveau
        test échoue (`+ 'phoneE164'` dans le diff de clés). Annulé.
      - `patientName: patient.id` ajouté à chaque item de la réponse
        `history` (le `select` Prisma seul n'aurait pas suffi : les items
        sont reconstruits par un littéral `TimelineItem` typé, donc rejetés
        à la compilation par les excess-property checks de TS — la fuite
        réaliste passe par le corps de réponse final, pas par le `select`)
        → le nouveau test échoue (`+ 'patientName'`). Annulé.
      Les deux mutations annulées, `npx vitest run patient-record -t
      "EXACTLY the whitelisted"` et `-t "never leaks patient identity"` →
      verts après retour à l'état livré.
    - **Point 6 — limite de débit partagée** : le test existant « exhausting
      the budget on GET /[id]/history makes the very next GET /[id] call
      429… » épuise le budget de **60** via une route (`history`) et observe
      le 429 sur une **autre** (`GET /[id]`) — c'est exactement la preuve du
      partage de clé demandée (pas seulement du seuil). Corps du 429 vérifié
      sans nom/id du patient. **Jugé suffisant, non dupliqué** — je n'ai pas
      testé le troisième membre du pool (`GET /api/admin/patients`, liste)
      contre les deux autres : `tests/integration/patients-api.test.ts`
      (étape 4, non modifié par moi) ne prouve le partage qu'à l'intérieur
      de sa propre suite ; aucun test croisé liste↔fiche n'existe. Risque
      jugé faible (même clé `staff:<userId>:patients-read`, même compteur
      Postgres, lu par les 3 fichiers de route) mais **non prouvé par un
      test cross-fichier** — signalé en dette ci-dessous plutôt que
      silencieusement omis.
    - **Fichiers modifiés par moi** : uniquement
      `tests/integration/patient-record.test.ts` (+2 tests, ~70 lignes).
      Toutes les autres modifications ont été temporaires (mutations dans
      les 3 fichiers de route sous `src/app/api/admin/patients/[id]/`),
      appliquées et annulées une par une à la main — **aucun `git
      stash`/`checkout`/`reset` utilisé**. `grep -rn "MUTATION-TEST" src/
      tests/` final → vide. `git status --porcelain` final cohérent avec
      l'état laissé par `ortho-builder` (mêmes fichiers `??`/`M`, plus
      `tests/integration/patient-record.test.ts` toujours `??` car déjà non
      suivi).
    - **Dette signalée, non traitée ici** :
      1. Ligne de matrice d'autorisation manquante nulle part pour cette
        étape (les 4 lignes sont présentes) — mais rappel : `tests/
        authz-matrix.test.ts` **n'est pas encore** la matrice d'autorisation
        formelle exigée par la Definition of Done (`tasks/todo.md:11`),
        celle-ci arrive avec la Tâche 12 selon `CLAUDE.md` — *note : la
        Tâche 12 est déjà terminée d'après le journal de tâche, et ce
        fichier joue déjà ce rôle depuis l'étape 2 de cette tâche 13 ; aucune
        ligne supplémentaire n'est donc due au-delà des 4 déjà présentes.*
      2. Partage du pool de débit non prouvé par un test **croisé** entre
         `GET /api/admin/patients` (liste, étape 4) et les 2 routes `[id]*`
         de cette étape (voir Point 6 ci-dessus) — écart mineur, risque
         faible, laissé pour un futur passage si l'étape 7/8 touche à
         nouveau ces routes.
      3. Les dettes déjà portées par `ortho-builder` à l'étape 5 restent
         ouvertes et non traitées par moi (hors mandat de vérification) :
         pas de test dédié `active:false` coupe les envois non-transactionnels
         (`src/lib/messaging/`), alef-hamza dans `normalizeName`, audit du
         chemin public, `plan.md`.
    - **Signalé sans y toucher** : `DATABASE_URL` jamais affiché ; cible
      base forcée sur `TEST_DATABASE_URL` (`*localhost*` contrôlé) avant
      chaque commande touchant la base.
    - **Verdict : VERT.**

  - **2026-08-29 — `ortho-builder`. TOUR 2 — correction du défaut BLOQUANT et
    des 5 constats remontés par `ortho-security`. VERT.**
  - **Fichiers modifiés** : `src/app/api/admin/patients/[id]/route.ts`,
    `src/app/api/admin/patients/[id]/history/route.ts`,
    `src/app/api/admin/patients/[id]/visits/route.ts`,
    `src/app/api/admin/patients/route.ts` (constante de débit partagée
    uniquement),
    `tests/integration/patient-record.test.ts` (+8 tests).
  - **Fichier créé** : `src/lib/patients/rateLimits.ts` (`PATIENTS_WRITE_RATE_LIMIT`,
    partagée par `POST /api/admin/patients`, `PATCH /[id]`, `POST
    /[id]/visits` — plus de redéclaration par fichier).
  - **[BLOQUANT] Fermé.** `PATCH /[id]` calcule désormais `dualMatches`
    (candidats dont `matchedOn` contient **à la fois** `"PHONE"` et
    `"NAME"`) et exige **les deux** acquittements
    (`duplicateAcknowledged === true` **ET** `phoneSharingAcknowledged ===
    true`) dès qu'un tel candidat existe, **indépendamment** de savoir quel
    champ (nom ou téléphone) a été modifié dans cette requête précise — seul
    le déclencheur global `nameChanged || phoneChanged` reste inchangé (rien
    n'est évalué si ni l'un ni l'autre n'a changé). Nouveau code dédié
    `409 INDISTINGUISHABLE_RECORDS`, message qui nomme la conséquence réelle
    (« ces deux fiches deviendront indiscernables pour la réservation en
    ligne »), audité `PATIENT_RECORD_VIEWED` avec `scope:
    "indistinguishable-check"` (compteurs/énumérations seulement, même
    discipline que les deux gardes existantes). **Les conditions
    `nameChanged &&` / `phoneChanged &&` des deux gardes simples n'ont PAS
    été retirées** — exactement l'instruction — elles continuent de protéger
    contre un 409 parasite sur une homonymie préexistante que l'édition ne
    touche pas ; seule la nouvelle garde `dualMatches` tourne sans elles.
    - **Preuve rouge → vert, méthode** : mutation temporaire `if (false &&
      dualMatches.length > 0 && …)` dans le fichier (marqueur `TEMP
      MUTATION-TOUR2-PROOF: DO NOT COMMIT`), test dédié lancé seul
      (`npx vitest run patient-record -t "PRE-EXISTING HOMONYM"`) →
      **échoue** : `AssertionError: expected 200 to be 409`
      (`changing phone onto a PRE-EXISTING HOMONYM's number requires BOTH
      acknowledgements…`) — le scénario du père/fils homonymes : deux fiches
      partagent déjà le même nom normalisé, la réceptionniste ne change QUE
      le téléphone de l'une vers celui de l'autre en n'acquittant QUE
      `phoneSharingAcknowledged`, et l'ancien code laissait passer (200,
      écriture effective) parce que `nameChanged` était faux. Mutation
      retirée, `grep -rn "MUTATION-TOUR2-PROOF" src/` → vide (commande, pas
      relecture visuelle), test relancé seul → **vert**. Test de succès
      symétrique ajouté (mêmes deux fiches homonymes, cette fois avec **les
      deux** acquittements) → 200, téléphone effectivement changé.
  - **[MAJEUR-1] Fermé.** `checkRateLimit(\`staff:${guard.user.id}:patients-write\`,
    PATIENTS_WRITE_RATE_LIMIT)` ajouté juste après le contrôle CSRF dans
    `PATCH /[id]` et `POST /[id]/visits` — même clé et même budget (30/5min)
    que `POST /api/admin/patients`. La constante elle-même a été **sortie**
    dans `src/lib/patients/rateLimits.ts` et `POST /api/admin/patients`
    modifié pour l'importer au lieu de sa déclaration locale précédente
    (`WRITE_RATE_LIMIT` supprimée de ce fichier) — un seul point de vérité
    pour les 3 routes d'écriture, comme demandé. 2 tests ajoutés (un par
    route) : 30 appels valides puis un 31e → 429 `RATE_LIMITED`.
  - **[MAJEUR-2] Fermé.** `PATCH /[id]` renvoie **409 `PATIENT_ANONYMIZED`**
    si `existing.anonymizedAt !== null` (vérifié juste après le 404, avant
    la détection de doublons) ; `POST /[id]/visits` fait de même sur
    `patient.anonymizedAt !== null` (le `select` du fetch patient a été
    élargi de `{ id: true }` à `{ id: true, anonymizedAt: true }`). Même
    code et même message dans les deux routes. 1 test par route : écriture
    tentée sur une fiche `anonymizedAt: new Date()` → 409, aucune écriture
    (note inchangée / compteur de `Visit` inchangé).
  - **[MAJEUR-3] Fermé.** `orderBy: [{ startTime: "desc" }, { id: "desc" }]`
    sur le `appointment.findMany` et `orderBy: [{ date: "desc" }, { id:
    "desc" }]` sur le `visit.findMany` de `GET /[id]/history` — départage au
    niveau base pour chacune des deux sources. Le comparateur TypeScript du
    tri fusionné a lui aussi été départagé : `if (byDate !== 0) return
    byDate; return b.id.localeCompare(a.id);` — nécessaire séparément du
    tri en base, puisque la fusion mélange deux sources (`Appointment` et
    `Visit`) dont l'ordre relatif au sein d'une même date n'est garanti par
    aucun des deux `orderBy` pris isolément. **Preuve exigée** : test à deux
    pages (`limit=2`, `page=1` puis `page=2`) avec **trois** `Visit` portant
    exactement le même `date` (`2026-01-10T00:00:00.000Z` — millisecondes
    identiques, cas normal vu que `visitCreateSchema.date` accepte un
    `YYYY-MM-DD` nu converti en minuit UTC) — assertion `total === 3`,
    `page1.items.length === 2`, `page2.items.length === 1`, aucun id répété
    (`new Set(ids).size === 3`) et aucun id manquant (ensemble des ids des 2
    pages === ensemble des 3 ids créés). Je n'ai **pas** tenté de faire
    échouer ce test contre le code d'avant-fix (contrairement au BLOQUANT) :
    l'instruction ne l'exigeait que pour le BLOQUANT, et la non-déterminisme
    Postgres sur un ordre non spécifié n'est de toute façon pas reproductible
    à la demande (pas de `MUTATION-…` équivalent possible ici — retirer
    l'`orderBy` ne fait pas échouer le test à coup sûr, juste parfois).
  - **[MINEUR-1] Fermé.** `detail` de l'audit `PATIENT_UPDATED` devient
    `{ changedFields, ...(data.active !== undefined ? { active: data.active
    } : {}) }` — un booléen, jamais une donnée patient, ajouté seulement
    quand `active` fait partie de la requête. Test : désactiver puis
    réactiver la même fiche, vérifier `detail.active === false` puis
    `detail.active === true` sur les deux lignes d'audit successives.
  - **[MINEUR-2] Fermé.** Les 4 `requireStaff(request)` sans rôles
    (`[id]/route.ts` GET+PATCH, `history/route.ts` GET, `visits/route.ts`
    POST) sont devenus `requireStaff(request, { roles: ["ADMIN",
    "RECEPTIONIST"] })` — aligné sur la colonne `allowed` de
    `tests/authz-matrix.test.ts` pour ces 4 lignes. Comportement inchangé
    aujourd'hui (2 rôles seulement existent) ; fail-closed plutôt que
    fail-open si un 3e rôle apparaît un jour. `src/app/api/admin/patients/route.ts`
    (GET/POST liste, étape 4) **volontairement pas touché** — hors
    périmètre explicite de cette revue (seules les 4 lignes `[id]*`
    étaient listées).
  - **Arbitrage `active: false` — documenté, pas modifié.** Commentaire
    ajouté dans `[id]/route.ts`, juste avant le contrôle de rôle ADMIN sur
    `active`, reprenant mot pour mot la décision rendue : « désactivée =
    masquée, pas bloquée » — une fiche désactivée reste réservable en ligne
    et éditable ; `upsertPatient()` **n'a pas été modifié** pour filtrer sur
    `active` (seul `anonymizedAt` y est filtré, ajouté à l'étape 5 tour 1).
    **Contrainte inscrite pour l'étape 8** : le bouton devra dire
    « Désactiver », jamais « Supprimer ».
  - **Ordre des gardes vérifié pour chaque route touchée** — inchangé par
    rapport au tour 1, les nouveaux contrôles s'insèrent SANS le perturber :
    `PATCH` : `requireStaff` → CSRF → **rate limit (nouveau)** → Zod → garde
    rôle `active` → validation téléphone → 404 → **`anonymizedAt` (nouveau)**
    → détection de doublons (**dual d'abord**, puis NAME, puis PHONE) →
    écriture. `POST /visits` : `requireStaff` → CSRF → **rate limit
    (nouveau)** → Zod → 404 → **`anonymizedAt` (nouveau)** → `serviceId` →
    écriture. Aucun 404 ne précède encore un 401/403 ; le contrôle de rôle
    sur `active` reste avant la lecture DB.
  - **Réutilisé, rien réécrit** : `checkRateLimit`/`RateLimitError`
    (`@/lib/security/rateLimit`, déjà importé dans `[id]/route.ts` pour le
    GET, importé nouvellement dans `visits/route.ts`), `findDuplicateCandidates`
    (non modifié — le filtrage dual se fait côté route sur le résultat déjà
    renvoyé, pas dans le module), `logAction`/`getClientIp`/`errorResponse`/
    `withRefreshedSession` (inchangés).
  - **Résultats des commandes** :
    - `npm run typecheck` → OK. `npm run lint` → OK.
    - Preuve rouge du BLOQUANT (isolée) → **1 test échoue** comme attendu,
      voir ci-dessus. Mutation retirée avant de continuer.
    - `npx vitest run tests/integration/patient-record.test.ts` →
      **27/27 verts** (19 avant ce tour + 8 nouveaux : preuve BLOQUANT +
      succès double-acquittement + `PATIENT_ANONYMIZED` PATCH +
      `detail.active` + débit PATCH + `PATIENT_ANONYMIZED` visits + débit
      visits + pagination historique).
    - `npx vitest run tests/authz-matrix.test.ts` → **39/39 verts**, inchangé
      (les 4 lignes patients continuent de passer avec les rôles désormais
      explicites — comportement identique, code plus défensif).
    - `npm test` complet → **447/447 verts** (439 + 8), 41 fichiers.
  - **Non fait volontairement** : aucune implémentation de
    `lib/privacy/anonymize.ts` ni de `POST /[id]/anonymize` (étape 6, hors
    périmètre explicite de ce tour — seule la garde 409 contre une fiche
    déjà anonymisée a été ajoutée) ; aucun composant React ; aucune
    migration ; extraction de la garde de doublon dupliquée entre `POST` et
    `PATCH` (dette déjà portée, pas dans le périmètre de ce tour) ; test
    messaging `active`, alef-hamza, `plan.md` (dettes déjà portées, non
    traitées) ; aucune case cochée dans `tasks/todo.md` ; aucune commande
    git d'écriture ; aucun `git stash`/`checkout`/`reset` utilisé (mutation
    du BLOQUANT appliquée et retirée à la main, avec preuve `grep` que le
    marqueur temporaire n'a laissé aucune trace).
  - **Signalé sans y toucher** : `DATABASE_URL` jamais affiché ; cible base
    forcée sur `TEST_DATABASE_URL` (`*localhost*` contrôlé) avant chaque
    commande touchant la base ; `git status --porcelain` final cohérent
    avec l'état laissé par le tour précédent (mêmes fichiers `??`/`M`, plus
    les 2 nouveaux fichiers de ce tour : `src/lib/patients/rateLimits.ts`
    et les modifications de `tests/integration/patient-record.test.ts`,
    déjà `??`).
  - **Verdict : VERT.**

### Étape 6 — Anonymisation (`lib/privacy/anonymize.ts` + `POST /[id]/anonymize`, ADMIN)
- [ ] Statut : à faire
- **But** : honorer une demande d'effacement en effaçant les champs identifiants tout en
  **conservant la coquille des rendez-vous**, pour que les statistiques restent justes.
- **Agents recommandés** : `ortho-backend`, `ortho-security` (**obligatoire**), `ortho-tester`.
- **Fichiers à créer / modifier** :
  - `src/lib/privacy/anonymize.ts` (créer)
  - `src/lib/privacy/anonymize.test.ts` (créer)
  - `src/app/api/admin/patients/[id]/anonymize/route.ts` (créer — `POST`)
  - `tests/authz-matrix.test.ts` (1 ligne ajoutée)
  - `tests/integration/patient-anonymize.test.ts` (créer)
- **Ce qu'il faut faire** :
  1. `anonymizePatient(patientId: string, actor: AuditActor, ipAddress?: string | null)`,
     dans **une seule transaction** `getPrisma().$transaction(...)` :
     - `Patient` : `firstName = "Patient"`, `lastName = "anonymisé"`, `phone = ""`,
       `phoneE164 = ""`, `email = null`, `birthDate = null`, `notes = null`,
       `messagingOptOut = true`, `active = false`, `anonymizedAt = new Date()`.
     - `Appointment.visitNotes = null` pour tous les rendez-vous du patient (note
       clinique en texte libre : peut contenir un identifiant).
     - `Visit.notes = null` et `Visit.treatment = null` pour toutes ses visites.
     - **Ce qui est conservé, délibérément** : les lignes `Appointment` elles-mêmes (id,
       dates, `serviceId`, `status`, horodatages de statut) et les lignes `Visit` (id,
       date, `serviceId`, `type`). Les compteurs et KPI restent exacts.
     - Idempotence : si `anonymizedAt` est déjà posé, ne rien réécrire et signaler le cas
       à l'appelant (le route handler renvoie 409 `ALREADY_ANONYMIZED`).
     - `phoneE164 = ""` doit **rester invisible** pour la détection de doublons :
       celle-ci exclut déjà les patients anonymisés (étape 3) — ajouter un test qui le
       prouve avec deux patients anonymisés, qui ne doivent pas se rapprocher l'un de
       l'autre.
     - Commentaire d'en-tête citant `plan.md §Data retention & erasure`.
  2. Route `POST /[id]/anonymize` : `requireStaff(request, { roles: ["ADMIN"] })` →
     `assertSameOriginStrict` → `anonymizeSchema` (`{ confirm: true }`, sinon 400) →
     404 si inconnu → 409 si déjà anonymisé → appel du module → audit
     `PATIENT_ANONYMIZED` sur `"Patient"`/`id` avec
     `detail: { appointmentsKept: <n>, visitsKept: <n> }` — **aucune trace des valeurs
     effacées** ; le journal d'audit ne doit surtout pas devenir la copie de sauvegarde
     de ce qu'on vient d'effacer. Réponse 200 minimale :
     `{ id, anonymizedAt, appointmentsKept, visitsKept }`.
  3. Ajouter la ligne matrice : `POST /api/admin/patients/[id]/anonymize`,
     `allowed: [ADMIN]`, `okStatus: 400` (corps vide). Le **réceptionniste doit recevoir
     403**.
- **Critères d'acceptation** :
  - `npm test -- authz-matrix` vert ; le réceptionniste reçoit bien 403 sur
    `POST .../anonymize`.
  - `npm test -- anonymize` vert, avec le test central exigé par le `todo.md` : créer un
    patient avec **3 rendez-vous `COMPLETED`** et 2 `Visit`, anonymiser, puis vérifier
    que `prisma.appointment.count({ where: { patientId } })` vaut **toujours 3**, que
    `visit.count` vaut toujours 2, et que `firstName`, `lastName`, `phone`, `phoneE164`,
    `email`, `birthDate`, `notes`, `visitNotes`, `Visit.notes`, `Visit.treatment` sont
    vidés.
  - Anonymiser deux fois → la seconde fois **409 `ALREADY_ANONYMIZED`**, et
    `anonymizedAt` **n'est pas** modifié.
  - Une ligne `PATIENT_ANONYMIZED` existe avec `actorType STAFF` et un `detail` ne
    contenant **aucune** des valeurs effacées (assertion explicite sur le JSON).
  - `npm run typecheck` + `npm run lint` verts, `npm test` complet vert.
- **Vigilance sécurité** : **oui — données patient, rôles, opération irréversible**.
  Point de vigilance particulier : le journal d'audit et les messages d'erreur ne doivent
  contenir aucune des données effacées. `ortho-security` **obligatoire**.
- **Journal** :

### Étape 7 — Écran liste patients + recherche + création (avertissement doublon en ligne)
- [ ] Statut : à faire
- **But** : l'écran d'entrée du dossier patient, avec le formulaire de création et son
  bandeau de doublon **en ligne, jamais bloquant**.
- **Agents recommandés** : `ortho-frontend`, `ortho-tester`.
- **Fichiers à créer / modifier** :
  - `src/app/admin/(dashboard)/patients/page.tsx` (créer)
  - `src/components/admin/PatientList.tsx` (créer)
  - `src/components/admin/PatientForm.tsx` (créer — réutilisé en édition à l'étape 8)
  - `src/components/admin/DuplicateWarning.tsx` (créer)
  - `src/components/admin/Sidebar.tsx` (ajouter l'entrée de navigation)
- **Ce qu'il faut faire** :
  1. Page serveur sous `(dashboard)` (le layout garantit déjà la session) ; rend le
     composant client. Ajouter
     `{ href: "/admin/patients", label: "Patients", adminOnly: false }` dans `NAV_ITEMS`
     de `Sidebar.tsx`.
  2. `PatientList` : champ de recherche (soumission explicite, pas à chaque frappe),
     filtre actif/inactif, tableau `nom, prénom, téléphone, statut`, pagination.
     Trois états explicites et distincts : **chargement** (squelette ou libellé
     « Chargement… », `aria-busy`), **vide** (« Aucun patient trouvé. » + action
     « Nouveau patient »), **erreur** (« Impossible de charger la liste des patients. »
     + bouton Réessayer). Calquer la structure d'états sur
     `src/components/admin/AuditViewer.tsx`.
  3. `PatientForm` : champs alignés **exactement** sur `patientCreateSchema`
     (`@/schemas/patient`) — la validation client importe le schéma, elle ne le
     redéfinit pas. Erreurs de champ en FR, liées au champ par `aria-describedby`.
  4. `DuplicateWarning` : sur une réponse **409 `DUPLICATE_CANDIDATES`**, afficher un
     **bandeau en ligne** au-dessus du formulaire (`role="alert"`, focus déplacé dessus),
     listant les candidats (nom, téléphone, statut, lien vers la fiche), avec **deux
     actions** : « Ouvrir la fiche existante » et **« C'est une personne différente —
     enregistrer quand même »**. Le second bouton re-soumet avec
     `duplicateAcknowledged: true`. Le formulaire reste **entièrement éditable** pendant
     l'affichage du bandeau.
     **Interdits** : `window.confirm`, `<dialog>` modal, overlay, désactivation du bouton
     d'enregistrement. Le critère du `todo.md` est explicite : jamais d'impasse bloquante.
  5. Après création réussie : redirection vers `/admin/patients/<id>` (écran de l'étape 8).
     Si l'étape 8 n'est pas encore livrée, revenir à la liste avec un message de succès —
     l'étape doit être testable seule.
  6. Accessibilité et cohérence : navigation clavier complète, anneaux de focus visibles
     (`focus-visible:ring-teal-600` comme la Sidebar), `<label>` associé à chaque champ.
     **`dir="auto"` sur toute cellule ou champ affichant un nom, un téléphone ou une note
     saisis** (un nom arabe doit rester lisible dans une interface LTR).
- **Critères d'acceptation** :
  - `npm run dev` : `/admin/patients` connecté en réceptionniste affiche la liste ;
    déconnecté, redirection vers `/admin/login`.
  - Créer un patient depuis l'écran fonctionne ; recréer le **même nom** affiche le
    bandeau **en ligne** (aucune modale, la page reste utilisable au clavier), et
    « enregistrer quand même » crée bien le second patient.
  - Le bandeau reçoit le focus et est annoncé (`role="alert"`) ; aucune saisie n'est
    perdue (il n'y a pas de modale à fermer).
  - Les trois états liste (chargement / vide / erreur) sont observables : filtre sans
    résultat pour l'état vide, serveur coupé pour l'état erreur.
  - Un patient nommé en caractères arabes s'affiche correctement (grâce à `dir="auto"`)
    dans une page qui reste `dir="ltr"`.
  - `npm run lint` + `npm run typecheck` verts ; `npm test -- authz-matrix` toujours vert
    (le test `dir="ltr"` du layout admin ne doit pas casser).
- **Vigilance sécurité** : **oui — données patient à l'écran**. Aucun `console.log` de
  patient (il finirait dans la console d'un poste partagé). **Aucune donnée patient dans
  une query string** : la recherche `?q=` est un cas accepté et documenté (elle reste sur
  `/api/admin/*`, même origine, dashboard sans script tiers) — mais un identifiant, un
  nom ou un téléphone ne doit apparaître dans **aucune URL de redirection ni aucun
  message d'erreur**. Aucun script tiers ajouté au dashboard.
  **i18n** : dashboard **FR uniquement** — ne pas ajouter de clés à
  `messages/fr|ar|en.json` pour ces écrans (décision Tâche 12, vérifiée dans
  `src/app/admin/layout.tsx`).
- **Journal** :

### Étape 8 — Écran fiche patient : timeline unifiée, édition, visite, désactivation, anonymisation
- [ ] Statut : à faire
- **But** : l'écran de la fiche patient, avec l'historique unifié et ses états définis, et
  les actions ADMIN destructives correctement encadrées.
- **Agents recommandés** : `ortho-frontend`, `ortho-security`, `ortho-tester`.
- **Fichiers à créer / modifier** :
  - `src/app/admin/(dashboard)/patients/[id]/page.tsx` (créer)
  - `src/components/admin/PatientDetail.tsx` (créer)
  - `src/components/admin/PatientTimeline.tsx` (créer)
  - `src/components/admin/AddVisitForm.tsx` (créer)
  - `src/components/admin/AnonymizePatientAction.tsx` (créer)
- **Ce qu'il faut faire** :
  1. Page serveur : `params` est une **Promise** (`const { id } = await params;`).
     Le layout `(dashboard)` garantit la session ; passer `role` au composant client pour
     n'afficher les actions ADMIN qu'aux ADMIN — **l'API reste la seule autorité**,
     masquer un bouton n'est pas un contrôle d'accès.
  2. `PatientDetail` : bloc identité + `PatientForm` (celui de l'étape 7) en mode édition,
     réutilisant le **même** `DuplicateWarning` en ligne. Bandeau permanent si
     `anonymizedAt` est posé : « Dossier anonymisé — identifiants effacés », formulaire en
     lecture seule.
  3. `PatientTimeline` : lit `GET /api/admin/patients/[id]/history`. Chaque élément
     distingue visuellement `APPOINTMENT` et `VISIT` (badge FR : « Rendez-vous » /
     « Visite »), affiche la date en heure locale clinique, le service, le type, les
     notes. **États obligatoires** (critère explicite du `todo.md`) :
     - chargement : squelette de 3 lignes, `aria-busy="true"` ;
     - vide : « Aucun rendez-vous terminé ni visite enregistrée pour ce patient. » ;
     - erreur : message + bouton Réessayer.
     `dir="auto"` sur les notes et traitements.
  4. `AddVisitForm` : formulaire aligné sur `visitCreateSchema`, `POST .../visits`, puis
     rechargement de la timeline. Sélecteur de service **facultatif** (une visite manuelle
     peut ne correspondre à aucun service).
  5. Désactivation (**ADMIN**) : bouton « Désactiver ce dossier » → `PATCH { active: false }`.
     Confirmation **en ligne** (bandeau à deux boutons), texte explicite : « Le dossier
     est masqué mais rien n'est supprimé ; l'historique est conservé. »
  6. `AnonymizePatientAction` (**ADMIN**) : action clairement séparée et visuellement
     distincte (zone « Demande d'effacement »). Avertissement d'irréversibilité, puis une
     **confirmation explicite** (saisie du nom de famille du patient, ou case à cocher
     dédiée) avant `POST .../anonymize` avec `{ confirm: true }`. Après succès :
     rafraîchir la fiche, afficher le bandeau « Dossier anonymisé », **et rappeler à
     l'écran que l'historique des rendez-vous est conservé** (c'est voulu, pas un bug).
  7. Aucune modale bloquante nulle part sur cet écran.
- **Critères d'acceptation** :
  - `/admin/patients/<id>` affiche la fiche ; ouvrir la page produit une ligne
    `PATIENT_RECORD_VIEWED` `scope: "record"` visible dans `/admin/audit`, plus une ligne
    `scope: "history"`.
  - Les trois états de la timeline sont observables : patient sans historique → message
    vide ; patient avec 1 rendez-vous `COMPLETED` + 1 `Visit` → 2 éléments triés du plus
    récent au plus ancien ; un rendez-vous `CANCELLED` n'apparaît **pas**.
  - Ajouter une visite manuelle la fait apparaître dans la timeline sans rechargement
    complet de la page.
  - Connecté en **réceptionniste** : les boutons « Désactiver » et « Anonymiser » ne sont
    pas rendus, **et** un appel direct à l'API (curl/DevTools) renvoie **403**.
  - Anonymiser en ADMIN : la fiche perd ses identifiants, le bandeau « Dossier anonymisé »
    s'affiche, **le nombre d'éléments de la timeline est inchangé**, et `/admin/audit`
    montre `PATIENT_ANONYMIZED`.
  - Modifier le téléphone vers celui d'un autre patient affiche le bandeau doublon **en
    ligne** avec « enregistrer quand même », sans jamais bloquer la saisie.
  - `npm run lint`, `npm run typecheck`, `npm test` complets verts.
- **Vigilance sécurité** : **oui — données patient, rôles, action irréversible**.
  `ortho-security` **obligatoire** : c'est l'écran qui expose le plus de champs et qui
  déclenche l'effacement. Vérifier qu'aucune donnée patient ne part dans un log, une URL
  ou un service tiers, que le masquage de bouton n'est jamais présenté comme le contrôle
  d'accès, et que la confirmation d'anonymisation ne peut pas être déclenchée par un
  simple double-clic. **i18n** : FR uniquement (dashboard) ; `dir="auto"` sur les
  contenus saisis.
- **Journal** :

## Risques
1. **Le harnais d'autorisation est le point de rupture de cette tâche.** Face à un test
   qui coince sur une route dynamique, la solution de facilité est d'assouplir le filtre
   de scan de `tests/authz-matrix.test.ts` — ce qui désarmerait la surveillance RBAC
   précisément sur les routes patients, les plus exposées à l'IDOR. L'étape 2 existe pour
   rendre cette facilité inutile. **Toute modification du filtre de scan, de
   `HTTP_METHODS` ou de `expect(missing).toEqual([])` doit être refusée en revue.**
2. **Deux angles morts connus du même fichier**, hors périmètre ici, à remonter à
   l'utilisateur : le scan ne détecte que `route.ts` (un `route.tsx` passerait sous le
   radar) et `OPTIONS` est absent de `HTTP_METHODS`.
3. **`GET /api/admin/patients` (liste) ne journalise rien** — décision de ce plan, pour ne
   pas noyer le journal d'audit sous les recherches. C'est un compromis : une recherche
   par nom **est** une lecture de données patient. À confirmer explicitement par
   `ortho-security` à l'étape 4 ; si le verdict est inverse, journaliser
   `PATIENT_RECORD_VIEWED` avec `detail: { scope: "list", resultCount }` — **jamais la
   chaîne `q` elle-même**.
4. **Rapprochement de noms exact, insensible à la casse uniquement.** Deux
   translittérations d'un même nom arabe (`Mohamed` / `Mohammed`) ne seront pas
   rapprochées. Le critère du `todo.md` ne l'exige pas (la preuve demandée porte sur le
   **téléphone**), et le rapprochement flou est un sujet à part entière. Risque assumé et
   documenté ; à proposer comme amélioration ultérieure.
5. **Anonymisation et `SmsMessage` — ARBITRÉ, désormais DANS le périmètre.**
   L'utilisateur a tranché le 2026-08-28 : l'anonymisation doit aussi neutraliser
   `SmsMessage.to` et `SmsMessage.body`. Voir §Exigences point 4 pour la règle
   exacte. Risque résiduel à surveiller : l'effacement doit se faire dans la
   **même transaction** que celui de la fiche, sinon un échec partiel laisse le
   numéro du patient en base alors que sa fiche est déjà anonymisée.
6. **`« (3c schema) »`** : source de confusion sur la dépendance. Tranché dans
   §Exigences ; si un agent trouve une trace de « Task 3c », il le signale et **ne décide
   pas seul**.
7. **`phoneE164 = ""` après anonymisation** : plusieurs patients anonymisés partagent la
   même valeur vide. La détection de doublons les exclut explicitement (étape 3), et un
   test le prouve (étape 6) — si cette exclusion saute, tous les patients anonymisés se
   signaleront mutuellement comme doublons.
8. **Aucune divergence détectée** entre `tasks/todo.md` et `tasks/plan.md` sur la
   Tâche 13. Le modèle `Patient` en base couvre déjà tous les champs demandés : aucune
   migration sur `Patient` n'est nécessaire, seulement `Visit` + `VISIT_CREATED`.

## Hors périmètre
- **Documents patients, upload de fichiers, Vercel Blob** → **Tâche 15**. Ne pas créer
  `PatientDocument`, ne pas ajouter de route `documents`.
- **Gestion des rendez-vous** : file d'appels, confirmation, annulation, replanification,
  changement de statut, création manuelle de rendez-vous → **Tâche 14**. Cette tâche
  **lit** les rendez-vous `COMPLETED` pour la timeline, elle n'en écrit aucun.
- **Toute modification de `src/proxy.ts`, de `src/lib/auth/*` ou du système de session**
  → Tâche 12, terminée.
- **`tests/setup.ts`** : interdiction absolue de le modifier ou de le contourner
  (`CLAUDE.md`) — c'est le garde-fou qui empêche un `TRUNCATE` d'atteindre la base de
  production Neon.
- **Le filtre de scan de `tests/authz-matrix.test.ts`** (voir §Risques 1).
- **Rapprochement flou / phonétique / translittération des noms** (Levenshtein, Soundex,
  `pg_trgm`, extension `unaccent`) — amélioration ultérieure. ⚠️ La **normalisation**
  (minuscules, accents, espaces) est en revanche **dans** le périmètre : voir
  §Exigences point 5.
- **Purge des `AuditLog`** lors d'une anonymisation : le journal est append-only et
  ne contient aucune donnée patient. ⚠️ L'effacement des **`SmsMessage`** n'est plus
  hors périmètre — il est **dans l'étape 6** depuis l'arbitrage du 2026-08-28
  (§Exigences point 4).
- **Export CSV/XLSX de patients** → Tâches 18/21.
- **Traduction ar/en du dashboard** : le dashboard est FR uniquement (décision Tâche 12,
  vérifiée dans le code). Ne pas ajouter de clés `next-intl` pour ces écrans.
- **Modification de `errorResponse()`** dans `src/lib/api/http.ts` : helper partagé par
  tout le projet, laissé intact (voir décision 1 du §Contexte technique).
- **Cocher quoi que ce soit dans `tasks/todo.md`** : c'est l'orchestrateur qui le fait en
  fin de tâche, pas les agents d'étape.
