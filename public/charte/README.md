# Charte NEURONES — une apparence pour trois applis

Référence : le web RH tel qu'il est en production (`btp-pointage`, refonte « signalétique chantier »), valeurs
relues dans le dépôt le 05/11/2026 (commit `a4092e59`). Applis : ERP (erp.neurones.ma), RH (rh.neurones.ma),
MP (mp.neurones.ma). Le mobile RH porte déjà les mêmes hex de statut.

## Contenu
- `tokens.json` — LA source : fond `#FAFAF7`, encre, marque `#1F4E78`, bandeau et menu aux couleurs du logo
  (`nav`, clair et sombre), jaune et noir de la signalétique chantier, statuts (succès, alerte, refus, équipe,
  déplacement, désactivé), neutres, typo (Calibri et sa pile de secours), tailles avec plancher 12 px, espacements,
  rayons, gabarits. Pour Tailwind (`theme.extend`) et pour le mobile.
- `tokens.css` — les mêmes valeurs en variables CSS, GÉNÉRÉ par `node outils/generer-tokens-css.js --ecrire`
  (ne s'édite jamais à la main). `--nav-*` pour le bandeau et le menu, `--charte-*` pour le reste.
- `logo-neurones.png` — le logo officiel, fichier d'origine (PNG 390×360, RGBA 8 bits, sRGB implicite : aucun
  profil embarqué). Ni recoloré, ni découpé, ni redimensionné.
- `entete/` — en-tête commun en HTML et CSS purs (aucune dépendance) : logo, « NEURONES · nom de l'appli ·
  build · commit · date », garde de version (bandeau jaune ou rouge), menu aux couleurs du logo, pastilles de
  statut. `entete.js` (ES5, facultatif) remplit l'identité depuis `version.json` et montre ou cache une garde.
- `outils/` — `verifier-charte.js` (gate du dépôt), `manifeste.js` et `copier-vers.js` (distribution vers une
  appli), `verifier-copie.cjs` (gate de dérive dans l'appli), `scan-hex.cjs` (hex hors variables, avec cliquet),
  `capture-3-applis.mjs` (preuve : captures côte à côte et audit DOM).

## Les règles
1. **Les couleurs de statut servent aux statuts, jamais à la décoration.** Vert/rouge = succès/refus d'un état.
   Catégories, types, badges informatifs = neutres ou marque. Un état se distingue par le contraste ET un symbole
   (✓, !, ✕, •), jamais par la couleur seule.
2. **Plancher 12 px.** Aucun texte sous 12 px, nulle part — ni légende, ni pied, ni badge.
3. **Aucune ellipse sur une donnée.** Un nom, un libellé, un montant s'affichent entiers (retour à la ligne,
   jamais `text-overflow: ellipsis` ni `truncate`).
4. **Contraste AA** (≥ 4,5:1) sur tout texte, dans les deux thèmes. Les paires de la charte sont vérifiées par
   la gate ; une paire nouvelle se vérifie avant d'être posée.
5. **Rien ne se devine.** Aucun identifiant technique sous les yeux d'un humain ; repli toujours explicite
   (« Site inconnu (clé) »), jamais un tiret nu ni un id.
6. **Deux bleus, deux rôles nommés (décision DG du 10/11/2026) — ils restent distincts.**
   - `nav-fond` = `#004186` (jeton `couleur.nav.clair.fond`, variable `--nav-fond`) : **bandeau et menu** uniquement — le fond
     de la barre du haut et du menu latéral, aux couleurs du logo. En thème sombre : `couleur.nav.sombre.fond`.
   - `marque` = `#1F4E78` (jeton `couleur.marque`, variable `--charte-marque`) : **boutons, liens et accents** dans les écrans —
     bouton principal, lien, onglet actif, filet d'accent, focus.
   - Jamais l'un à la place de l'autre : un bouton ne prend pas `nav-fond`, le bandeau ne prend pas `marque`. MP, l'ERP et le
     RH appliquent cette répartition de la même façon.

Et : aucune couleur en hex hors des variables dans l'en-tête, le menu et les écrans migrés (gate `scan-hex.cjs`,
cliquet : un hex de plus se décide, il ne glisse pas) ; la copie de la charte dans une appli ne diverge jamais
de sa version de référence (`verifier-copie.cjs`).

## Intégrer dans une appli
```
node outils/copier-vers.js C:/dev/<appli>        # écrit <appli>/charte/ avec son MANIFESTE.json
node charte/outils/verifier-copie.cjs              # dans l'appli : la copie = la référence déclarée
node charte/outils/scan-hex.cjs --cliquet charte/cliquet-hex.json   # hex hors variables, plafonds par fichier
```
Tailwind : `theme.extend.colors` lit `charte/tokens.json` (voir le web RH). Vanilla : `<link rel="stylesheet"
href="charte/tokens.css">` puis `charte/entete/entete.css`.

## Changer la charte
Toute valeur s'écrit dans `tokens.json`, ici et seulement ici ; on régénère `tokens.css`, on joue la gate, on
commite, puis on recopie dans chaque appli (`copier-vers.js`) et chaque appli recommite sa copie. Une copie de
travail n'est pas une version.
