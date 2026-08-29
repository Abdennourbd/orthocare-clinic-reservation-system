---
name: bug-windows-chemins-tests
description: Les tests qui parcourent des dossiers échouent sur Windows — readdir renvoie des antislashs ; piège récurrent à vérifier dans tout test de balayage de fichiers
metadata:
  type: project
---

Sur cette machine (Windows), `readdirSync(dir, { recursive: true })` renvoie des chemins avec **antislash** : `audit\route.ts`, pas `audit/route.ts`.

Conséquence observée dans `tests/authz-matrix.test.ts` : la normalisation enchaîne `.replace(/\/route\.ts$/, "")` **puis** `.replace(/\\/g, "/")`. Dans cet ordre, la première regex ne matche pas sur Windows et le chemin obtenu est `/api/admin/audit/route.ts` au lieu de `/api/admin/audit`. Le test de couverture échoue alors qu'il n'y a **aucun trou de sécurité** : la route est bien protégée et bien présente dans la matrice.

**Why:** Le projet est développé sous Windows mais la CI tourne sous Linux, où ce bug est invisible. Tout test qui balaye l'arborescence de fichiers est donc vert en CI et rouge en local — ce qui fait perdre du temps et fait croire à une régression fonctionnelle.

**How to apply:**
- Face à un test rouge en local et vert en CI, **suspecter le séparateur de chemin avant toute autre hypothèse**.
- Règle : normaliser les antislashs **en premier**, découper ensuite. Ou mieux, utiliser `path.posix` / `split(path.sep).join("/")`.
- Ne jamais conclure à une faille d'autorisation sur la seule foi d'un échec de `authz-matrix.test.ts` — vérifier d'abord que la route a bien son `requireStaff`.

Voir aussi [[infra-postgres-local-operationnel]].
