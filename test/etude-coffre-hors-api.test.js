/* =========================================================================
 * GATE — Étude d'AO : AUCUN document du coffre de la société n'est envoyé à l'API Claude.
 *
 * Exécute le vrai chemin d'envoi (api/etude/routes.js → soumettreAnalyse → claude.js) avec
 * une base factice et un envoi intercepté :
 *  - la construction refuse tout document dont l'origine n'est pas le DCE ;
 *  - les requêtes réellement soumises ne contiennent que les textes du DCE, même quand
 *    le coffre contient des pièces (marqueurs uniques cherchés dans la charge utile) ;
 *  - les modules d'envoi (claude.js, dce.js) n'importent ni ne nomment le coffre.
 * Nécessite les dépendances de l'API (cd api && npm ci). Lancer : node test/etude-coffre-hors-api.test.js
 * ========================================================================= */
'use strict';
var fs = require('fs'), path = require('path');
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function fin() { console.log('\n---------------------------------------------------------------'); if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); } console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }

var CL, R;
try { CL = require('../api/etude/claude.js'); R = require('../api/etude/routes.js'); }
catch (e) { check("modules d'envoi de l'étude présents (api/etude/claude.js, routes.js)", false, e.message); fin(); }

var MARQUEUR_COFFRE = 'SECRET-COFFRE-ATTESTATION-FISCALE-7f3a';
var dce = [
  { origine: 'dce', fichier: 'DCE/RC.pdf', classe: 'rc', lecture: 'texte', texte: '=== Page 1 ===\nArticle 5 : caution provisoire.', pages: [{ num: 1, debut: 14 }] },
  { origine: 'dce', fichier: 'DCE/CPS.pdf', classe: 'cps', lecture: 'texte', texte: '=== Page 1 ===\nArticle 24 : pénalités.', pages: [{ num: 1, debut: 14 }] }
];
var coffre = { origine: 'coffre', fichier: 'Coffre/attestation fiscale.pdf', classe: 'autres', lecture: 'texte', texte: MARQUEUR_COFFRE, pages: [] };

console.log('\n=== Construction des requêtes ===');
var refus = null;
try { CL.requetesEtude(dce.concat([coffre]), 'complete', { articles: [] }); } catch (e) { refus = e.message; }
check("un document d'origine « coffre » fait échouer la construction", refus && /seul le DCE est envoyé/.test(refus), refus);
var refusOcr = null;
try { CL.requeteOcr(Object.assign({ octets: Buffer.from('x') }, coffre), 0); } catch (e) { refusOcr = e.message; }
check("idem pour la lecture OCR d'un PDF numérisé", refusOcr && /seul le DCE est envoyé/.test(refusOcr), refusOcr);
var sansOrigine = null;
try { CL.requetesEtude([{ fichier: 'x.pdf', classe: 'rc', lecture: 'texte', texte: 'abc' }], 'pre', {}); } catch (e) { sansOrigine = e.message; }
check("un document SANS origine déclarée est refusé aussi", !!sansOrigine, sansOrigine);

console.log("\n=== Chemin réel d'envoi (base factice, envoi intercepté) ===");
var soumis = [];
CL.soumettre = function (requetes) { soumis.push(JSON.stringify(requetes)); return Promise.resolve({ id: 'msgbatch_fixture', statut: 'in_progress' }); };
var fauxDb = {
  container: function (nom) {
    return {
      items: {
        query: function () { return { fetchAll: function () { return Promise.resolve({ resources: nom === 'mp_coffre_docs' ? [{ id: 'c', texte: MARQUEUR_COFFRE }] : [0] }); } }; }
      }
    };
  }
};
var etude = { id: 'etude_fixture_v1', type: 'complete', type_ao: 'travaux', cout_usd: 0, journal: [] };
var textes = dce.map(function (d) { return { fichier: d.fichier, classe: d.classe, lecture: d.lecture, texte: d.texte, pages: d.pages, feuilles: null }; });
R._interne.soumettreAnalyse(fauxDb, etude, textes, Object.assign({}, R._interne.PARAMS_DEFAUT)).then(function () {
  check('un lot a été soumis', soumis.length === 1, etude.statut_libelle);
  var charge = soumis.join('');
  check('la charge envoyée ne contient AUCUN texte du coffre', charge.indexOf(MARQUEUR_COFFRE) < 0);
  check('la charge envoyée contient bien les textes du DCE', charge.indexOf('Article 24 : pénalités.') >= 0);
  var docsEnvoyes = JSON.parse(soumis[0])[0].params.messages[0].content.filter(function (c) { return c.type === 'document'; });
  check('documents envoyés = exactement les 2 pièces du DCE', docsEnvoyes.length === 2 && docsEnvoyes.every(function (d) { return /Pièce du DCE/.test(d.context); }), docsEnvoyes.length);
  check('citations activées sur chaque document envoyé', docsEnvoyes.every(function (d) { return d.citations && d.citations.enabled === true; }));

  console.log("\n=== Les modules d'envoi ignorent le coffre ===");
  ['api/etude/claude.js', 'api/etude/dce.js'].forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    var req = (src.match(/require\(\s*["'][^"']+["']\s*\)/g) || []);
    check(f + ' : aucun import du routeur ou du coffre (' + req.join(', ') + ')', req.every(function (x) { return !/routes|coffre/.test(x); }));
    check(f + ' : aucun appel au conteneur ou au blob du coffre', !/mp_coffre_docs|mp-coffre|lireCoffre|C_COFFRE|B_COFFRE/.test(src));
  });
  fin();
}).catch(function (e) { check('soumettreAnalyse exécutée', false, e.stack); fin(); });
