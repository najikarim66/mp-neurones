/* =========================================================================
 * GATE — Étude d'AO : le bordereau Excel garde des formules de marge VIVANTES et affiche
 * l'écart avec l'estimation du maître d'ouvrage À DROITE du total TTC (règle du DG).
 *
 * Génère le vrai classeur (api/etude/sorties.js) sur la fixture, le RELIT avec exceljs :
 *  - PU vente = formule PA × (1 + marge), Total = formule Qté × PU, pour chaque article ;
 *  - la marge est une valeur saisissable par article (30 % par défaut) ;
 *  - total HT, TVA, TTC en formules ; sur la ligne du TTC, la cellule à sa droite est l'écart
 *    (formule qui lit le TTC et l'estimation) ;
 *  - un article sans PA connu est marqué « à consulter » et compté ;
 *  - lecture du tableur du DCE : feuilles de métré et feuille d'un autre projet écartées avec motif.
 * Nécessite les dépendances de l'API (cd api && npm ci). Lancer : node test/etude-bordereau-xlsx.test.js
 * ========================================================================= */
'use strict';
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function fin() { console.log('\n---------------------------------------------------------------'); if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); } console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
var SO, ExcelJS, M, F;
try { SO = require('../api/etude/sorties.js'); ExcelJS = require('../api/node_modules/exceljs'); M = require('../public/etude-calc.js'); F = require('./fixtures/etude-fixture.js'); }
catch (e) { check('générateur du bordereau présent (api/etude/sorties.js)', false, e.message); fin(); }

console.log('\n=== Lecture du tableur du DCE ===');
var lec = M.choisirFeuilles(M.lireBordereauFeuilles('BPDE fictif.xlsx', F.FEUILLES));
check('3 articles lus dans la feuille BPDE', lec.articles.length === 3, lec.articles.length);
check('feuille de métré écartée avec motif', lec.exclues.some(function (x) { return x.feuille === 'METRE LOT A' && /métré/.test(x.motif); }), JSON.stringify(lec.exclues));
check("feuille « BP » d'un autre projet écartée avec motif", lec.exclues.some(function (x) { return x.feuille === 'BP' && /BPDE/.test(x.motif); }), JSON.stringify(lec.exclues));
check('lignes de total ignorées, section reprise', lec.articles[2].designation === 'Baie de brassage 42U' && lec.articles[0].section === 'PRECABLAGE', JSON.stringify(lec.articles.map(function (a) { return a.section; })));

var arts = F.etudeComplete().bordereau.articles;
SO.bordereauXlsx({ ref: '00/TEST/2026', objet: 'Objet fictif', moa: 'MO fictif', estimation: 3480000, articles: arts, sousDetail: ['1', '2'] }).then(function (out) {
  var wb = new ExcelJS.Workbook();
  return wb.xlsx.load(out.buffer).then(function () { return { wb: wb, L: out.lignes }; });
}).then(function (o) {
  var ws = o.wb.getWorksheet('Bordereau'), L = o.L;
  console.log('\n=== Formules vivantes ===');
  var lignesArt = [];
  for (var r = L.premiere; r <= L.derniere; r++) if (ws.getCell('A' + r).value != null && ws.getCell('A' + r).value !== '') lignesArt.push(r);
  check('3 lignes d\'articles écrites', lignesArt.length === 3, lignesArt.length);
  lignesArt.forEach(function (r) {
    var h = ws.getCell('H' + r).value, i = ws.getCell('I' + r).value, g = ws.getCell('G' + r);
    check('ligne ' + r + ' : PU = formule PA × (1 + marge)', h && h.formula === 'IF(E' + r + '="","",ROUND(E' + r + '*(1+G' + r + '),2))', JSON.stringify(h));
    check('ligne ' + r + ' : Total = formule Qté × PU', i && i.formula === 'IF(H' + r + '="","",ROUND(D' + r + '*H' + r + ',2))', JSON.stringify(i));
    check('ligne ' + r + ' : marge = valeur saisissable 30 %', g.value === 0.3 && g.numFmt === '0%', g.value + ' ' + g.numFmt);
  });
  var sansPa = lignesArt.filter(function (r) { return ws.getCell('F' + r).value === 'à consulter'; });
  check('article sans PA connu marqué « à consulter » (Baie 42U)', sansPa.length === 1 && /Baie/.test(ws.getCell('B' + sansPa[0]).value));
  console.log('\n=== Totaux et écart à droite du TTC ===');
  check('TOTAL HT = SUM des totaux', ws.getCell('I' + L.ht).value.formula === 'SUM(I' + L.premiere + ':I' + L.derniere + ')');
  check('TVA = formule sur le HT et le taux', ws.getCell('I' + L.tva).value.formula === 'ROUND(I' + L.ht + '*$B$6,2)');
  check('TTC = HT + TVA', ws.getCell('I' + L.ttc).value.formula === 'I' + L.ht + '+I' + L.tva && ws.getCell('H' + L.ttc).value === 'TOTAL TTC');
  var k = ws.getCell('K' + L.ttc).value;
  check('à DROITE du TTC (même ligne) : libellé de l\'écart', /Écart avec l'estimation/.test(ws.getCell('J' + L.ttc).value));
  check('cellule d\'écart = formule (TTC − estimation) / estimation', k && k.formula === 'IF(N($B$5)>0,(I' + L.ttc + '-$B$5)/$B$5,"estimation absente")', JSON.stringify(k));
  check('estimation du maître d\'ouvrage en B5', ws.getCell('B5').value === 3480000);
  check('nombre de PA à confirmer = PA encore vides (formule qui suit la saisie)', /^SUMPRODUCT\(\(A\d+:A\d+<>""\)\*\(E\d+:E\d+=""\)\)$/.test((ws.getCell('K' + (L.ttc + 1)).value || {}).formula || ''));
  var sy = o.wb.getWorksheet('Synthèse');
  check('synthèse : notre prix lu sur le TTC du bordereau', sy.getCell('B4').value.formula === 'Bordereau!I' + L.ttc);
  check("synthèse : écart lu sur la cellule d'écart", sy.getCell('B5').value.formula === 'Bordereau!K' + L.ttc);
  var sd = o.wb.getWorksheet('Sous-détail');
  check('sous-détail : PU lié au bordereau (formule)', /^Bordereau!H\d+$/.test((sd.getCell('F5').value || {}).formula || ''), JSON.stringify(sd.getCell('F5').value));
  fin();
}).catch(function (e) { check('classeur généré et relu', false, e.stack); fin(); });
