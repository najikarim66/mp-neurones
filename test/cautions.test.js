/* =========================================================================
 * GATE - Registre des cautions (fusion collection + provisoires portees par AO).
 *
 * Verifie la logique PURE derriere l'ecran Cautions : liste unifiee, "encore
 * bloquee a la banque", agregats qui SUIVENT le filtre, et le bloc "a restituer"
 * qui reunit provisoires (sur AO decide) ET definitives en mainlevee demandee.
 *
 * Lancer : node test/cautions.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var MPC = require('../public/cautions-calc.js');

var fails = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}

/* Fixture deterministe (pas de reseau). gm resout marche_id -> {ref,titre}. */
var CAUTIONS = [
  { id:'c1', num:'A', type:'bonne_execution', banque:'FINEA', montant:100000, statut:'active',             marche_id:'m1', acte:{ blob:'actes/aaa.pdf' } },
  { id:'c2', num:'B', type:'retenue_garantie', banque:'BMCE',  montant:50000,  statut:'mainlevee_demandee', marche_id:'m1', acte:{ blob:'actes/rg.pdf' }, mainlevee_client:{ blob:'preuves/ml.pdf' }, date_mainlevee_recue:'2025-04-15' }, // RG a restituer + acte + mainlevee client
  { id:'c3', num:'C', type:'bonne_execution', banque:'FINEA', montant:30000,  statut:'liberee',            marche_id:'m2', accuse_banque:{ blob:'preuves/acc.pdf' }, date_liberation:'2025-05-01' } // liberee : porte l'accuse bancaire
];
var AOS = [
  { id:'ao1', ref:'AO-1', statut:'infructueux', caution_prov:{ num:'P1', banque:'FINEA', montant:220000, statut:'mainlevee_demandee', acte:{ blob:'actes/p1.pdf' } } }, // prov a restituer (AO decide) + acte joint
  { id:'ao2', ref:'AO-2', statut:'en_cours',    caution_prov:{ num:'P2', banque:'BMCE',  montant:40000,  statut:'active' } },             // active, AO non decide
  { id:'ao3', ref:'AO-3', statut:'en_cours',    caution_prov:{ num:'',   banque:'',      montant:8000,   statut:'en_attente' } }          // pas encore constituee
];
var gm = function (id) { return { ref: id === 'm1' ? 'MRC-1' : 'MRC-2', titre: 'Titre ' + id }; };

console.log('\n=== 1. Liste unifiee ===');
var rows = MPC.unify(CAUTIONS, AOS, gm);
check('68+4 -> ici 3 collection + 3 provisoires = 6 lignes', rows.length === 6, 'len=' + rows.length);
var p1 = rows.filter(function (r) { return r.src === 'ao' && r.num === 'P1'; })[0];
check('une provisoire est normalisee (type provisoire, ref = ref AO)', !!p1 && p1.type === 'provisoire' && p1.ref === 'AO-1', JSON.stringify(p1));
var a = rows.filter(function (r) { return r.num === 'A'; })[0];
check('une definitive porte la ref ET le titre du marche (via gm)', a.ref === 'MRC-1' && a.titre === 'Titre m1', JSON.stringify(a));
// Cause racine du lien « voir l'acte » mort : unify DOIT transporter l'acte.
check('unify transporte l\'acte d\'une DEFINITIVE (lien par cautionId)', !!a.acte && a.acte.blob === 'actes/aaa.pdf', JSON.stringify(a.acte));
check('unify transporte l\'acte d\'une PROVISOIRE + _aoId (lien par aoId)', !!p1.acte && p1.acte.blob === 'actes/p1.pdf' && p1._aoId === 'ao1', JSON.stringify({ acte: p1.acte, aoId: p1._aoId }));
check('une provisoire SANS acte -> acte null (pas de lien)', (function(){ var p2=rows.filter(function(r){return r.num==='P2';})[0]; return p2 && p2.acte === null; })(), '');
check('une RETENUE DE GARANTIE porte aussi son acte (lien, type-agnostique)', (function(){ var rg=rows.filter(function(r){return r.num==='B';})[0]; return rg && rg.type==='retenue_garantie' && !!rg.acte && rg.acte.blob==='actes/rg.pdf'; })(), '');
check('unify transporte l\'ACCUSÉ BANCAIRE d\'une libérée + date_liberation', (function(){ var cc=rows.filter(function(r){return r.num==='C';})[0]; return cc && cc.accuse_banque && cc.accuse_banque.blob==='preuves/acc.pdf' && cc.date_liberation==='2025-05-01'; })(), '');
check('unify transporte la MAINLEVÉE CLIENT + date_mainlevee_recue', (function(){ var b=rows.filter(function(r){return r.num==='B';})[0]; return b && b.mainlevee_client && b.mainlevee_client.blob==='preuves/ml.pdf' && b.date_mainlevee_recue==='2025-04-15'; })(), '');

console.log('\n=== 2. Encore bloquee = active OU mainlevee demandee (col et ao) ===');
check('definitive active -> bloquee', MPC.isBlocked(a) === true, '');
check('definitive liberee -> NON bloquee', MPC.isBlocked(rows.filter(function(r){return r.num==='C';})[0]) === false, '');
check('definitive mainlevee demandee -> bloquee (argent encore a la banque)', MPC.isBlocked(rows.filter(function(r){return r.num==='B';})[0]) === true, '');
check('provisoire en_attente -> NON bloquee (pas encore constituee)', MPC.isBlocked(rows.filter(function(r){return r.statut==='en_attente';})[0]) === false, '');

console.log('\n=== 3. Agregats qui SUIVENT le filtre ===');
var aggTout = MPC.aggregate(rows);
check('engage (tout) = A100k+B50k+P1 220k+P2 40k = 410 000', aggTout.engage === 410000, 'engage=' + aggTout.engage);
check('par banque : FINEA = 320 000 (A+P1)', aggTout.byBank['FINEA'].eng === 320000, JSON.stringify(aggTout.byBank['FINEA']));
check('par banque : BMCE = 90 000 (B+P2)', aggTout.byBank['BMCE'].eng === 90000, JSON.stringify(aggTout.byBank['BMCE']));
check('KPI : 2 actives, 2 mainlevee, 0 expiree, 1 liberee', aggTout.kpi.active===2 && aggTout.kpi.mainlevee===2 && aggTout.kpi.expiree===0 && aggTout.kpi.liberee===1, JSON.stringify(aggTout.kpi));
var provOnly = MPC.applyFilters(rows, { type: 'provisoire' });
var aggProv = MPC.aggregate(provOnly);
check('filtre provisoire -> 3 lignes', provOnly.length === 3, 'len=' + provOnly.length);
check('engage (filtre provisoire) = 260 000 (P1+P2, P3 exclue)', aggProv.engage === 260000, 'engage=' + aggProv.engage);
var fineaOnly = MPC.applyFilters(rows, { banque: 'FINEA' });
check('filtre banque FINEA -> 3 lignes (A, C, P1)', fineaOnly.length === 3, 'len=' + fineaOnly.length);

console.log('\n=== 4. A restituer : provisoires (AO decide) + definitives en mainlevee ===');
var r = MPC.aRestituer(rows, AOS);
var refs = r.items.map(function (x) { return x.num; }).sort().join(',');
check('reunit P1 (prov, AO infructueux) ET B (def mainlevee) ; pas P2 (AO en cours)', refs === 'B,P1', 'items=' + refs);
check('total a restituer = 270 000 (220k + 50k)', r.total === 270000, 'total=' + r.total);

console.log('\n=== 5. Cycle 3 etats : mainlevee_recue (entre demandee et liberee) ===');
var recu = { id: 'x1', num: 'X', type: 'retenue_garantie', banque: 'FINEA', montant: 70000, statut: 'mainlevee_recue', marche_id: 'm9' };
check('mainlevee_recue -> encore bloquee (argent pas revenu de la banque)', MPC.isBlocked(recu) === true, '');
var aggR = MPC.aggregate([recu]);
check('kpi.recue = 1', aggR.kpi.recue === 1, JSON.stringify(aggR.kpi));
check('engage inclut la mainlevee_recue', aggR.engage === 70000, 'engage=' + aggR.engage);
var restR = MPC.aRestituer([recu]);
check('aRestituer inclut mainlevee_recue', restR.items.length === 1 && restR.total === 70000, JSON.stringify(restR));

console.log('\n=== 6. Reference banque COMPLETE (referenceBanque) + alias (num) — 23/10/2026 ===');
var CREF = [
  { id:'r1', num:'694066', referenceBanque:'810012624000694066', type:'retenue_garantie', banque:'BMCE Bank', montant:13088, statut:'active', marche_id:'m1' },
  { id:'r2', num:'133243', type:'bonne_execution', banque:'FINEA', montant:105740, statut:'active', marche_id:'m2' } // pas de reference complete (fiche non migree)
];
var rowsRef = MPC.unify(CREF, [{ id:'aoR', ref:'AO-R', statut:'en_cours', caution_prov:{ num:'790909', referenceBanque:'780002621000790909', banque:'BMCE Bank', montant:50000, statut:'active' } }], gm);
check('unify transporte referenceBanque d\'une caution ET l\'alias num reste', rowsRef[0].referenceBanque === '810012624000694066' && rowsRef[0].num === '694066', JSON.stringify(rowsRef[0]));
check('unify : fiche sans reference complete -> referenceBanque null (jamais inventee)', rowsRef[1].referenceBanque === null, JSON.stringify(rowsRef[1].referenceBanque));
check('unify transporte referenceBanque d\'une PROVISOIRE portee par un AO', rowsRef[2].referenceBanque === '780002621000790909', JSON.stringify(rowsRef[2]));
check('recherche par la reference complete trouve la caution', MPC.applyFilters(rowsRef, { search: '8100126240006' }).length === 1 && MPC.applyFilters(rowsRef, { search: '8100126240006' })[0].id === 'r1', '');
check('recherche par l\'alias trouve toujours la caution', MPC.applyFilters(rowsRef, { search: '694066' }).length === 1, '');
check('recherche d\'une reference inconnue -> 0 ligne (pas de faux positif)', MPC.applyFilters(rowsRef, { search: '999999999' }).length === 0, '');

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
