---
name: infra-postgres-local-operationnel
description: PostgreSQL 17 local installé et fonctionnel depuis le 2026-08-28 — les tests tournent enfin ; historique du blocage précédent conservé
metadata:
  type: project
---

**PostgreSQL 17.11 est installé et opérationnel sur la machine** depuis le 2026-08-28.

- Service Windows `postgresql-x64-17`, statut `Running`, port 5432.
- Binaires dans `C:\Program Files\PostgreSQL\17\bin\` — **`psql` n'est PAS dans le PATH**, il faut appeler le chemin complet.
- Base de test `orthocare_test`, superuser `postgres`. `TEST_DATABASE_URL` dans `.env` pointe dessus.
- Les 6 migrations sont appliquées, les 15 tables du `TRUNCATE` de `tests/setup.ts` existent.
- `SESSION_SECRET` était **absent de `.env`** alors que `src/lib/auth/session.ts` le lit et lève une erreur sans lui — ajouté le 2026-08-28. Vérifier ce genre d'écart `.env` / `.env.example` après toute tâche qui ajoute une variable.

**Why:** Avant cette date, aucun Postgres local n'existait et les 272 tests étaient tous inexécutables — donc la Task 12 a été commitée (`d983bfa`, « task 12 done, security, tested ») **sans que ses tests aient jamais tourné**. Ne pas se fier aux mentions « tested » des commits antérieurs au 2026-08-28.

**How to apply:**
- `npm test` fonctionne maintenant : un `ROUGE` d'`ortho-tester` redevient un vrai échec de code, plus un blocage d'infra. Ne plus réflexivement classer un échec en problème de base.
- Pour viser la base de test en ligne de commande, **toujours** exporter `DATABASE_URL=$TEST_DATABASE_URL` avant `prisma migrate deploy`. Un `npm run db:deploy` nu viserait la Neon de **production**.
- Référence mesurée le 2026-08-28 : **348 tests passent / 349**, 36 fichiers verts sur 37.
- Attention disque : **8,6 Go libres sur C: (97% plein)**. Éviter de faire installer de gros outils sans prévenir l'utilisateur.

Voir aussi [[agents-behaviour-notes]], [[user-profile]], [[bug-windows-chemins-tests]].

## Contention : une seule suite de tests à la fois (2026-08-28)

La base `orthocare_test` est **partagée par tous les agents**, et `tests/setup.ts` fait un `TRUNCATE` en `beforeEach`. Deux agents qui lancent `npm test` **en même temps** se vident la base l'un sous l'autre et produisent de faux échecs, non reproductibles et très coûteux à diagnostiquer. `vitest.config.ts` a `fileParallelism: false`, ce qui protège **à l'intérieur** d'un run, pas entre deux runs concurrents.

**How to apply:** quand `ortho-security` et `ortho-reviewer` tournent en parallèle (ce qui reste la règle), n'autoriser **qu'un seul** des deux à lancer la suite complète. Donner à l'autre les résultats déjà obtenus et lui interdire explicitement `npm test` — `npm run typecheck` et `npm run lint` restent sans risque, ils ne touchent pas la base. Même règle pour tout correctif annexe : le séquencer, jamais le paralléliser avec une étape en cours.
