---
name: dette-authz-matrix-avant-tache-13
description: État du garde-fou tests/authz-matrix.test.ts après durcissement du 2026-08-28 — 4 protections mécaniques posées, 5 dettes restantes à faire respecter humainement aux étapes 4/5/6/7
metadata:
  type: project
---

`tests/authz-matrix.test.ts` est le garde-fou qui vérifie qu'aucune route admin n'échappe au contrôle d'accès. Durci en 3 tours à l'étape 2 de la Tâche 13 (2026-08-28).

## Fermé mécaniquement — ne pas défaire

1. **Scan élargi** à `route.ts|tsx|js|jsx`, motif ancré `(^|[\\/])` (un `route.tsx` était une route servie mais invisible ; `myroute.ts` matchait à tort).
2. **`OPTIONS` ajouté** — `HTTP_METHODS` couvre les 7 méthodes Next 16, la liste est complète.
3. **`okStatus` verrouillé** par un type liste blanche `200|201|204|400|404|409|422` **et** un invariant runtime. Écrire `403` rendait une ligne tautologique : la branche « autorisé » s'effondrait sur la branche « interdit » et la route n'était plus surveillée.
4. **`handler` lié à sa route** (`expect(mismatched).toEqual([])`) et **acteurs dérivés** de `Object.keys(EXPECTED)`.

Le n°4 est le plus important : un copier-coller du handler `audit` sur une autre ligne faisait passer **les 4 cellules au vert** (401/401/403/200) sans jamais exécuter la vraie route. Fausse assurance, le pire mode de défaillance.

## Dettes restantes — aucun test ne peut les attraper

- **`allowed` n'est confronté à aucune référence.** Une ligne trop permissive devient verte dès que la route est implémentée aussi permissivement : la matrice **certifie** l'escalade au lieu de la détecter. ⚠️ Étape 6 : `anonymize` et `deactivate` sont ADMIN-only — diffuser `allowed` ligne à ligne contre §Décisions 3 du relais.
- `requestPath`/`params` non contraints entre eux ni avec `scanPath` (libellé de test potentiellement menteur).
- Couverture unidirectionnelle : une ligne pointant vers une route supprimée reste verte.
- L'acteur `deactivated` est toujours un RECEPTIONIST — un ADMIN désactivé n'est jamais exercé.
- CSRF absent de la matrice → assertion à mettre dans les tests d'intégration des étapes 4/5/6.
- Pages `src/app/admin/**` toujours hors scan → étape 7.
- `okStatus` n'interdit pas `5xx` : suivre `request.json().catch(() => null)` sinon un corps vide donne 500.

**Why:** Ce fichier est l'unique filet automatique contre l'accès non autorisé aux données patient. Le risque n'est pas l'attaque mais l'accident : quelqu'un qui écrit 6 routes sous pression et cherche le chemin le plus court.

**How to apply:** traiter toute modification qui **réduit** la détection comme un signal d'alarme (filtre de scan, `HTTP_METHODS`, `expect(missing)`, type `AuthorizedOkStatus`, invariants). L'élargir est en revanche toujours autorisé. Les dettes ci-dessus se font respecter en **revue humaine**, pas par un test — les rappeler explicitement dans les briefings des étapes 4, 5, 6 et 7.

Voir aussi [[bug-windows-chemins-tests]], [[infra-postgres-local-operationnel]], [[agents-behaviour-notes]].
