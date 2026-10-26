# Repo : mp-neurones (MP Manager — marchés publics, cautions)

- **Chemin sur le PC de Karim : `C:\dev\mp-neurones`** — remote `origin`, branche `main`.
- Cosmos : base `btp-pointage`, conteneurs `mp_marches`, `mp_cautions` (lus en READ-ONLY par l'ERP,
  champ de liaison **`marcheId`** en camelCase).
- Gates node sans dépendances : `test/echeances.test.js`, `test/cautions.test.js`.

## ⚙ RÈGLE D'AUTONOMIE (décision Karim, 26/10/2026 — règle de méthode, gravée hors gel de doctrine)

1. **Pas de demande de GO.** La session enchaîne seule : branche → gates → push → runs → fast-forward →
   smoke → relecture. Une op de données : dry-run, puis apply automatique si le dry-run correspond à
   l'attendu annoncé, avec archive + audit + relecture. Le compte rendu vient après, pas avant.
2. **Arrêt et attente de Karim UNIQUEMENT pour :**
   - le régime argent (paie, cumul, net convenu, coût MO, STC, déplacements, soldes de congés,
     clôture) : mise en prod d'un changement de calcul ;
   - toute suppression de données de prod sans archive, ou irréversible ;
   - secrets, identités et sécurité d'infrastructure (rotation de secret, httpsOnly, sauvegarde
     Cosmos, rôles Entra, pare-feu) ;
   - tout envoi vers l'extérieur (mail, message, notification à des personnes autres que Karim,
     document au maître d'ouvrage) ;
   - un dry-run qui ne donne pas l'attendu, un run rouge inexpliqué, un conflit de propriété entre
     sessions ;
   - une décision métier écrite nulle part (règle, norme, droit d'accès nouveau).
   Dans ces cas : UNE question courte, fermée, la recommandation en premier (« Je fais X ; si non,
   dis Y »). Jamais deux questions, jamais une question dont la réponse est dans la consigne.
3. **Sans réponse sous 30 minutes** à une question hors de la liste du point 2 : la session prend sa
   recommandation et continue, et le note dans le rapport.
4. **Permissions Claude Code** : `.claude/settings.json` (commité, sans secret) porte la liste
   « allow » et la liste « deny » de cette règle ; ce qui n'est dans aucune des deux continue de
   demander. Limites de la syntaxe (préfixes) : `git reset --hard` est en « ask » pour toute branche
   (la branche main ne se distingue pas), `rm -rf` est refusé partout (un worktree se retire par
   `git worktree remove`), `gh api` ne peut pas exclure un `-X POST` placé après le chemin.

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
