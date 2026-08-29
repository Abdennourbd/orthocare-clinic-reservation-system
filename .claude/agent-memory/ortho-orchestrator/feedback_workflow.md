---
name: workflow-verification-manuelle
description: L'utilisateur vérifie le rendu lui-même dans le navigateur avant de trancher — proposer l'option « vérifier d'abord » est souvent superflu
metadata:
  type: feedback
---

Quand un écart existe entre l'état documenté et l'état réel du code, l'utilisateur a souvent **déjà vérifié le rendu lui-même** dans le navigateur. Il tranche vite et demande directement l'action suivante.

**Why:** Sur l'écart Task 11 (`todo.md` disait tout non fait, `task11-todo.md` disait tout fait), j'ai proposé trois options dont « vérifier d'abord le code ». Sa réponse : « j'ai déjà vu les pages où il existe déjà, je veux que tu construises le summary ». La vérification visuelle était déjà faite de son côté.

**How to apply:** Face à un écart de documentation, présenter l'écart factuellement (c'est la règle : ne jamais trancher seul entre `todo.md` et `task<N>-todo.md`), mais proposer en priorité l'action corrective concrète plutôt qu'une étape de vérification supplémentaire. Il enchaîne volontiers deux demandes dans un seul message (« fais X et après explique-moi Y ») — dans ce cas, lancer les deux agents en parallèle s'ils ne partagent aucun fichier.

Voir aussi [[user-profile]].
