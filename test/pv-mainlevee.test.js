/* =========================================================================
 * GATE - PV de reception definitive -> mainlevee des cautions du marche.
 *
 * Verifie la logique PURE du lot "PV definitif" (public/pv-mainlevee.js),
 * rejouee sur une fixture piegee. Deux dangers a bloquer, mesures avant d'ecrire :
 *   1. NE PAS basculer sur la date_reception_definitive CALCULEE (44 cautions /
 *      ~3,1 M MAD > 3 ans le feraient d'un coup). Seul reception_definitive_prononcee
 *      === true (PV depose) rend un marche recevable.
 *   2. NE basculer QUE bonne_execution + retenue_garantie (arbitrage A2).
 *      Jamais soumission / avance_demarrage / provisoire, jamais une caution
 *      deja mainlevee_demandee / liberee / restituee / expiree.
 * La bascule est PURE (ne mute pas la caution d'entree) et date la demande.
 *
 * Lancer : node test/pv-mainlevee.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var MPM = require('../public/pv-mainlevee.js');

var fails = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}

/* "Aujourd'hui" injecte -> deterministe, independant de l'horloge CI. */
var NOW = new Date('2026-09-23T12:00:00Z').getTime();
var DAY = 86400000;

/* Marche AVEC PV definitif prononce (recevable). Cote app les cautions portent
 * marche_id ; on en met une en marcheId (cote Cosmos brut) pour prouver la
 * tolerance des deux noms de champ. */
var mProno = {
  id: 'm1', ref: 'MRC-1',
  reception_definitive_prononcee: true,
  date_reception_definitive_reelle: '2026-09-20',
  date_reception_definitive: '2026-09-08' // calculee, passee : ne doit RIEN declencher a elle seule
};
/* Marche SANS PV, mais dont la reception definitive CALCULEE est deja passee :
 * le piege. Doit rester NON recevable -> aucune bascule. */
var mCalc = {
  id: 'm2', ref: 'MRC-2',
  reception_definitive_prononcee: false,
  date_reception_definitive: '2020-01-01' // passee depuis des annees
};

var CAUTIONS = [
  { id:'a1', num:'D1', type:'bonne_execution', banque:'FINEA', montant:100000, statut:'active',             marche_id:'m1' }, // -> bascule
  { id:'a2', num:'R1', type:'retenue_garantie', banque:'BMCE',  montant:60000,  statut:'active',             marcheId:'m1'  }, // -> bascule (champ Cosmos)
  { id:'a3', num:'S1', type:'soumission',       banque:'BMCE',  montant:20000,  statut:'active',             marche_id:'m1' }, // reste (type hors A2)
  { id:'a4', num:'V1', type:'avance_demarrage', banque:'CIH',   montant:30000,  statut:'active',             marche_id:'m1' }, // reste (type hors A2)
  { id:'a5', num:'D2', type:'bonne_execution',  banque:'FINEA', montant:15000,  statut:'mainlevee_demandee', marche_id:'m1' }, // deja demandee : pas de re-bascule
  { id:'a6', num:'R2', type:'retenue_garantie', banque:'FINEA', montant:12000,  statut:'liberee',            marche_id:'m1' }, // deja revenue
  { id:'a7', num:'D3', type:'bonne_execution',  banque:'ATW',   montant:99999,  statut:'active',             marche_id:'m2' }  // marche non recevable (calc only)
];

console.log('\n=== 1. Recevabilite : PV prononce, pas la date calculee ===');
check('marche avec reception_definitive_prononcee=true -> recevable', MPM.estRecevable(mProno) === true, '');
check('marche a date calculee passee MAIS sans PV -> NON recevable (le piege)', MPM.estRecevable(mCalc) === false, '');
check('marche null/undefined -> NON recevable', MPM.estRecevable(null) === false, '');

console.log('\n=== 2. Selection des cautions a basculer (A2 : def + RG, actives, du marche) ===');
var sel = MPM.cautionsABasculer(mProno, CAUTIONS);
var selNums = sel.map(function (c) { return c.num; }).sort().join(',');
check('bascule EXACTEMENT la definitive et la RG actives (D1, R1)', selNums === 'D1,R1', 'sel=' + selNums);
check('exclut soumission et avance_demarrage', selNums.indexOf('S1') < 0 && selNums.indexOf('V1') < 0, 'sel=' + selNums);
check('exclut une caution deja mainlevee_demandee (pas de re-bascule)', selNums.indexOf('D2') < 0, 'sel=' + selNums);
check('exclut une caution liberee', selNums.indexOf('R2') < 0, 'sel=' + selNums);
check('exclut une caution d\'un AUTRE marche', selNums.indexOf('D3') < 0, 'sel=' + selNums);
check('marche NON recevable -> selection vide meme si caution active', MPM.cautionsABasculer(mCalc, CAUTIONS).length === 0, '');

console.log('\n=== 3. Application de la bascule : PURE + date de demande ===');
var avant = JSON.parse(JSON.stringify(CAUTIONS[0])); // a1 = D1
var maj = MPM.appliquerBascule(CAUTIONS[0], '2026-09-23');
check('retourne un nouvel objet en mainlevee_demandee', maj.statut === 'mainlevee_demandee', 'statut=' + maj.statut);
check('date_demande_mainlevee posee', maj.date_demande_mainlevee === '2026-09-23', 'd=' + maj.date_demande_mainlevee);
check('NE MUTE PAS la caution d\'entree (toujours active)', CAUTIONS[0].statut === 'active' && JSON.stringify(CAUTIONS[0]) === JSON.stringify(avant), JSON.stringify(CAUTIONS[0]));

console.log('\n=== 4. Batch marche : ce qu\'on persiste ===');
var batch = MPM.basculerMarche(mProno, CAUTIONS, '2026-09-23');
check('count = 2', batch.count === 2, 'count=' + batch.count);
check('total = 160 000 (100k + 60k)', batch.total === 160000, 'total=' + batch.total);
check('aMettreAJour ne contient que des mainlevee_demandee datees', batch.aMettreAJour.every(function (c) { return c.statut === 'mainlevee_demandee' && c.date_demande_mainlevee === '2026-09-23'; }), JSON.stringify(batch.aMettreAJour));
check('batch sur marche non recevable -> vide, total 0', (function () { var b = MPM.basculerMarche(mCalc, CAUTIONS, '2026-09-23'); return b.count === 0 && b.total === 0 && b.aMettreAJour.length === 0; })(), '');

console.log('\n=== 5. File du mail hebdo : mainlevees en attente + anciennete ===');
var attente = MPM.mainleveesEnAttente(CAUTIONS);
check('ne retient que les mainlevee_demandee (ici D2)', attente.length === 1 && attente[0].num === 'D2', JSON.stringify(attente.map(function(c){return c.num;})));
var c9 = { statut: 'mainlevee_demandee', date_demande_mainlevee: '2026-09-14' };
check('joursDepuisDemande = 9 (now injecte)', MPM.joursDepuisDemande(c9, NOW) === 9, 'j=' + MPM.joursDepuisDemande(c9, NOW));
check('joursDepuisDemande = 0 si pas de date', MPM.joursDepuisDemande({ statut: 'mainlevee_demandee' }, NOW) === 0, '');

console.log('\n=== 6. Cycle 3 etats : depot des pieces (mainlevee client -> accuse banque) ===');
var cDem = { id: 'p1', num: 'P', type: 'bonne_execution', montant: 100000, statut: 'mainlevee_demandee', marche_id: 'm1' };
check('mainlevee_client recevable sur une caution mainlevee_demandee', MPM.pieceRecevable(cDem, 'mainlevee_client') === true, '');
check('accuse_banque NON recevable tant que pas mainlevee_recue (ordre impose)', MPM.pieceRecevable(cDem, 'accuse_banque') === false, '');
var ref1 = { blob: 'b1', nom_original: 'ml.pdf' };
var cRecu = MPM.appliquerPiece(cDem, 'mainlevee_client', ref1, '2026-09-24');
check('depot mainlevee client -> mainlevee_recue + date + piece', cRecu.statut === 'mainlevee_recue' && cRecu.date_mainlevee_recue === '2026-09-24' && cRecu.mainlevee_client === ref1, JSON.stringify(cRecu));
check('appliquerPiece NE MUTE PAS l\'entree', cDem.statut === 'mainlevee_demandee', cDem.statut);
check('mainlevee_client NON recevable une 2e fois (deja recue)', MPM.pieceRecevable(cRecu, 'mainlevee_client') === false, '');
check('accuse_banque recevable sur mainlevee_recue', MPM.pieceRecevable(cRecu, 'accuse_banque') === true, '');
var ref2 = { blob: 'b2', nom_original: 'ac.pdf' };
var cLib = MPM.appliquerPiece(cRecu, 'accuse_banque', ref2, '2026-09-25');
check('depot accuse banque -> liberee + date + piece', cLib.statut === 'liberee' && cLib.date_liberation === '2026-09-25' && cLib.accuse_banque === ref2, JSON.stringify(cLib));
check('appliquerPiece sur statut invalide -> null (pas de saut d\'etat)', MPM.appliquerPiece(cDem, 'accuse_banque', ref2, '2026-09-25') === null, '');
check('type hors def/RG -> non recevable', MPM.pieceRecevable({ type: 'soumission', statut: 'mainlevee_demandee' }, 'mainlevee_client') === false, '');

console.log('\n=== 7. Lecture des pieces : resolution depuis le doc, jamais un chemin fourni ===');
check('non authentifie (pas de principal) -> refuse', MPM.principalAutorise(null) === false && MPM.principalAutorise({}) === false, '');
check('authentifie (userDetails) -> autorise', MPM.principalAutorise({ userDetails: 'a@neurones.ma' }) === true, '');
var mPv = { id: 'm1', pv_reception_definitive: { blob: 'm1/pv-reception-definitive.pdf', nom_original: 'PV scan.pdf' }, date_reception_definitive_reelle: '2026-09-24' };
var cMl = { id: 'c1', marche_id: 'm1', mainlevee_client: { blob: 'm1/caution-c1/mainlevee_client.pdf' }, date_mainlevee_recue: '2026-09-25', accuse_banque: { blob: 'm1/caution-c1/accuse_banque.pdf' }, date_liberation: '2026-09-30' };
check('resout le blob du PV depuis le marche', MPM.resoudreBlobPiece('pv', mPv, null) === 'm1/pv-reception-definitive.pdf', '');
check('resout le blob de la mainlevee client depuis la caution', MPM.resoudreBlobPiece('mainlevee_client', null, cMl) === 'm1/caution-c1/mainlevee_client.pdf', '');
check('resout le blob de l\'accuse banque depuis la caution', MPM.resoudreBlobPiece('accuse_banque', null, cMl) === 'm1/caution-c1/accuse_banque.pdf', '');
check('type inconnu -> null (aucun service)', MPM.resoudreBlobPiece('n_importe_quoi', mPv, cMl) === null, '');
check('un chemin blob DEVINE passe comme type -> null (pas de passthrough)', MPM.resoudreBlobPiece('m1/pv-reception-definitive.pdf', mPv, cMl) === null, '');
check('piece absente du doc -> null (rien a servir)', MPM.resoudreBlobPiece('pv', { id: 'm2' }, null) === null, '');
check('libelle humain du PV, sans nom de fichier interne', (function () { var l = MPM.libellePiece('pv'); return l.indexOf('.pdf') < 0 && l.indexOf('/') < 0 && l.length > 0; })(), MPM.libellePiece('pv'));
check('libelles distincts pour les 3 types', MPM.libellePiece('pv') !== MPM.libellePiece('mainlevee_client') && MPM.libellePiece('mainlevee_client') !== MPM.libellePiece('accuse_banque'), '');
check('conteneur PV vs pieces caution correctement route', MPM.conteneurPiece('pv') === 'mp-pv-reception' && MPM.conteneurPiece('mainlevee_client') === 'mp-preuves' && MPM.conteneurPiece('accuse_banque') === 'mp-preuves', '');

console.log('\n=== 8. Mail du lundi : file de relance + PAS de mail si vide ===');
var gmStub = function (id) { return id === 'm1' ? { ref: 'MRC-1', titre: 'T1', maitre_ouvrage: 'Client A' } : { ref: 'MRC-2', titre: 'T2', maitre_ouvrage: 'Client B' }; };
var cautMail = [
  { id: 'a', num: 'D1', type: 'bonne_execution', montant: 100000, statut: 'mainlevee_demandee', date_demande_mainlevee: '2026-09-01', marche_id: 'm1' },
  { id: 'b', num: 'R1', type: 'retenue_garantie', montant: 50000, statut: 'mainlevee_demandee', date_demande_mainlevee: '2026-09-20', marche_id: 'm2' },
  { id: 'c', num: 'X', type: 'bonne_execution', montant: 9, statut: 'mainlevee_recue', date_mainlevee_recue: '2026-09-10', marche_id: 'm1' },
  { id: 'd', num: 'Y', type: 'bonne_execution', montant: 9, statut: 'active', marche_id: 'm1' }
];
var lignes = MPM.lignesRelance(cautMail, gmStub, NOW);
check('relance = seulement mainlevee_demandee (2 lignes ; ni recue ni active)', lignes.length === 2, 'n=' + lignes.length);
check('triees par anciennete decroissante (la plus vieille en tete)', lignes[0].num === 'D1', JSON.stringify(lignes.map(function (l) { return l.num; })));
check('ligne = libelles humains (ref + client), AUCUN id', lignes[0].ref === 'MRC-1' && lignes[0].client === 'Client A' && lignes[0].id === undefined && lignes[0].marche_id === undefined, JSON.stringify(lignes[0]));
check('la ligne porte l\'anciennete en jours', lignes[0].jours === MPM.joursDepuisDemande(cautMail[0], NOW), 'j=' + lignes[0].jours);
var mailVide = MPM.mailHebdo([]);
check('file VIDE -> PAS de mail (envoyer=false)', mailVide.envoyer === false, JSON.stringify(mailVide));
var mailPlein = MPM.mailHebdo(lignes);
check('file non vide -> mail (envoyer=true) + nb + total', mailPlein.envoyer === true && mailPlein.nb === 2 && mailPlein.total === 150000, JSON.stringify({ e: mailPlein.envoyer, nb: mailPlein.nb, t: mailPlein.total }));
check('sujet mentionne le nombre et n\'expose aucun id', mailPlein.sujet.indexOf('2') >= 0 && mailPlein.sujet.indexOf('m1') < 0, mailPlein.sujet);

console.log('\n=== 9. Endpoint relance-hebdo : REFUS d\'abord (pas de fail-open, lecon ERP) ===');
check('secret attendu VIDE -> refuse meme si fourni vide (PAS de fail-open)', MPM.enteteRelanceValide('', '') === false && MPM.enteteRelanceValide(undefined, undefined) === false, '');
check('secret attendu defini, en-tete ABSENT -> refuse', MPM.enteteRelanceValide(undefined, 'S3cret-attendu') === false, '');
check('secret attendu defini, en-tete FAUX -> refuse', MPM.enteteRelanceValide('mauvais', 'S3cret-attendu') === false, '');
check('secret attendu defini, en-tete VIDE -> refuse', MPM.enteteRelanceValide('', 'S3cret-attendu') === false, '');
check('en-tete CORRECT -> accepte', MPM.enteteRelanceValide('S3cret-attendu', 'S3cret-attendu') === true, '');

console.log('\n=== 10. Un enregistrement de formulaire ne doit PAS effacer les champs serveur ===');
var CH = MPM.CHAMPS_PV_MARCHE;
check('liste des champs PV marche exportee', Array.isArray(CH) && CH.indexOf('reception_definitive_prononcee') >= 0 && CH.indexOf('pv_reception_definitive') >= 0, JSON.stringify(CH));
var formulaire = { id: 'm1', ref: 'MRC-1', titre: 'edite', montant: 999 }; // objet du formulaire : ne connait PAS les champs PV
var serveur = { id: 'm1', reception_definitive_prononcee: true, date_reception_definitive_reelle: '2026-09-24', pv_reception_definitive: { blob: 'm1/pv-reception-definitive.pdf' } };
var fusion = MPM.preserverChampsServeur(formulaire, serveur, CH);
check('les champs PV du serveur sont PRESERVES sur l\'objet a enregistrer', fusion.reception_definitive_prononcee === true && fusion.date_reception_definitive_reelle === '2026-09-24' && fusion.pv_reception_definitive.blob === 'm1/pv-reception-definitive.pdf', JSON.stringify(fusion));
check('les champs du formulaire restent intacts', fusion.titre === 'edite' && fusion.montant === 999, JSON.stringify(fusion));
var fusion2 = MPM.preserverChampsServeur({ id: 'm2', titre: 't' }, { id: 'm2' }, CH);
check('serveur sans champ PV -> rien invente (pas de cle fantome)', fusion2.reception_definitive_prononcee === undefined && !('pv_reception_definitive' in fusion2), JSON.stringify(fusion2));
check('champs pieces caution exportes (mainlevee_client, accuse_banque)', MPM.CHAMPS_PIECES_CAUTION.indexOf('mainlevee_client') >= 0 && MPM.CHAMPS_PIECES_CAUTION.indexOf('accuse_banque') >= 0, JSON.stringify(MPM.CHAMPS_PIECES_CAUTION));

console.log('\n=== 11. AO/provisoire : une BASCULE SUIVIE d\'un save de formulaire ne perd pas la date ===');
var CT = MPM.CHAMPS_PROV_TRANSITION;
check('liste des champs de transition provisoire exportee', Array.isArray(CT) && CT.indexOf('date_demande_mainlevee') >= 0 && CT.indexOf('date_restitution') >= 0, JSON.stringify(CT));
// (b) BASCULE : provMainlevee a posé date_demande_mainlevee sur la provisoire
var provApresBascule = { banque: 'FINEA', num: 'P1', montant: 9, date_emission: '2020-01-01', statut: 'mainlevee_demandee', date_demande_mainlevee: '2026-09-20' };
// (save) le formulaire editAO reconstruit cpNew SANS la date (5 champs) -> l'ancien bug
var cpFormulaire = { banque: 'FINEA', num: 'P1', montant: 9, date_emission: '2020-01-01', statut: 'mainlevee_demandee' };
MPM.preserverChampsServeur(cpFormulaire, provApresBascule, CT);
check('mainlevee_demandee : date_demande_mainlevee SURVIT au save de formulaire', cpFormulaire.date_demande_mainlevee === '2026-09-20', JSON.stringify(cpFormulaire));
var restForm = { statut: 'restituee' };
MPM.preserverChampsServeur(restForm, { statut: 'restituee', date_restitution: '2026-09-25' }, CT);
check('restituee : date_restitution SURVIT au save de formulaire', restForm.date_restitution === '2026-09-25', JSON.stringify(restForm));
var actForm = { statut: 'active' };
MPM.preserverChampsServeur(actForm, { statut: 'active' }, CT);
check('active (pas de bascule) : aucune date inventee', actForm.date_demande_mainlevee === undefined && actForm.date_restitution === undefined, JSON.stringify(actForm));

console.log('\n=== 12. Date de reception : refusee si absente, JAMAIS completee par aujourd\'hui ===');
check('date vide/absente -> INVALIDE (depot refuse, aucun defaut)', MPM.dateReceptionValide('') === false && MPM.dateReceptionValide(null) === false && MPM.dateReceptionValide(undefined) === false, '');
check('date mal formee -> INVALIDE', MPM.dateReceptionValide('24/09/2026') === false && MPM.dateReceptionValide('2026-9-1') === false, '');
check('date AAAA-MM-JJ -> valide', MPM.dateReceptionValide('2026-09-08') === true, '');

console.log('\n=== 13. Mainlevee MANUELLE (sans PV numerique) : motif libre OBLIGATOIRE + utilisateur trace ===');
check('motif vide/blanc/absent -> invalide (depot refuse)', MPM.motifMainleveeValide('') === false && MPM.motifMainleveeValide('   ') === false && MPM.motifMainleveeValide(null) === false, '');
check('motif libre renseigne -> valide (ex. reception prononcee avant le systeme)', MPM.motifMainleveeValide('reception prononcee avant le systeme') === true, '');
var cAct = { id: 'z1', num: 'Z', type: 'bonne_execution', montant: 5, statut: 'active' };
var majM = MPM.appliquerMainleveeManuelle(cAct, 'reception avant systeme (marche ancien)', 'imane@neurones.ma', '2026-09-24');
check('active + motif -> mainlevee_demandee, motif + utilisateur traces, datee', majM.statut === 'mainlevee_demandee' && majM.mainlevee_motif === 'reception avant systeme (marche ancien)' && majM.mainlevee_par === 'imane@neurones.ma' && majM.date_demande_mainlevee === '2026-09-24', JSON.stringify(majM));
check('ne mute pas l\'entree', cAct.statut === 'active', cAct.statut);
check('sans motif -> refuse (null), aucune bascule', MPM.appliquerMainleveeManuelle(cAct, '   ', 'x', '2026-09-24') === null, '');
check('caution non active -> refuse (null, pas de saut d\'etat)', MPM.appliquerMainleveeManuelle({ statut: 'mainlevee_demandee' }, 'motif', 'x', '2026-09-24') === null, '');

console.log('\n=== 14. Mail : chaque ligne dit si la mainlevee est adossee a un PV ou manuelle ===');
var gmJ = function (id) { return id === 'm1' ? { ref: 'MRC-1', maitre_ouvrage: 'A', reception_definitive_prononcee: true } : { ref: 'MRC-2', maitre_ouvrage: 'B' }; };
var cautJ = [
  { id: 'a', num: 'D1', type: 'bonne_execution', montant: 100000, statut: 'mainlevee_demandee', date_demande_mainlevee: '2026-09-01', marche_id: 'm1' },
  { id: 'b', num: 'R1', type: 'retenue_garantie', montant: 50000, statut: 'mainlevee_demandee', date_demande_mainlevee: '2026-09-20', marche_id: 'm2', mainlevee_motif: 'reception prononcee avant le systeme' }
];
var lj = MPM.lignesRelance(cautJ, gmJ, NOW);
var d1 = lj.filter(function (x) { return x.num === 'D1'; })[0];
var r1 = lj.filter(function (x) { return x.num === 'R1'; })[0];
check('caution sur marche avec PV -> justif=PV', d1.justif === 'PV', JSON.stringify(d1));
check('caution manuelle (marche sans PV) -> justif=manuel + motif transmis', r1.justif === 'manuel' && r1.motif === 'reception prononcee avant le systeme', JSON.stringify(r1));

console.log('\n=== 15. Liberation DIRECTE (active -> liberee sans accuse) : motif OBLIGATOIRE + utilisateur ===');
var cLib = { id: 'l1', num: 'L', type: 'bonne_execution', montant: 5, statut: 'active' };
var majL = MPM.appliquerLiberationDirecte(cLib, 'accuse papier, marche ancien', 'naji@neurones.ma', '2026-09-24');
check('active + motif -> liberee, liberation_par + liberation_motif + date_liberation', majL.statut === 'liberee' && majL.liberation_motif === 'accuse papier, marche ancien' && majL.liberation_par === 'naji@neurones.ma' && majL.date_liberation === '2026-09-24', JSON.stringify(majL));
check('ne mute pas l\'entree', cLib.statut === 'active', cLib.statut);
check('sans motif -> refuse (null), aucune liberation', MPM.appliquerLiberationDirecte(cLib, '  ', 'x', '2026-09-24') === null, '');
check('caution non active -> refuse (null)', MPM.appliquerLiberationDirecte({ statut: 'liberee' }, 'motif', 'x', '2026-09-24') === null, '');

console.log('\n=== 16. Autolink ERP : FAIL-CLOSED (jamais d\'appel ERP sans secret) ===');
check('secret absent/vide -> non configure (endpoint doit refuser 401, aucun appel ERP)', MPM.autolinkConfigure('') === false && MPM.autolinkConfigure('   ') === false && MPM.autolinkConfigure(null) === false && MPM.autolinkConfigure(undefined) === false, '');
check('secret present -> configure', MPM.autolinkConfigure('un-secret') === true, '');

console.log('\n=== 17. OCR acte de caution : modele precis + fail-soft + comparaison cas B (sans ecriture) ===');
check('modele OCR = sonnet, JAMAIS haiku', MPM.MODELE_OCR === 'claude-sonnet-5' && MPM.MODELE_OCR.indexOf('haiku') < 0, MPM.MODELE_OCR);
check('cle IA absente -> non configure (le depot reste possible, OCR dit non configure)', MPM.ocrConfigure('') === false && MPM.ocrConfigure(null) === false, '');
check('cle IA presente -> configure', MPM.ocrConfigure('sk-ant-xxx') === true, '');
// Cas B : comparaison caution stockee vs OCR — écarts, JAMAIS d'écriture
var stock = { montant: 100000, banque: 'BMCE Bank', num: 'ATW-2024-1', date_emission: '2024-05-01', date_echeance: '2025-05-01' };
var identique = { montant: 100000, banque: 'bmce bank ', reference: 'ATW-2024-1', date_emission: '2024-05-01', echeance: '2025-05-01' };
check('OCR identique (normalisé) -> AUCUN ecart', MPM.comparerActe(stock, identique).length === 0, JSON.stringify(MPM.comparerActe(stock, identique)));
var different = { montant: 95000, banque: 'CIH', reference: 'ATW-2024-1', date_emission: '2024-05-01', echeance: '2025-06-01' };
var ec = MPM.comparerActe(stock, different);
var champs = ec.map(function (e) { return e.champ; }).sort().join(',');
check('OCR different -> ecarts sur montant, banque, date_echeance (pas sur num ni date_emission)', champs === 'banque,date_echeance,montant', JSON.stringify(ec));
check('un ecart porte stocke + lu (pour affichage, decision humaine)', ec[0].stocke !== undefined && ec[0].lu !== undefined, JSON.stringify(ec[0]));
check('OCR n\'a rien lu sur un champ -> pas d\'ecart invente', MPM.comparerActe(stock, { montant: 100000 }).length === 0, '');

console.log('\n=== 18. OCR incrément A : cache-key (hash+modèle), type/banque verrouillés, parsing montant, confiance ===');
// (1) cache-key = hash ET modèle
check('cle cache = modele:hash (change de modele -> cle differente, pas de vieille extraction servie)', MPM.cleCacheOcr('abc123', 'claude-sonnet-5') === 'claude-sonnet-5:abc123' && MPM.cleCacheOcr('abc123', 'claude-sonnet-5') !== MPM.cleCacheOcr('abc123', 'claude-haiku-4-5'), '');
// (2) type verrouille aux types connus
check('type OCR -> type connu ou null (la liste verrouille)', MPM.normaliserTypeOcr('Caution definitive') === 'bonne_execution' && MPM.normaliserTypeOcr('RG') === 'retenue_garantie' && MPM.normaliserTypeOcr('retenue de garantie') === 'retenue_garantie' && MPM.normaliserTypeOcr('provisoire') === 'provisoire' && MPM.normaliserTypeOcr('un truc') === null, '');
// (2) banque depuis le referentiel, jamais un libelle libre
var refBanques = ['Attijariwafa Bank', 'BMCE Bank', 'FINEA'];
check('banque OCR -> entree du referentiel ou null (jamais un libelle invente)', MPM.normaliserBanqueOcr('bmce bank', refBanques) === 'BMCE Bank' && MPM.normaliserBanqueOcr('Banque Inconnue SA', refBanques) === null, '');
// (3) parsing montant dans le module pur
check('parse "99 072,00 MAD" -> 99072', MPM.parserMontant('99 072,00 MAD') === 99072, String(MPM.parserMontant('99 072,00 MAD')));
check('parse "99.072" -> 99072 (point = separateur de milliers)', MPM.parserMontant('99.072') === 99072, String(MPM.parserMontant('99.072')));
check('parse "1.234.567,89" -> 1234567.89', MPM.parserMontant('1.234.567,89') === 1234567.89, String(MPM.parserMontant('1.234.567,89')));
check('montant illisible -> null (PAS zero)', MPM.parserMontant('illisible') === null && MPM.parserMontant('') === null, '');
// (3) montant illisible = confiance zero, pas un zero ; (badge) 3 etats
check('confiance : >=80 lu, <80 douteux, absent non_lu (pas de %)', MPM.etatConfiance(80) === 'lu' && MPM.etatConfiance(79) === 'douteux' && MPM.etatConfiance(null) === 'non_lu' && MPM.etatConfiance('x') === 'non_lu', '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
