# Task 15 — Patient Documents (Radiographies) — Handoff après Étapes 1 et 2

**Status:** Étapes 1 et 2 terminées (schema + validation + adaptateur de stockage).  
**Étapes restantes:** 3, 4, 5 (routes, téléchargement, UI).  
**Tests:** 588/588 verts · typecheck vert · lint vert.

---

## ⚠️ POINT CRITIQUE : Le relais n'est pas dans git

Le fichier `.claude/tasks/task-15.md` (1554 lignes, contient le plan détaillé des étapes 3–5, les trois audits de sécurité et toutes les dettes) est **gitignoré** (`.gitignore:49`).

**Sans transmission externe, tu vas repartir du vide aux étapes 3–5.**

Demande ce fichier à ton collègue qui a délivré la Tâche 14, ou fais-le envoyer par mail/Slack avant de commencer l'étape 3. Les sections critiques dont ce présent document *ne peut pas* se substituer :
- Plan détaillé de chaque étape (surtout étape 4 : encodage RFC 5987 du nom de fichier)
- Les 3 audits de sécurité complets (BLOQUANT, 4 MAJEUR et 6 MINEUR sur l'étape 2 seule)
- Les dettes spécifiques à chaque étape

**Lis le relais en entier avant de coder.**

---

## État exact

### Tâches 13 et 14 : terminées ✅
- Task 13 (Patient records) : 10 étapes, audit de sécurité vert.
- Task 14 (Appointment management) : 6 routes API, audit vert.
- `npm test` : **588/588 verts** (avant Task 15 : 569).

### Task 15 : Étapes 1 et 2 complètes ✅

#### Étape 1 — Modèle `PatientDocument` + migration
**Fichiers ajoutés :**
- `prisma/schema.prisma` (+57 lignes) : `model PatientDocument` juste après `model Visit` (`:289-316`), avec `id`, `patientId`, `name`, `mimeType`, `sizeBytes`, `blobKey` (UNIQUE), `uploadedById`?, `uploadedAt`, `deletedAt`?, `deletedById`? ; relations sur `Patient` et `User`.
- `prisma/migrations/20260901225003_add_patient_document/migration.sql` : CREATE TABLE + 2 INDEX + 3 FOREIGN KEY. Strictement additif. Cascades : `patientId` → `ON DELETE RESTRICT` (patient avec docs ne peut pas être hard-delete), `uploadedById`/`deletedById` → `ON DELETE SET NULL` (perdre un staff ne détruit pas la trace).
- `tests/schema.test.ts` (+103 lignes) : 2 cas ajoutés — (a) attach PatientDocument to Patient, lire via relation, assertions sur tous les champs ; (b) FK inexistante → rejet `P2003`, preuve que `TRUNCATE ... CASCADE` atteint la table sans y être nommée.

**Vérifications :**
- ✅ `npm run db:migrate` appliquée localement (test + dev).
- ✅ `npx prisma validate` OK (lecture seule).
- ✅ `npm test` : 571/571 (569 before + 2 schema.test.ts).
- ✅ `npm run typecheck` : `getPrisma().patientDocument` typé depuis Prisma Client.
- ✅ Pas de `DROP`, `TRUNCATE`, `DELETE FROM` dans la migration.
- ✅ Pas d'appel à `npx prisma format` (fins de ligne restent CRLF, pas de mélange).

**⚠️ Enum AuditAction :** `PATIENT_DOCUMENT_UPLOADED`, `PATIENT_DOCUMENT_DELETED`, `PATIENT_DOCUMENT_DOWNLOADED` **y sont déjà** (prisma/schema.prisma `:550`, `:551`, `:565`). Aucune modification d'enum. Aucun `ALTER TYPE` dans la migration.

---

#### Étape 2 — Validation + adaptateur de stockage privé
**Fichiers créés :**
1. **`src/lib/documents/mime.ts`** (60 lignes)
   - `ALLOWED_TYPES` : fermée sur 4 types (JPEG/PNG/PDF/DICOM) avec extensions et octets magiques.
   - `MAX_DOCUMENT_BYTES = 4 * 1024 * 1024` (4 Mo) — **déclarée une seule fois**, importée par route + form.
   - `validateDocumentBytes({ fileName, declaredMimeType, bytes })` → `{ ok: true, mimeType, extension }` ou `{ ok: false, reason: "TYPE" | "EXTENSION_MISMATCH" | "CONTENT_MISMATCH" | "SIZE" }`. Ordre : type → extension → contenu → taille.
   - Export `type AllowedMimeType` et `AllowedExtension` (resserrés au typecheck).

2. **`src/lib/documents/errors.ts`** (33 lignes)
   - 5 classes : `DocumentTypeNotAllowedError` (415), `DocumentTooLargeError` (413), `DocumentNotFoundError` (404), `BlobNotConfiguredError` (503), `BlobOperationError` (502).
   - Messages FR, jamais de secret ni nom de fichier, ni `blobKey`.

3. **`src/lib/documents/blobStorage.ts`** (130 lignes)
   - **Le seul fichier du dépôt autorisé à importer `@vercel/blob`.** (Proof : `grep -rl 'from "@vercel/blob"' src` retourne **exactement 1 fichier**.)
   - `buildBlobKey(patientId, extension)` → `patients/<patientId>/<uuid>.<ext>` — **jamais dérivé du nom fourni par l'utilisateur**. Rejette les `patientId` ne respectant pas `/^[a-z0-9]+$/i` (forme d'un cuid Prisma).
   - `putDocument(blobKey, bytes, mimeType)`, `getDocumentStream(blobKey)`, `deleteDocument(blobKey)` — token lu **dans chaque fonction** (`process.env.BLOB_READ_WRITE_TOKEN`), jamais au chargement du module. Absent → `BlobNotConfiguredError` (503).
   - `access: "private"` requis sur `put` et `get` — **jamais de URL publique**.

4. **`src/schemas/document.ts`** (50 lignes)
   - `documentUploadSchema` Zod partagé route ⇄ formulaire (Definition of Done).
   - `name` : 1-255 caractères, rejette control chars, `\r`, `\n`, `/`, `\`, `..`, `"`, `;` (injection de `Content-Disposition`).
   - `declaredMimeType` : `z.enum` dérivé directement des clés de `ALLOWED_TYPES` — **pas de seconde liste**.

5. **`src/lib/documents/mime.test.ts`** (250+ lignes)
   - 14 tests unitaires, purs (0 Postgres, 0 réseau). Les 8 cas requis + 6 supplémentaires.
   - Cas requis : JPEG réel accepté ; même JPEG renommé `.png` → `EXTENSION_MISMATCH` ; HTML renommé `.jpg` → `CONTENT_MISMATCH` (test du XSS stocké) ; SVG → `TYPE` ; DICOM offset 128 accepté ; offset 0 → `CONTENT_MISMATCH` ; PDF oversized → `SIZE` ; noms interdits → rejet schéma.
   - Cas supplémentaires : PDF exactement à `MAX_DOCUMENT_BYTES` → accepté (borne inclusive) ; `buildBlobKey` format regex ; unicité des clés générées ; nom 256 caractères → rejet ; nom valide → accepté.

**Vérifications :**
- ✅ `npm test` : **588/588 verts** (571 + 14 mime.test + 3 corrections).
- ✅ `npm run typecheck` : types resserrés (`AllowedMimeType`, `AllowedExtension`) sans erreur ailleurs.
- ✅ `npm run lint` : vert.
- ✅ Preuve d'isolement : un seul importateur de `@vercel/blob`.

**Audit de sécurité (étape 2)** — voir le relais pour les détails complets. Points clés :
- ✅ BLOQUANT fermé : `"` et `;` dans le pattern de `name`, tests de régression ajoutés.
- ✅ MAJEUR-2 fermé : types resserrés, compilateur empêche `putDocument(key, bytes, file.type)`.
- ✅ MAJEUR-3 fermé : validation du `patientId` ancrée, rejet de `../../evil`.
- ✅ MAJEUR-4 adressé : plafond unique via `MAX_DOCUMENT_BYTES`.
- ⚠️ MAJEUR-1 **EN DETTE POUR ÉTAPE 4** : noms non-ASCII (arabe) lèveront `TypeError` dans `Headers.set` — étape 4 doit émettre `filename*=UTF-8''${encodeURIComponent(name)}` + ASCII fallback.
- ⚠️ MINEUR-2 **EN DETTE POUR ÉTAPE 3** : valider `file.size > MAX_DOCUMENT_BYTES` **avant** `arrayBuffer()` pour éviter le tampon en mémoire.

---

## BLOCAGE à lever avant l'étape 3

### `BLOB_READ_WRITE_TOKEN` manquant = étape 3 brisée

Le jeton pour le stockage Vercel Blob n'existe **que dans l'environnement de l'utilisateur**. Il ne sera jamais dans git ni `.env.example` (qui contient juste la clé, vide, ligne 49).

**Action de l'utilisateur (obligatoire avant étape 3) :**
1. Console Vercel → Project Settings → Storage → Blob → créer un store (ou utiliser le défaut).
2. Générer un read-write token.
3. Coller dans `.env` local : `BLOB_READ_WRITE_TOKEN="<valeur>"`.

**Contrôle sans révéler (PowerShell) :**
```powershell
Select-String -Path .env -Pattern '^BLOB_READ_WRITE_TOKEN=".+"$' -Quiet
# Retourne $True ou $False
```

### ⚠️ Piège critique : token de production = destruction en développement local

**Si le jeton est celui du store de PRODUCTION,** alors :
- Chaque test local d'envoi **écrit dans le vrai stockage de la clinique**.
- Chaque test de suppression **efface de vraies radiographies de patients réels**.

C'est exactement le piège qui a frappé ce projet avec `DATABASE_URL` (voir l'avertissement dans `.env.example:12-14`).

**Recommandation : créer un second store Vercel Blob dédié au développement.** Raison : simétrie avec `DATABASE_URL` (dev local pointé sur une base de test, jamais la production).

---

## Décision en attente (gelée jusqu'à directive de l'utilisateur)

### L'anonymisation doit-elle supprimer les documents patient ?

**Non couvert par les critères d'acceptation,** mais le problème est réel : une radiographie porte le nom du patient dans ses métadonnées (fichier DICOM, nom de fichier comme `radio-benali.jpg`). Sans suppression, l'effacement au sens de la **loi algérienne 18-07** est incomplet.

**Proposition argumentée (voir le relais §Risques 1) :** oui, lors de l'anonymisation, marquer `deletedAt`/`deletedById` sur **tous** les documents du patient et effacer les blobs correspondants, puis ajouter un compteur `documentsDeleted` à l'audit.

**Tant que l'utilisateur n'a pas tranché,** le fichier `src/lib/privacy/anonymize.ts` **reste gelé** — aucun agent ne le touche.

**Le schéma actuel le permet** : `name` peut être vidé, `deletedAt`/`deletedById` existent, `deletedById` est nullable. Une implémentation propre est structurellement possible le moment venu.

---

## Exigences fermes pour les étapes 3, 4, 5

Reprises des audits de sécurité du relais — **conditionne la sécurité de la tâche.**

### Étape 3 — Routes POST/GET `/api/admin/patients/[id]/documents`

**Validation taille AVANT lecture en mémoire :**
- Rejeter `file.size > MAX_DOCUMENT_BYTES` dès la lecture de `formData`, avant `arrayBuffer()`.
- Sinon un fichier énorme serait entièrement tamponné en mémoire avant rejet.

**Vérification manuelle du `access: "private"` :**
- Test d'intégration doit mocker le stockage et asserter explicitement `putDocument` appelé avec `access: "private"`.

**Deux lignes dans `tests/authz-matrix.test.ts` :**
- GET et POST sur `/api/admin/patients/[id]/documents` avec handlers importés par référence directe.
- `okStatus: 404` (GET sur patient inexistant) et `okStatus: 400` (POST sans corps).

### Étape 4 — Routes GET/DELETE `/api/admin/documents/[id]`

**Noms de fichiers non-ASCII (arabe) = obligation RFC 5987 :**
```
Content-Disposition: attachment; filename="<fallback ASCII>"; filename*=UTF-8''${encodeURIComponent(name)}
```
Puis post-encoder `'`→`%27` pour éviter une fausse fermeture du paramètre.

**Raison mesurée :** `name` en arabe lève `TypeError` dans `Headers.set` sans l'encodage. Clinique d'Alger, noms de fichiers arabes courants. **Ne jamais rejeter le non-ASCII** — ce serait casser le trilinguisme.

**Ordre de suppression : base PUIS blob :**
- Marquer `deletedAt`/`deletedById` d'abord.
- Puis `deleteDocument(blobKey)`.
- Si le blob échoue → répondre 200 avec `blobDeleted: false` et l'auditer ainsi.
- Le blob privé résiduel est inaccessible sans le token du store ; la ligne est déjà masquée.

**Alternative évoquée dans l'audit :** ajouter une colonne `blobDeletedAt DateTime?` (migration additive) pour distinguer « suppression douce effectuée » de « blob réellement effacé ». À décider à l'étape 4.

**404 indistinguable entre supprimé et inexistant :**
- Un document supprimé et un id inexistant doivent donner le **même code et message**.
- Ne jamais confirmer l'existence d'une radiographie effacée.

**Deux lignes dans `tests/authz-matrix.test.ts` :**
- GET et DELETE sur `/api/admin/documents/[id]`.
- `okStatus: 404` ; réceptionniste reçoit **403** sur DELETE.

### Étape 5 — UI + vérification manuelle

**Vérification manuelle cruciale :**
1. Uploader un fichier `.jpg` factice.
2. URL du blob (depuis la console Vercel) → coller dans une **fenêtre de navigation privée** (pas de session).
3. L'accès doit être **refusé** (erreur / forbidden), **jamais** le fichier s'affiche.
4. ⚠️ **Si l'image s'affiche, le blob est public : échec bloquant.** À remonter immédiatement.

Raison : le SDK réel n'est jamais exercé en CI (mocké). Cette vérification est la **seule preuve réelle** que `access: "private"` fonctionne.

---

## Pièges du dépôt (à connaître avant de toucher le code)

### ⚠️ Ne jamais lancer `npx prisma format`
Il réaligne les 20 modèles et convertit le fichier en LF alors que le dépôt est en CRLF. Diff illisible, conflit garanti avec le second développeur.
**Modifier le schéma à la main en conservant les fins de ligne CRLF.**

### ⚠️ Piège des fixtures
Un test dont la fixture appelle `getPrisma().patientDocument.create()` directement laisse toute colonne non fournie à `NULL` → le test reste **vert sans rien prouver**. S'est produit trois fois en deux jours sur ce projet.

**Règle :** les tests des étapes 3, 4 et 5 créent leurs documents **via la vraie route POST**, sauf si le test porte précisément sur un état que la route ne peut pas produire (p. ex. `mimeType: "text/html"` déjà en base). Auquel cas le `create()` direct est légitime **et doit être commenté**.

### ⚠️ `DATABASE_URL` jamais affiché
Jamais recopié depuis une trace Prisma. Si c'est imprimé, c'est exposé — traiter comme compromis.

Piège connu : `export $(grep DATABASE_URL .env)` laisse des **guillemets littéraux** dans la valeur et fait boucler Prisma jusqu'au timeout. Retirer les guillemets avec `sed` avant le `source`.

### ⚠️ Jamais modifier `tests/setup.ts`
Interdit absolu (CLAUDE.md). C'est le garde-fou qui empêche un `TRUNCATE` d'atteindre la base de production Neon. `PatientDocument` est couvert par le `TRUNCATE ... CASCADE` sur `"Patient"` sans modification du fichier — preuve structurelle : la table porte une FK vers `"Patient"`.

### ⚠️ Next.js 16 : `params`, `searchParams`, `cookies()`, `headers()` sont des Promises
Toujours les `await`. Oubli courant = le compilateur ne crie pas.

### CI rouge : `npm audit --audit-level=high` échoue
**Préexistant, pas causé par Task 15.** 2 vulnérabilités « high » sur `mysql2 < 3.22.0` tirées transitivement par `prisma@7.9.1`. Le projet est PostgreSQL, `mysql2` n'est jamais chargé.

`.github/workflows/ci.yml:46` lance cette commande et **fera échouer la CI à chaque push** (déjà rouge sur `main`). À traiter après la Tâche 15 (décision d'équipe, `overrides` ou exception documentée). **Ne pas lancer `npm audit fix --force`** — il installerait `prisma@6.19.3`, une rétrogradation majeure.

---

## Fichiers et chemins clés

| Chemin | Contenu |
|---|---|
| `prisma/schema.prisma:289-316` | `model PatientDocument` |
| `prisma/migrations/20260901225003_add_patient_document/` | Migration |
| `src/lib/documents/mime.ts` | Liste blanche, validation |
| `src/lib/documents/errors.ts` | 5 classes d'erreur typées |
| `src/lib/documents/blobStorage.ts` | **Seul** importateur de `@vercel/blob` |
| `src/schemas/document.ts` | Zod partagé route ⇄ form |
| `src/lib/documents/mime.test.ts` | 14 tests validation |
| `.env.example:49` | `BLOB_READ_WRITE_TOKEN=""` |
| `tests/authz-matrix.test.ts` | Matrice d'autorisation (4 lignes dues aux étapes 3+4) |
| `tests/integration/patient-documents.test.ts` | À créer (étape 3) |
| `src/app/api/admin/patients/[id]/documents/route.ts` | À créer (étape 3) |
| `src/app/api/admin/documents/[id]/route.ts` | À créer (étape 4) |
| `src/components/admin/PatientDocuments.tsx` | À créer (étape 5) |

---

## Résumé pour le repreneur

**Tâche 15 = Upload sécurisé de radiographies de patients dans Vercel Blob (privé).**

**Livré (étapes 1–2) :**
- Modèle de données, migrations appliquées.
- Validation MIME/taille/octets magiques + adaptateur de stockage encapsulé.
- 588 tests verts, typecheck + lint propres.

**Avant toi (étape 3) :**
- Obtenir le relais `.claude/tasks/task-15.md` (sinon tu vas au crash aux étapes 3+).
- Faire remplir `.env` local avec `BLOB_READ_WRITE_TOKEN` (action utilisateur, **pas d'agent**).
- Lire les audits de sécurité du relais, notamment MAJEUR-1 (encodage RFC 5987 pour étape 4).

**Étapes restantes (toi) :**
- Étape 3 : POST/GET routes + test de matrice d'autorisation (2 lignes).
- Étape 4 : GET/DELETE routes, en-têtes RFC 5987 pour noms arabes, logique suppression.
- Étape 5 : UI + vérification manuelle (la seule qui exerce le vrai Vercel Blob).

**Points critiques à ne pas perdre :**
- `access: "private"` n'est jamais optionnel.
- Noms de fichiers arabes → RFC 5987 requis en étape 4.
- Test manuel d'étape 5 point 3 (URL brute en nav privée) = seule preuve réelle.
- Jamais `npx prisma format`.
- Jamais toucher `anonymize.ts` sans directive utilisateur.
