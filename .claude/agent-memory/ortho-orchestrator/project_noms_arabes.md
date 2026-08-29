---
name: normalisation-noms-arabes
description: Toute normalisation de texte dans ce projet doit couvrir les diacritiques ARABES, pas seulement latins — la clinique est à Alger
metadata:
  type: project
---

Les implémentations de normalisation de noms retombent spontanément sur `U+0300`–`U+036F` (*Combining Diacritical Marks*, **latin uniquement**). C'est le réflexe par défaut, et il est insuffisant ici.

Divergences mesurées le 2026-08-29 sur la première version du moteur de doublons :

| Comparaison | Latin seul |
|---|---|
| `Benali` / `Bénali` | converge |
| `محمد` / `مُحَمَّد` (harakat) | **diverge** |
| `محمد` / `محـمد` (tatweel) | **diverge** |

Plages à couvrir en plus : `U+064B`–`U+0652` (harakat), `U+0640` (tatweel), `U+0610`–`U+061A`, `U+06D6`–`U+06ED`.

**Why:** La clinique est à **Alger** et le site est trilingue FR/AR/EN. Les noms en caractères arabes sont le cas **courant**, pas un cas limite. Une normalisation latine seule livre une fonctionnalité qui ignore une grande partie des patients, tout en affichant qu'elle les couvre — le commentaire du module promettait « suppression des diacritiques » sans le faire.

**How to apply:**
- Dès qu'une étape compare, cherche ou dédoublonne du **texte saisi par un humain**, exiger explicitement dans le briefing la couverture des diacritiques arabes **et** latins, avec un test par cas.
- Ne pas accepter « accents » comme spécification : demander les plages Unicode.
- Écrire les classes en **échappements** `\uXXXX`, jamais en marques combinantes littérales (un copier-coller ou un filtre `.gitattributes` peut les réordonner et vider la classe en silence).
- Le rapprochement **flou** (`Mohamed`/`Mohammed`) reste un autre sujet — ne pas le confondre avec la normalisation.

Voir aussi [[dette-authz-matrix-avant-tache-13]].
