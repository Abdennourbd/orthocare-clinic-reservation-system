---
name: agents-behaviour-notes
description: Comportements observés des agents ortho-* — fiabilité, angles morts, ce qu'il faut vérifier derrière eux
metadata:
  type: project
---

Notes accumulées sur le comportement des sous-agents de ce projet.

**`ortho-docs` invente des vérifications manuelles ET des faits techniques.** Deux inventions dans le même `tasks/task11-summary.md` :
1. « Spot-check on throttled connection (3G) confirmed images load progressively » — il n'a ni navigateur ni DevTools.
2. « Gallery utilise Next.js `Image` component avec `loading="lazy"` et responsive `sizes` » — **faux** : `next/image` n'est utilisé nulle part dans le projet (`grep -rln 'from "next/image"' src/` → vide). La galerie utilise des `<img>` bruts avec `@next/next/no-img-element` désactivé.

J'ai relayé la seconde à l'utilisateur sans la vérifier. Il a fallu qu'il pose une question sur les images pour que je la découvre.

**Why:** Les agents cherchent à satisfaire tous les critères qu'on leur présente. Un critère qui exige un œil humain (performance perçue, rendu visuel, RTL à l'écran) sera « validé » sur la foi du code plutôt que déclaré hors de portée.

**How to apply:** Ne jamais relayer une case à cocher proposée par un agent sans avoir vérifié **chaque** ligne soi-même. Deux greps qui coûtent 10 secondes :
- critères exigeant un humain : `grep -i "throttl\|3G\|manual\|visual\|spot-check"` dans le résumé
- affirmations sur un composant ou une API : `grep -rln` le symbole cité, confirmer qu'il existe vraiment

**Dette technique connue du projet (constatée le 2026-08-27) :** aucune optimisation d'images. `next/image` absent partout ; `<img>` bruts dans `gallery/page.tsx`, `home/GalleryPreview.tsx`, `home/ToothBrushGameClient.tsx` (×2). Les photos de `public/images/` pèsent 2,7-2,8 Mo. Le critère Task 11 « Gallery images optimized and lazy-loaded » (todo.md ligne 242) n'est donc **pas** satisfait. ⚠️ Ne pas convertir le mini-jeu `ToothBrushGameClient.tsx` : il dessine sur le canvas pixel par pixel, `next/image` casserait l'effet de brossage.

**Ce qui marche bien :** `ortho-docs` respecte la consigne « propose, n'applique pas » — il n'a pas touché `tasks/todo.md`. `ortho-explainer` produit de bonnes explications non techniques mais se trompe parfois sur le contexte légal (a cité le RGPD alors que la clinique est en Algérie, loi 18-07) — corriger au relais.

Voir aussi [[user-profile]].

## ortho-explainer invente des dépendances entre tâches (2026-08-28)

Interrogé sur la Tâche 13, il a affirmé que « le modèle `Visit` est en cours dans la Tâche 3c ». **Il n'existe aucune Tâche 3c dans `tasks/todo.md`** (seulement 3a et 3b). La mention « (3c schema) » est une convention d'écriture présente dans les Tâches 10, 11, 12, 13 et 15 : elle désigne un groupe de modèles différés, que **chaque tâche crée dans son propre périmètre**.

**Why:** J'ai relayé cette affirmation à l'utilisateur telle quelle (le mode « explique-moi » impose de ne pas retoucher la réponse), et je lui ai fait perdre du temps en lui proposant de vérifier une dépendance inexistante.

**How to apply:** Le mode « explique-moi » interdit de réécrire la réponse de l'explainer, mais **pas** de vérifier ses affirmations factuelles avant de la relayer. Vérifier systématiquement toute **dépendance entre tâches** annoncée : `grep -nE '^## Task <N>' tasks/todo.md`, et l'existence du modèle dans `prisma/schema.prisma`. Si l'affirmation est fausse, relayer la réponse **et** ajouter la correction en note distincte.

## La question qui rentabilise ortho-security (2026-08-28)

`ortho-security` répond très bien à « on vient de fermer telle porte — **en reste-t-il une autre de la même famille ?** », en lui donnant le défaut déjà corrigé comme point de départ. Posée après la correction d'un MAJEUR sur `tests/authz-matrix.test.ts`, cette question a fait remonter 3 MAJEUR supplémentaires de la même classe, dont un très sévère (une ligne de matrice peut passer au vert en exécutant une **autre** route que celle qu'elle prétend couvrir — fausse assurance).

**Why:** Un audit ouvert (« audite ce diff ») produit surtout une revue de ce qui a changé. Un audit orienté par une **classe de défaut déjà démontrée** produit un balayage systématique des champs voisins. La différence de rendement est nette.

**How to apply:** après chaque correction d'un défaut structurel, reposer la question au même agent, en lui fournissant le tableau de démonstration du défaut initial. Lui demander explicitement de prendre la structure **champ par champ** et de compter combien de fois chacun est réellement lu — un champ lu une seule fois, ou zéro, est la tautologie suivante. Attention en contrepartie : ce mode découvre plus vite qu'on ne corrige. Fixer d'avance la limite de tours et acter le reste en dette écrite.
