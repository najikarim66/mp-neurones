---
name: doctrines-neurones
description: >
  Doctrines NON NÉGOCIABLES pour mp-neurones (MP Manager — marchés publics).
  VERSION ADAPTÉE de la copie canonique btp-pointage (origine 07/09, alignée le
  14/10) : on garde les doctrines UNIVERSELLES et on écarte NOMMÉMENT les sagas RH
  (heures/pointage/personnel) qui n'existent pas en MP. À charger EN DÉBUT DE
  SESSION pour tout travail, pas seulement les lots sensibles. En cas de conflit
  consigne de session vs doctrine, SIGNALER avant d'agir.
---

# Doctrines NEURONES — MP (payées par des incidents réels)

> **CETTE COPIE EST ADAPTÉE, PAS CANONIQUE.** La copie qui s'écrit vit dans
> `btp-pointage/.claude/skills/doctrines-neurones/SKILL.md` (décision Karim,
> 14/10). Une règle nouvelle s'écrit LÀ-BAS, puis se réadapte ici — jamais
> l'inverse, et jamais en important la version RH telle quelle. Dernier alignement :
> **14/10/2026** (règles du 12 au 14/10 ajoutées : §7 à §13 ci-dessous).
>
> **LECTURE OBLIGATOIRE EN DÉBUT DE SESSION**, imposée par le `CLAUDE.md` du dépôt
> et affichée par le hook `SessionStart` (hash + titres de sections).
>
> **PIED DE RAPPORT OBLIGATOIRE** sur tout compte rendu de lot (§13) :
> `Doctrine : règles appliquées — … / Écarts assumés — … (motif), ou « aucun »`.

## 1. RIEN NE SE DEVINE — aucun identifiant technique sous les yeux d'un humain
Jamais un `id` Cosmos brut ni fabriqué à l'écran, dans un EXPORT (csv/xlsx), un
e-mail, un PDF, ou une PAGE/ARTIFACT de diagnostic que TU produis (la règle n'a pas
d'exception pour toi). Motifs MP : `^(veille_|prov_|ao_|c_|m_|mrc_)`, doc ids, timestamps.
Montrer le libellé humain : réf marché, réf AO, N° de caution bancaire, intitulé.
Repli TOUJOURS explicite (« non renseignée », « AO inconnu (clé) ») — jamais l'id nu,
jamais un `|| x.id` ré-introduit à la main (c'est ainsi qu'une surface fuit un mois plus tard).

## 2. JAMAIS D'ELLIPSE NI DE « — » NU SUR UNE DONNÉE
Ne pas tronquer (`.substring(0,N)`, `truncate`) un intitulé de marché, une désignation,
un nom : wrap / 2 lignes / tooltip. Un « - » nu se remplace par un repli nommé.
Un ÉTAT se dit en mots : « caution non encore libérée » n'est pas un tiret.

## 3. LES CALCULS SENSIBLES ONT UNE GATE QUI EXÉCUTE LE HANDLER
Une gate qui scanne le source prouve le style ; seule une gate qui EXÉCUTE la logique
sur une fixture piégée prouve le comportement. MP a deux gates node sans dépendances :
`test/echeances.test.js` (instant réel des échéances de dépôt) et `test/cautions.test.js`
(fusion cautions + « à restituer »). Tout calcul métier nouveau (dates, montants engagés,
agrégats filtrés) extrait sa logique PURE dans un module chargé à la fois par le navigateur
et par node (voir `public/echeances.js`, `public/cautions-calc.js`) et gagne sa gate.

## 4. INVENTAIRE EXHAUSTIF AVANT DE TOUCHER UNE DONNÉE PARTAGÉE
Avant de changer le sens, le calcul ou la forme d'une donnée lue par plusieurs écrans :
la LISTE complète des consommateurs (grep exhaustif, fichier:ligne), pas des exemples.
Idem pour un secret partagé avant rotation → voir [[porteurs-cle-storage]].

## 5. FRAÎCHEUR AVANT CONCLUSION SUR DU CODE DÉPLOYÉ
Un clone en retard a déjà produit des diagnostics faux. Avant d'affirmer ce que fait la
prod : `git fetch` + comparer, ou `git show origin/main:<fichier>`. Aucun pull silencieux.

## 6. SECRETS : jamais imprimés, rotation = resynchroniser TOUS les porteurs
Une connection string / clé ne paraît dans aucune sortie ni fichier (capturer en variable
d'env, comparer en script qui n'imprime que des verdicts). Une rotation oubliée sur UN
porteur = panne silencieuse → [[porteurs-cle-storage]], [[acces-cosmos-lecture-seule]].
Un secret ne transite JAMAIS par une conversation, un fichier de recette ou un rapport :
il se lit à sa source et se passe par variable d'environnement — jamais en ligne de
commande (visible dans la liste des process et l'historique du shell). On ne le demande
à personne. Un fichier de recette porte `${VARIABLE}`, jamais la valeur.

## 7. AUCUNE EXCLUSION NI TRONCATURE MUETTE — TOUT EXCLU PORTE SON MOTIF (12-13/10)
Payée sur un écran RH qui annonçait « 8 comptés » alors que quatre lignes avaient été
écartées sans le dire : l'écart ne se CONSTATAIT pas, donc la décision ne se prenait pas.
En MP la forme est la même partout où l'on filtre — liste des marchés « en cours », AO
retenus, cautions à restituer, provisions : **N vus · M comptés · K exclus**, puis le
MOTIF NOMMÉ de chaque exclu. « 0 exclu » s'écrit aussi, sinon son absence se lit comme
un silence. Un `slice(0, N)` se dit : « 40 premiers sur 97 ».

## 8. QUAND DEUX PIÈCES COUVRENT LE MÊME FAIT, ON POSE L'ATTRIBUTION — PAS UN REFUS (14/10)
Transposition du cas HADRATI (une villa et un hôtel couvrant la même nuit : les deux
factures étaient vraies). En MP : deux cautions sur le même marché, deux avenants sur la
même tranche, deux provisions sur le même lot. Ne refusez pas la seconde pièce — posez la
règle d'ATTRIBUTION (laquelle couvre quoi), et NOMMEZ le cas où elle ne tranche pas :
il remonte en anomalie, il ne se devine pas et ne se répartit pas.
COROLLAIRE DE FORME : une borne de fin FACULTATIVE (`null` = « tant que le marché court »)
est un ÉTAT, pas une donnée manquante. La requête doit le dire explicitement
(`NOT IS_DEFINED(c.fin) OR IS_NULL(c.fin)`) — une clause `c.fin >= @du` écarte ces
documents et ils cessent de compter EN SILENCE. Et ce qui n'a pas de fin ne se TOTALISE
pas : afficher un total affirmerait une échéance que personne n'a posée.

## 9. LA GARDE D'ÉCRAN AU-DESSUS DE LA ROUTE, ET LES HOOKS EN TÊTE (12/10)
Incident ERP, mais la cause est universelle au front : un `useState` déclaré APRÈS un
retour anticipé fait jeter React au second rendu (« Rendered more hooks… ») et DÉMONTE
l'arbre — page blanche, sans message. Donc : TOUS les hooks avant TOUT retour, et
`eslint-plugin-react-hooks` avec `rules-of-hooks` en **erreur** sur tout le front.
Et la garde d'erreur enveloppe l'ÉLÉMENT DE ROUTE, pas des sections : une garde placée
SOUS la faute ne garde rien. Message nommé (écran + cause), menu hors de la garde pour
rester navigable. MP est en pages servies, pas en router React : la garde y prend la
forme d'un `try/catch` de rendu par PAGE, au-dessus du contenu, avec message nommé.

## 10. TOUT DÉFAUT D'ÉCRAN GAGNE UNE GATE SUR L'ÉCRAN RENDU (12-14/10)
Payé trois fois en trois jours. Un défaut d'écran ne se voit pas dans le source : il se
reproduit sur l'écran MONTÉ, en jouant les GESTES (clic, frappe, focus). La gate vise
PAR MARQUEUR (`[data-…]`), jamais par position : une gate visant « le deuxième champ
date » a frappé le filtre de la page et prouvait le CONTRAIRE de ce qu'elle croyait, en
vert. Et une assertion qui cherche un MOT dans le source le trouve dans un commentaire :
viser les imports et les appels, ou extraire la fonction pure et l'EXÉCUTER.

## 11. UN SEUL PROPRIÉTAIRE PAR FICHIER DE GATE — L'AUTRE MESURE ET SIGNALE (13-14/10)
Deux sessions en parallèle, deux faux rouges le même jour : la boucle des gates tournait
pendant qu'un fichier était édité. Un faux rouge coûte autant qu'un faux vert. Un fichier
de gate a UN propriétaire par lot ; l'autre session mesure et SIGNALE, elle ne modifie pas.
Et l'on ne lance pas une boucle de gates pendant qu'on édite.

## 12. UN TEST N'ÉCRIT JAMAIS EN PRODUCTION — RECETTE SUR PIÈCE DÉDIÉE (14/10)
Aucune gate ne touche la vraie base ni le vrai blob, même avec des documents « jetables »
nettoyés derrière. Pour une recette end-to-end, une PIÈCE DE RECETTE dédiée, nommée comme
telle, portant un DRAPEAU UNIQUE lu PARTOUT (listes, exports, agrégats, relances) — un
drapeau par surface serait oublié sur la suivante. Une gate prouve que, avec la pièce de
recette, le résultat servi est byte-identique à sans elle.

## 13. CHAQUE COMPTE RENDU DE LOT PORTE SON PIED DE DOCTRINE (14/10)
Un lot peut être juste et avoir écarté une règle, parfois à raison. L'inacceptable est que
l'écart ne se VOIE pas : il devient un précédent silencieux. Tout compte rendu finit donc
par deux lignes, dans la réponse, jamais dans un fichier :

    Doctrine : règles appliquées — <numéros>
    Écarts assumés — <règle : motif>, ou « aucun »

## Ce qui a été ÉCARTÉ (RH-spécifique, sans objet en MP)
Saga « heures nettes au serveur » et « sentinelle endpoint heures » : MP n'affiche pas
d'heures de travail. Rapprochement de noms de personnel (AZANI/EL AASSRI) : hors domaine
marchés publics. Attribution d'une NUIT à une couverture logement (§38 canonique) :
transposée en §8 ci-dessus sous sa forme générale, sans le domaine logement. Verrouillage
des mois de paie et clôture comptable RH : sans objet — mais son principe (« une
modification sur une période validée est PROPOSÉE, jamais appliquée ») vaut pour tout
marché déjà engagé ou toute caution déjà libérée.
Si un besoin analogue apparaît en MP, réadapter la doctrine canonique, ne pas importer la
version RH telle quelle.
