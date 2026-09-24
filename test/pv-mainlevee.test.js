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

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
