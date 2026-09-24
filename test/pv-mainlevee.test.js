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

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
