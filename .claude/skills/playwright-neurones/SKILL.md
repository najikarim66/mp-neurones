---
name: playwright-neurones
description: Piloter Chromium sur MP Manager (SWA lemon-plant-…azurestaticapps.net) — règles maison de captation (lecture seule en prod, storageState jamais committé, anonymisation au cas par cas). Adapté de btp-pointage (07/09). NON encore câblé : MP n'a pas @playwright/test aujourd'hui.
---

# Playwright chez NEURONES — MP Manager

Reprend les règles maison de btp-pointage, transposées à MP. **État actuel** : MP est une
app d'un seul fichier statique (`public/index.html`) servie par une **Azure Static Web App**
(hôte `lemon-plant-062afbc10.7.azurestaticapps.net`), protégée par l'auth EasyAuth/M365 (302
vers login sur toute route). Il n'y a PAS encore de `@playwright/test` ni de scénario dans ce
dépôt — à installer en devDependency le jour où une captation MP est décidée (aucun impact
build/CI : les navigateurs ne se téléchargent pas en CI).

## Les trois règles (non négociables — décision Karim, valables tous dépôts)

1. **`storageState.json` n'entre JAMAIS dans git** (cookie de session authentifiée). L'ajouter
   au `.gitignore` avant tout scénario ; `git ls-files | grep -i storagestate` doit rester vide.
   S'il fuit : retrait immédiat + se déconnecter pour invalider la session.
2. **Sur la PRODUCTION : LECTURE SEULE.** Naviguer, ouvrir, filmer — jamais enregistrer, valider
   ni supprimer. Ceinture de sécurité réseau à poser sur tout contexte prod :
   ```js
   await ctx.route("**/api/**", r => (["GET","HEAD"].includes(r.request().method()) ? r.continue() : r.abort()));
   ```
   Toute écriture se fait en local (serveur de dev + fixtures) ou sur un jeu de démo.
3. **Anonymisation décidée AU CAS PAR CAS par Karim** — poser la question à chaque captation
   (vrais noms d'AO/acheteurs, ou anonymisé ?), ne jamais trancher d'avance.

Refusé (RH, à ne pas re-proposer) : compte de service sans MFA.

## Auth (voie A — état de session, jamais d'identifiants dans un script)
Créer la session UNE fois en fenêtre visible (`chromium.launch({headless:false})` → aller sur
l'URL SWA → laisser Karim se connecter M365/MFA → `ctx.storageState({path:"storageState.json"})`).
Réutiliser via `newContext({storageState:"storageState.json"})`. Cookie expiré → l'URL repart
vers `login.microsoftonline.com` : s'arrêter et demander une nouvelle session.

## Vidéos de parcours (si un tutoriel MP est décidé)
Mêmes recettes que RH : `recordVideo` (.webm VP8) → transcodage H.264+audio via ffmpeg ; faux
curseur injecté (`addInitScript`) car le curseur natif n'est pas filmé ; rendus FINALS hors
dépôt (`C:\dev\videos-tuto\`), rushes gitignorés.
