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
  { id:'c1', num:'A', type:'bonne_execution', banque:'FINEA', montant:100000, statut:'active',             marche_id:'m1' },
  { id:'c2', num:'B', type:'retenue_garantie', banque:'BMCE',  montant:50000,  statut:'mainlevee_demandee', marche_id:'m1' }, // definitive a restituer
  { id:'c3', num:'C', type:'bonne_execution', banque:'FINEA', montant:30000,  statut:'liberee',            marche_id:'m2' }
];
var AOS = [
  { id:'ao1', ref:'AO-1', statut:'infructueux', caution_prov:{ num:'P1', banque:'FINEA', montant:220000, statut:'mainlevee_demandee' } }, // prov a restituer (AO decide)
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

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
