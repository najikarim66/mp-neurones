# Repo : mp-neurones (MP Manager — marchés publics, cautions, veille AO)

- Chemin sur le PC du DG : `C:\dev\mp-neurones` — remote `origin`, branche `main`. Prod : https://mp.neurones.ma
  (Azure Static Web App, entrée protégée par Entra : `/` répond 302, `/api/health` 200).
- Front : `public/index.html`, page UNIQUE en **JavaScript ES5 strict** (voir « ES5 strict »). API : Azure Functions dans `api/`.
- Cosmos : base `btp-pointage`, conteneurs `mp_marches`, `mp_cautions` (lus en READ-ONLY par l'ERP, champ de liaison
  **`marcheId`** en camelCase), `mp_aos`, `mp_veille_ao` (écrit par le robot `neurones-veille-ao`, lu par l'écran Veille AO),
  `mp_config`, `mp_banques`, `mp_releves_banque`, `mp_paiements`, `mp_avenants`, `mp_avancements`, `mp_bordereau`, `mp_indices`,
  `mp_etudes_ao`, `mp_coffre_docs`, `mp_ocr_cache`, `mp_ocr_comparaisons`, `mp_mail_to`. Inventaire par `grep -rhoE "\bmp_[a-z_]+\b" api`.

## Gates (25 fichiers dans `test/`, node pur, sans réseau ni base — `node test/<fichier>`)
- Calculs métier (exécutent la logique pure, doctrine §3) : `echeances`, `cautions`, `avenant-date`, `rappr-lot`, `rapprochement-20-marches`,
  `releves-banque`, `piece-justif`, `pv-mainlevee`, `dce-statut`, `acte-invariant-patch`, `apparier-acte`, `ocr-acte`, `ocr-mesure`.
- Étude d'AO : `etude-sources`, `etude-ecarts`, `etude-coffre`, `etude-coffre-hors-api`, `etude-bordereau-xlsx`, `etude-pieces`, `etude-plafonds`.
- Front et livraison : `front-es5` (ES5 strict), `garde-version`, `garde-toggle`, `garde-rearm`, `module-copy`, `no-autolink-bundle.js`,
  `no-truncated-write.js`.
- CI : 20 workflows « Gate … » (un par fichier, sur `pull_request` et `main`, filtrés par chemins) + le workflow Azure Static Web Apps, qui
  enchaîne AVANT le build : `node public/charte/outils/verifier-copie.cjs`, `node public/charte/outils/scan-hex.cjs --cliquet
  test/charte-cliquet-hex.json`, `node test/front-es5.test.js`, `node test/garde-version.test.js`. Son job « Close Pull Request » est rouge
  sur l'événement pull_request : sans effet, connu.
- Tout calcul nouveau extrait sa logique pure dans un module chargé par le navigateur ET par node (`public/echeances.js`,
  `public/cautions-calc.js`) et gagne son fichier de gate + son workflow.

## Charte commune (décision DG 05/11/2026)
- `public/charte/` est une COPIE CONTRÔLÉE de https://github.com/najikarim66/neurones-charte (`MANIFESTE.json` → `source.commit`) :
  **jamais éditée à la main**. Toute valeur se change dans neurones-charte, puis `node outils/copier-vers.js mp` (depuis `C:\dev\neurones-charte`),
  puis les deux gates ci-dessus. Copie ≠ référence → CI rouge.
- Couleurs uniquement par `var(--charte-*)` / `var(--nav-*)` (jetons de `tokens.css`), statuts par `.charte-statut--*`. Le cliquet
  `test/charte-cliquet-hex.json` fixe le nombre d'hex hors variables : il ne remonte jamais. Règles : statuts réservés aux statuts, plancher
  12 px, aucune ellipse sur une donnée, contraste AA, « NEURONES · MP Manager · build · commit · date » en en-tête.

## ES5 strict (décision DG 10/11/2026)
`public/index.html` : pas de `let`/`const`, pas de fonctions fléchées, pas de gabarits de chaînes (ni classes, spread, destructuration).
Gate `test/front-es5.test.js`, jouée en CI avant chaque déploiement.

## Livraison
Branche (ou worktree) par session → gates locales → push → PR → runs verts PAR LEUR CONCLUSION
(`node C:/dev/btp-pointage/api/scripts/attendre-run.js --sha <sha>`) → fast-forward `git push origin <branche>:main` → run SWA de main vert →
smoke (302 sur `/`, 200 sur `/api/health`) → contrôle sur l'écran réel. Commit par pathspec (`git add` puis `git commit --only <chemins>`,
hook global). Fenêtre de livraison interdite : 23h15–23h45 heure du Maroc. **Retrait d'un worktree : toujours
`node C:/dev/btp-pointage/api/scripts/nettoyer-node-modules.js <worktree> --apply` puis `git worktree remove`, jamais à la main**
(arbitrage DG 12/11 ; jonctions node_modules, incident du 05/11).

## Interdits permanents
Secrets : aucune rotation, aucun affichage, aucune copie (doctrine §6). Pas de rôle Azure, aucun `az delete` (liste « deny » de
`.claude/settings.json`). Aucun nom de personne dans les commits. `btp-pointage` et l'hôte `rh-neurones-api-fc` appartiennent à la session RH.

## ⚙ RÈGLE D'AUTONOMIE (décision DG, 26/10/2026 — règle de méthode, gravée hors gel de doctrine ; copie identique dans neurones-veille-ao)

1. **Pas de demande de GO.** La session enchaîne seule : branche → gates → push → runs → fast-forward →
   smoke → relecture. Une op de données : dry-run, puis apply automatique si le dry-run correspond à
   l'attendu annoncé, avec archive + audit + relecture. Le compte rendu vient après, pas avant.
2. **Arrêt et attente du DG UNIQUEMENT pour :**
   - le régime argent (paie, cumul, net convenu, coût MO, STC, déplacements, soldes de congés,
     clôture) : mise en prod d'un changement de calcul ;
   - toute suppression de données de prod sans archive, ou irréversible ;
   - secrets, identités et sécurité d'infrastructure (rotation de secret, httpsOnly, sauvegarde
     Cosmos, rôles Entra, pare-feu) ;
   - tout envoi vers l'extérieur : clients, fournisseurs, maîtres d'ouvrage, toute personne autre que le DG
     (mail, message, notification, document). **Seuls sont permis sans question les mails automatiques
     d'exploitation adressés au DG** : échec d'un passage de la veille AO, aucun AO collecté pendant
     24 h ouvrées, échec d'un déploiement (arbitrage DG 12/11/2026). Aucun mail automatique vers l'extérieur ;
   - un dry-run qui ne donne pas l'attendu, un run rouge inexpliqué, un conflit de propriété entre
     sessions ;
   - une décision métier écrite nulle part (règle, norme, droit d'accès nouveau).
   Dans ces cas : UNE question courte, fermée, la recommandation en premier (« Je fais X ; si non,
   dis Y »). Jamais deux questions, jamais une question dont la réponse est dans la consigne.
3. **Sans réponse sous 30 minutes** à une question hors de la liste du point 2 : la session prend sa
   recommandation et continue, et le note dans le rapport.
4. **Permissions Claude Code** : `.claude/settings.json` (commité, sans secret) porte la liste « allow », la liste « deny » de cette règle
   et la clé `enabledPlugins` (extensions officielles au niveau du projet : skill-creator, claude-md-management, typescript-lsp ;
   security-guidance refusé le 12/11 : envoi des diffs hors du PC ; aucune autre extension ni skill d'un autre éditeur) ; ce qui n'est
   dans aucune liste continue de demander. Limites de la syntaxe (préfixes) : `git reset --hard` est en « ask » pour toute branche
   (la branche main ne se distingue pas), `rm -rf` est refusé partout (un worktree se retire par nettoyer-node-modules puis
   `git worktree remove`, voir « Livraison »), `gh api` ne peut pas exclure un `-X POST` placé après le chemin.

## ⛔ DOCTRINE — LECTURE OBLIGATOIRE EN DÉBUT DE SESSION (décision DG, 14/10/2026)

**Premier geste de toute session sur ce dépôt, avant toute lecture de code et avant toute écriture :** invoquer la compétence
`doctrines-neurones` (`.claude/skills/doctrines-neurones/SKILL.md`, version ADAPTÉE au domaine MP, §1 à §13).
- Copie CANONIQUE : `btp-pointage/.claude/skills/doctrines-neurones/SKILL.md`. Elle seule s'écrit ; une règle nouvelle s'écrit là-bas puis
  se réadapte ici, jamais l'inverse. La copie MP cite son origine et la date de son alignement (14/10/2026) ; elle est en retard sur la
  canonique pour §5 (branche et gates ciblées par session) et §50 (régimes ARGENT / ÉCRAN, gel de doctrine jusqu'au 21/11/2026) — à
  réaligner après le gel, les deux règles s'appliquent dès maintenant telles que résumées sous « Livraison ».
- Le hook `SessionStart` affiche le hash et les titres de sections ; le hook `PreToolUse` refuse la première écriture si les copies au
  byte divergent entre dépôts (sans effet mesurable sur la copie adaptée MP).
- Conflit entre une consigne de session et la doctrine : **SIGNALER avant d'agir**, jamais trancher seul.
- Pied de rapport obligatoire sur tout compte rendu de lot : forme exacte et motif en **doctrine §13** (deux lignes, dans la réponse,
  « aucun » écrit en toutes lettres).
