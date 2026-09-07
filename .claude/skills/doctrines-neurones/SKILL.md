---
name: doctrines-neurones
description: >
  Doctrines NON NÉGOCIABLES pour mp-neurones (MP Manager — marchés publics).
  Adapté depuis btp-pointage (07/09) : on garde les doctrines UNIVERSELLES déjà
  vécues ici et on écarte les sagas RH (heures/pointage/personnel) qui n'existent
  pas en MP. En cas de conflit consigne de session vs doctrine, SIGNALER avant d'agir.
---

# Doctrines NEURONES — MP (payées par des incidents réels)

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

## Ce qui a été ÉCARTÉ (RH-spécifique, sans objet en MP)
Saga « heures nettes au serveur » et « sentinelle endpoint heures » : MP n'affiche pas
d'heures de travail. Rapprochement de noms de personnel (AZANI/EL AASSRI) : hors domaine
marchés publics. Si un besoin analogue apparaît en MP, réadapter la doctrine, ne pas
importer la version RH telle quelle.
