# Repo : mp-neurones (MP Manager — marchés publics, cautions)

- **Chemin sur le PC de Karim : `C:\dev\mp-neurones`** — remote `origin`, branche `main`.
- Cosmos : base `btp-pointage`, conteneurs `mp_marches`, `mp_cautions` (lus en READ-ONLY par l'ERP,
  champ de liaison **`marcheId`** en camelCase).
- Gates node sans dépendances : `test/echeances.test.js`, `test/cautions.test.js`.

## ⛔ DOCTRINE — LECTURE OBLIGATOIRE EN DÉBUT DE SESSION (décision Karim, 14/10/2026)

**Premier geste de toute session sur ce dépôt, avant toute lecture de code et avant
toute écriture :** invoquer la compétence `doctrines-neurones`.

Ce n'est ni une suggestion ni une formalité réservée aux lots sensibles. Mesuré le
14/10 sur les transcripts : sur les trois derniers lots de chaque dépôt, la doctrine
n'avait **jamais** été ouverte dans `erp-neurones` — deux sessions, dont une de
9 950 lignes le jour même — et les copies avaient dérivé de sept sections entre les
dépôts. Une doctrine qu'on invoque quand on y pense n'est pas une doctrine, c'est un
souvenir ; et deux copies différentes font deux doctrines.

- **Copie CANONIQUE : `btp-pointage/.claude/skills/doctrines-neurones/SKILL.md`.**
  Elle seule s'écrit. `erp-neurones` et `rh-pointage-mobile` en portent une copie
  identique au BYTE ; `mp-neurones` garde une version adaptée à son domaine, qui cite
  son origine et la date de son alignement. Une règle nouvelle s'écrit dans la
  canonique, puis se propage — jamais l'inverse.
- Le hook `SessionStart` affiche le **hash** et les **titres de sections** au
  démarrage ; le hook `PreToolUse` **REFUSE la première écriture** si les copies
  divergent entre dépôts. Geste de remise en conformité donné dans le message de refus.
- En cas de conflit entre une consigne de session et une doctrine : **SIGNALER avant
  d'agir**, jamais trancher seul.

**PIED DE RAPPORT OBLIGATOIRE** — tout compte rendu de lot finit par deux lignes, dans
la réponse (jamais dans un fichier) :

    Doctrine : règles appliquées — <numéros, séparés par des points médians>
    Écarts assumés — <règle : motif>, ou « aucun »

« Aucun » s'écrit aussi : son absence ne doit pas pouvoir se lire comme un oubli.
