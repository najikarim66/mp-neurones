# Règles de sécurité NEURONES (décision du directeur, 05/11/2026)

Ces règles s'AJOUTENT aux contrôles intégrés ; elles n'en retirent aucun.

## 1. Montants de salaire : DG et comptable seulement
- Sont des montants de salaire : net convenu, taux journalier, taux horaire, salaire de base, salaire net ou mensuel, montants du
  cumul (montant des heures sup, retenue d'heures, primes et indemnités, total à payer, net à payer), bulletins, STC.
- Lisibles et modifiables par le rôle DG et le rôle comptable SEULEMENT.
- Le filtrage se fait CÔTÉ API : le handler retire le champ de la réponse pour tout autre rôle (RH, chef de projet, chef de
  chantier, ouvrier). Un masquage à l'écran (champ servi puis caché par l'interface) est une FUITE : le champ part dans la réponse
  réseau. Signaler tout champ de salaire servi à un rôle autre que DG ou comptable, même s'il n'est pas affiché.
- L'écriture d'un montant de salaire par un autre rôle est refusée par l'API (403 nommé), jamais seulement désactivée à l'écran.

## 2. Rôle ET périmètre avant toute lecture ou écriture
- Toute route API vérifie le rôle de l'appelant ET son périmètre (chantier, équipe, missions dont il est responsable) AVANT la
  première lecture ou écriture en base, y compris pour une simple lecture.
- Un salarié (ouvrier) ne lit que ses propres données : son identifiant vient de son jeton, jamais d'un paramètre de la requête.
  Tout identifiant de salarié, de chantier ou de mission reçu du client se recontrôle contre le périmètre (IDOR).
- Un chef d'équipe pointe ses hommes mais ne valide jamais ; le valideur est le responsable de la mission.
- Un libellé d'écran ou un commentaire ne prouve rien : l'autorité se lit dans la donnée résolue à l'exécution.

## 3. Aucun secret hors des variables d'environnement
- Jamais de secret, de chaîne de connexion Cosmos (AccountEndpoint= / AccountKey=), de clé de stockage, de cookie, de jeton ou
  d'en-tête d'authentification (Authorization, Set-Cookie, x-ms-client-principal) dans le code, les logs, les commits, les
  sorties de test, les artefacts CI ou les messages d'erreur.
- Les secrets restent dans les variables d'environnement (app settings, secrets GitHub), lus au moment de l'appel. Aucune rotation
  de secret dans un lot de code.
- Seule exception admise : la chaîne factice des gates (compte « test-local », clé factice), jamais une vraie.
- Une erreur Playwright ou HTTP peut contenir des cookies ou des en-têtes : l'envelopper, ne jamais imprimer l'objet d'erreur brut
  ni les en-têtes d'une requête.

## 4. Aucun PIN ni matricule hors du dossier de recette
- Jamais de PIN ni de matricule dans les logs, les commits (code, fixtures, messages), les sorties de test ou les rapports.
- Les fixtures de gate utilisent des matricules et des noms fictifs. Le nominatif réel reste UNIQUEMENT dans C:\dev\.recette\.
- Un PIN ne se journalise jamais, même haché, et ne se renvoie jamais au client.

## 5. Écritures en base de production : par op seulement
- Une écriture en production passe par un script op versionné : dry-run par défaut, --apply explicite, archive avant toute
  suppression ou remplacement, audit, relecture après écriture. Jamais d'écriture à la main (portail, requête ad hoc, script
  jetable).
- Un script de diagnostic sur la production est en lecture seule stricte et le dit dans son en-tête.
- Une gate ou un test n'écrit jamais en production : base simulée en mémoire.

## 6. Aucune modification d'identité Azure
- Aucun rôle Azure, aucune attribution RBAC, aucune identité managée, aucun rôle Entra, aucun pare-feu ni réglage httpsOnly
  modifié par le code, un workflow ou un script.

## 7. Messages d'erreur
- Côté client : un message générique, une référence de corrélation, et l'action à faire. Jamais de pile d'appels, de requête
  Cosmos, de nom de conteneur, de chemin serveur ni de valeur de secret dans la réponse.
- Côté serveur : le détail complet dans le journal, sans secret, sans PIN ni matricule.

## 8. Normes payantes : jamais lues par une IA (directeur, 05/11/2026)
- Une norme achetée (AFNOR : NF C 15-100, NF C 15-100-1, FD C 15-500, toute norme ou guide sous licence) n'est jamais lue, ouverte,
  analysée, résumée ni citée par une IA, même présente sur le disque, même en partie. Signaler tout code, script ou test qui lit un
  PDF de norme, en extrait du texte ou en recopie un passage.
- Aucun PDF de norme dans le dépôt ni dans le dossier de recette. Le directeur lit la norme et saisit la valeur ; le champ de référence
  ne porte que le numéro de paragraphe, de tableau ou d'annexe, jamais de texte recopié.
