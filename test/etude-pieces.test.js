/* =========================================================================
 * GATE — Étude d'AO : chaque pièce que MP rédige se GÉNÈRE sans erreur et contient ce
 * qu'elle annonce (exécute les vrais générateurs de api/etude/sorties.js sur la fixture) :
 *  - Word valides (déclaration sur l'honneur, acte d'engagement en chiffres ET en lettres,
 *    mémoire, moyens, conformité « Conforme » partout, bordereau des références limité aux
 *    articles du bordereau, références, lettre de caution, export de l'étude) ;
 *  - Gantt PDF (phases tirées du bordereau, libellés entiers) ;
 *  - dossier complet zip rangé par dossier, avec sommaire et compteurs.
 * Nécessite les dépendances de l'API (cd api && npm ci). Lancer : node test/etude-pieces.test.js
 * ========================================================================= */
'use strict';
var fails = [], count = 0;
function check(name, cond, detail) { count++; if (cond) console.log('  OK   ' + name); else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); } }
function fin() { console.log('\n---------------------------------------------------------------'); if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); } console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
var SO, M, F, fflate;
try { SO = require('../api/etude/sorties.js'); M = require('../public/etude-calc.js'); F = require('./fixtures/etude-fixture.js'); fflate = require('../api/node_modules/fflate'); }
catch (e) { check('générateurs des pièces présents (api/etude/sorties.js)', false, e.message); fin(); }

function texteDocx(buf) {
  var z = fflate.unzipSync(new Uint8Array(buf), { filter: function (f) { return f.name === 'word/document.xml'; } });
  var x = z['word/document.xml'];
  return x ? Buffer.from(x).toString('utf8').replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
}
var r = F.etudeComplete();
r.conformite = [{ num: '1', designation: 'Prise RJ45 catégorie 6A blindée', exigence: 'Catégorie 6A, blindée', fourniture: 'standard', article: 'CPS art. 40', sources: [] },
  { num: '2', designation: 'Câble F/FTP catégorie 6A', exigence: 'LSOH', fourniture: 'option', article: 'CPS art. 41', sources: [] }];
r.memoire = [{ num: '1', titre: "Présentation de l'entreprise", paragraphes: [{ texte: 'Neurones intervient en précâblage.', sources: [] }] }];
var arts = r.bordereau.articles;
var totaux = M.totauxBordereau(arts, 3480000);
var ctx = {
  ref: '00/TEST/2026', objet: 'Objet fictif', moa: 'MO fictif', estimation: 3480000, tva: 0.2, articles: arts, totaux: totaux, memoire: r.memoire, conformite: r.conformite,
  sousDetail: ['1'], societe: { raison_sociale: 'Société fictive', rc: '000', ice: '000000000000000', ville: 'Casablanca', rib: '000 000' }, modeleDce: 'MODELE AE.docx',
  outillage: [{ categorie: 'Électroportatif', designation: 'Perforateur', marque: 'X', modele: 'Y', etat: 'bon' }], personnel: [{ nom: 'Personne fictive', poste: 'CHEF DE PROJET' }], personnelValide: true,
  references: [{ ref: '23/2021', objet: 'Précâblage fictif', maitre_ouvrage: 'MO', montant: 1000000, attestation: 'dans le coffre' }], referencesValidees: false,
  banque: 'Banque fictive', cautionMontant: 35000, dateLimite: '13/11/2026 à 10:00', delai: { semaines: 17, texte: '4 mois' }, resultat: r, version: 1, type: 'complete',
  etudeLe: '2026-11-01', dceLe: '2026-10-29', ecarts: M.ecartsFiche(r.faits, { date_limite: '2026-11-12' }), eclaircissements: M.dateEclaircissements('2026-11-12', '7 jours')
};
var gens = [
  ['declarationHonneur', /déclare sur l'honneur/],
  ['acteEngagement', new RegExp(M.montantEnLettres(totaux.ttc).replace(/[()]/g, '.'))],
  ['memoireWord', /Présentation de l'entreprise/],
  ['moyensMateriels', /Perforateur/],
  ['moyensHumains', /Personne fictive/],
  ['conformiteWord', /Conforme/],
  ['bordereauReferencesWord', /une ligne par prix \(3 lignes\)/],
  ['referencesWord', /PROPOSITION non validée/],
  ['lettreCaution', /Trente-cinq mille dirhams/],
  ['etudeWord', /Fiche synthèse/]
];
var i = 0;
(function suivant() {
  if (i >= gens.length) return fin2();
  var g = gens[i++];
  Promise.resolve(SO[g[0]](ctx)).then(function (buf) {
    var t = texteDocx(buf);
    check(g[0] + ' : Word valide', !!t);
    check(g[0] + ' : contient ' + g[1], t && g[1].test(t), t && t.slice(0, 200));
    if (g[0] === 'conformiteWord') check('conformité : jamais « par équivalence »', !/quivalence/i.test(t) && (t.match(/Conforme/g) || []).length >= 2);
    if (g[0] === 'acteEngagement') check('acte : montant TTC en chiffres', t.indexOf(M.montantFR(totaux.ttc)) >= 0 && /article\(s\) sans PA connu/.test(t), M.montantFR(totaux.ttc));
    if (g[0] === 'conformiteWord') check('conformité : standard et option distingués', /Standard/.test(t) && /Option à prévoir/.test(t));
    suivant();
  }).catch(function (e) { check(g[0] + ' généré', false, e.stack); suivant(); });
})();
function fin2() {
  SO.ganttPdf({ ref: ctx.ref, articles: arts, semaines: 17, delaiTexte: '4 mois' }).then(function (g) {
    check('Gantt : PDF valide', g.buffer.slice(0, 5).toString() === '%PDF-');
    check('Gantt : préparation + la section du bordereau + réception', g.phases.length === 3 && /PRECABLAGE/.test(g.phases[1].nom), JSON.stringify(g.phases.map(function (p) { return p.nom; })));
    check('Gantt : phases dans le délai (17 semaines)', g.phases.every(function (p) { return p.debut >= 0 && p.fin <= 17 && p.fin > p.debut; }));
    var lignes = r.pieces.map(function (pc) { return M.ligneDossier(pc, { coffre: F.COFFRE, dateDepot: '2026-11-13', aujourdhui: '2026-11-01' }); });
    var zip = SO.zipDossier({ ref: ctx.ref, lignes: lignes, pieces: [{ dossier: 'ADMINISTRATIF', nom: "Declaration sur l'honneur.docx", buffer: Buffer.from('x') }, { dossier: 'FINANCIER', nom: 'Bordereau.xlsx', buffer: Buffer.from('y') }] });
    var z = fflate.unzipSync(new Uint8Array(zip));
    var noms = Object.keys(z);
    check('dossier zip : sommaire en tête', noms.indexOf('00 - SOMMAIRE.txt') >= 0);
    check('dossier zip : pièces rangées par dossier', noms.indexOf("1 - Dossier administratif/Declaration sur l'honneur.docx") >= 0 && noms.indexOf('5 - Offre financiere/Bordereau.xlsx') >= 0, noms.join(', '));
    var som = Buffer.from(z['00 - SOMMAIRE.txt']).toString('utf8');
    check('sommaire : compteurs exigées / prêtes / à compléter / manquantes', /Pièces exigées : 8 · prêtes : \d+ · à compléter, signer ou envoyer : \d+ · manquantes ou expirées : \d+/.test(som), som.slice(0, 400));
    check('sommaire : la CNSS expirée y figure comme « Expirée »', /Attestation de la CNSS — Expirée/.test(som));
    fin();
  }).catch(function (e) { check('Gantt et zip générés', false, e.stack); fin(); });
}
