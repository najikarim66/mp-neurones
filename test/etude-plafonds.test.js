/* =========================================================================
 * GATE — Étude d'AO : les plafonds de coût (par étude, par mois) BLOQUENT l'envoi à l'API.
 *
 * La clé Anthropic est partagée avec l'ERP : la facture mélange les deux, seule la mesure
 * de MP (jetons relevés à chaque étude) fait foi pour MP. Cette gate exécute :
 *  - le coût d'un relevé de jetons (tarif lot = moitié prix) ;
 *  - controlePlafonds aux bornes (égal au plafond = accepté, au-dessus = refusé avec motif) ;
 *  - le vrai chemin d'envoi (routes.js → soumettreAnalyse) avec une base factice dont la
 *    consommation du mois est piégée : au-dessus du plafond, AUCUN lot n'est soumis.
 * Nécessite les dépendances de l'API (cd api && npm ci). Lancer : node test/etude-plafonds.test.js
 * ========================================================================= */
'use strict';
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function fin() { console.log('\n---------------------------------------------------------------'); if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); } console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }

var M, CL, R;
try { M = require('../public/etude-calc.js'); CL = require('../api/etude/claude.js'); R = require('../api/etude/routes.js'); }
catch (e) { check("modules de l'étude présents", false, e.message); fin(); }

console.log('\n=== Coût mesuré à partir des jetons ===');
var c = M.coutUsd({ input_tokens: 1000000, output_tokens: 100000 }, 'claude-opus-5-5', true);
check('1 M jetons en entrée + 100 k en sortie, par lot : 2 + 1 = 3 USD', Math.abs(c - 3) < 1e-9, c);
check('hors lot : le double (6 USD)', Math.abs(M.coutUsd({ input_tokens: 1000000, output_tokens: 100000 }, 'claude-opus-5-5', false) - 6) < 1e-9);

console.log('\n=== Plafonds aux bornes ===');
var P = { plafond_etude_usd: 3, plafond_mois_usd: 40 };
check('estimation = plafond par étude : acceptée', M.controlePlafonds(3, 0, P).ok === true);
var r1 = M.controlePlafonds(3.01, 0, P);
check('estimation au-dessus du plafond par étude : refusée, motif nommé', r1.ok === false && /plafond par étude \(3 USD\)/.test(r1.motif), r1.motif);
check('mois à 38 USD + 2 = 40 : acceptée', M.controlePlafonds(2, 38, P).ok === true);
var r2 = M.controlePlafonds(2, 38.5, P);
check('mois à 38,50 USD + 2 > 40 : refusée, motif nommé', r2.ok === false && /plafond du mois atteint : 38\.50 \+ 2\.00 USD dépasse 40 USD/.test(r2.motif), r2.motif);
check('coût non estimable : refusé', M.controlePlafonds(null, 0, P).ok === false);

console.log("\n=== Chemin réel d'envoi : un plafond atteint ne soumet rien ===");
var soumis = 0;
CL.soumettre = function () { soumis++; return Promise.resolve({ id: 'msgbatch_fixture' }); };
function base(conso) { return { container: function () { return { items: { query: function () { return { fetchAll: function () { return Promise.resolve({ resources: [conso] }); } }; } } }; } }; }
var textes = [{ fichier: 'DCE/RC.pdf', classe: 'rc', lecture: 'texte', texte: '=== Page 1 ===\nArticle 5 : caution provisoire.', pages: [{ num: 1, debut: 14 }], feuilles: null }];
var params = Object.assign({}, R._interne.PARAMS_DEFAUT);
var eRefus = { id: 'etude_fixture_v1', type: 'complete', type_ao: 'travaux', cout_usd: 0, journal: [] };
R._interne.soumettreAnalyse(base(params.plafond_mois_usd), eRefus, textes, params).then(function () {
  check('mois déjà au plafond : étude « refusée »', eRefus.statut === 'refusee', eRefus.statut);
  check('motif affiché « Non envoyée : plafond du mois atteint »', /^Non envoyée : plafond du mois atteint/.test(eRefus.statut_libelle), eRefus.statut_libelle);
  check('aucun lot soumis à Anthropic', soumis === 0, soumis);
  var eOk = { id: 'etude_fixture_v2', type: 'complete', type_ao: 'travaux', cout_usd: 0, journal: [] };
  return R._interne.soumettreAnalyse(base(0), eOk, textes, params).then(function () {
    check('mois vide : lot soumis, estimation conservée sur l\'étude', soumis === 1 && eOk.statut === 'analyse_en_cours' && eOk.estimation_usd > 0, eOk.statut + ' ' + eOk.estimation_usd);
    fin();
  });
}).catch(function (e) { check("chemin d'envoi exécuté", false, e.stack); fin(); });
