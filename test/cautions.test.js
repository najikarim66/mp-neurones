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

console.log('\n=== 5. Cycle DG 20/11 : piece_recue et demande_deposee (entre demandee au client et liberee) ===');
var recu = { id: 'x1', num: 'X', type: 'retenue_garantie', banque: 'FINEA', montant: 70000, statut: 'piece_recue', marche_id: 'm9', piece_liberation: { type: 'original_caution', date: '2026-11-02', scan: { blob: 'p/orig.pdf' } } };
var ancienRecu = { id: 'x0', num: 'X0', type: 'retenue_garantie', banque: 'FINEA', montant: 5000, statut: 'mainlevee_recue', marche_id: 'm9', mainlevee_client: { blob: 'p/ml.pdf' }, date_mainlevee_recue: '2026-10-01' };
var depose = { id: 'x2', num: 'Y', type: 'bonne_execution', banque: 'BMCE', montant: 20000, statut: 'demande_deposee', marche_id: 'm9', demande_banque: { date_depot: '2026-11-01' } };
var deposeRecent = { id: 'x3', num: 'Z', type: 'bonne_execution', banque: 'BMCE', montant: 1000, statut: 'demande_deposee', marche_id: 'm9', demande_banque: { date_depot: '2026-11-18' } };
check('piece_recue -> encore bloquee (argent pas revenu de la banque)', MPC.isBlocked(recu) === true, '');
check('demande_deposee -> encore bloquee (accuse absent)', MPC.isBlocked(depose) === true, '');
check('ancien mainlevee_recue -> lu piece_recue, bloquee', MPC.etatCycle(ancienRecu) === 'piece_recue' && MPC.isBlocked(ancienRecu) === true, '');
var aggR = MPC.aggregate([recu, ancienRecu, depose, deposeRecent]);
check('kpi.recue = 2 (piece recue, dont l\'ancien etat), kpi.banque = 2', aggR.kpi.recue === 2 && aggR.kpi.banque === 2, JSON.stringify(aggR.kpi));
check('engage inclut piece_recue et demande_deposee (96 000)', aggR.engage === 96000, 'engage=' + aggR.engage);
check('engage par banque : les cautions en attente de la banque y restent (BMCE 21 000)', aggR.byBank['BMCE'].eng === 21000, JSON.stringify(aggR.byBank));
var restR = MPC.aRestituer([recu, depose]);
check('aRestituer N\'inclut PLUS piece_recue / demande_deposee (blocs dedies)', restR.items.length === 0, JSON.stringify(restR));
var adb = MPC.aDemanderBanque([recu, ancienRecu, depose, a]);
check('aDemanderBanque = pieces recues (2), groupees par banque (FINEA), total 75 000', adb.items.length === 2 && adb.parBanque.length === 1 && adb.parBanque[0].banque === 'FINEA' && adb.total === 75000, JSON.stringify(adb.parBanque.map(function (g) { return [g.banque, g.items.length, g.total]; })));
var NOW = new Date('2026-11-20T12:00:00Z').getTime();
var eab = MPC.enAttenteBanque([recu, depose, deposeRecent], NOW, null);
check('enAttenteBanque = demandes deposees (2), plus ancienne d\'abord, jours ecoules 19 et 2', eab.items.length === 2 && eab.items[0].num === 'Y' && eab.items[0].jours === 19 && eab.items[1].jours === 2, JSON.stringify(eab.items.map(function (c) { return [c.num, c.jours]; })));
check('alerte au-dela du delai par defaut (15 j) : Y en alerte, Z non, nbAlerte 1', eab.items[0].alerte === true && eab.items[1].alerte === false && eab.nbAlerte === 1 && eab.delai === 15, '');
var eab30 = MPC.enAttenteBanque([depose], NOW, 30);
check('delai parametrable (30 j) : plus d\'alerte a 19 j', eab30.items[0].alerte === false && eab30.delai === 30, '');
check('depot sans date -> jours null, alerte false, date_depot_absente nomme', (function () { var e = MPC.enAttenteBanque([{ statut: 'demande_deposee', montant: 1, banque: 'B' }], NOW).items[0]; return e.jours === null && e.alerte === false && e.date_depot_absente === true; })(), '');
check('unify transporte piece_liberation / demande_banque (definitive ET provisoire)', (function () {
  var r = MPC.unify([recu], [{ id: 'aoP', ref: 'AO-P', objet: 'Objet AO', maitre_ouvrage: 'MO', statut: 'infructueux', caution_prov: { num: 'PP', banque: 'CIH', montant: 3000, statut: 'demande_deposee', demande_banque: { date_depot: '2026-11-10' } } }], gm);
  return r[0].piece_liberation.type === 'original_caution' && r[1].demande_banque.date_depot === '2026-11-10' && r[1].objet === 'Objet AO' && r[1].maitre_ouvrage === 'MO';
})(), '');

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
