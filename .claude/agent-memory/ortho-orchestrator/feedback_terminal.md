---
name: terminal-powershell
description: L'utilisateur travaille dans PowerShell — toute commande fournie doit être PowerShell-safe, jamais du bash
metadata:
  type: feedback
---

**L'utilisateur exécute les commandes dans PowerShell** (prompt `PS C:\Users\DELL MAY-Tech\...>`), pas dans Git Bash — alors que *mes* propres outils tournent en Git Bash. Les deux ne se comportent pas pareil.

**Why:** Le 2026-08-27 je lui ai donné un bloc de 6 commits avec des messages `git commit -m "..."` sur plusieurs lignes. PowerShell a interprété le saut de ligne comme une chaîne non terminée, a avalé les commandes suivantes, et a renvoyé « The term 'seed' is not recognized as a name of a cmdlet ». **Les 6 commits ont échoué**, les `git add` étaient passés — état bâtard, et lui a cru que ça avait marché.

**How to apply:** Pour toute commande destinée à l'utilisateur :
- **Un message de commit = une seule ligne.** Pour un corps de message, enchaîner plusieurs `-m` sur la *même* ligne : `git commit -m "sujet" -m "corps" -m "Co-Authored-By: ..."`.
- Jamais de saut de ligne à l'intérieur de guillemets, jamais de here-string bash (`<<'EOF'`), jamais de `\` en fin de ligne pour continuer.
- Chemins contenant des crochets (`src/app/[locale]/...`) : les mettre entre **guillemets simples** en PowerShell.
- `rm -rf X` ne marche pas ; utiliser `Remove-Item -Recurse -Force X`.
- Après lui avoir donné un bloc de commandes git, **vérifier `git log --oneline` au tour suivant** plutôt que de supposer que ça a marché. Il pose la question « est-ce que ça a marché ? » précisément parce qu'il ne peut pas juger de la sortie.

Voir aussi [[user-profile]].
