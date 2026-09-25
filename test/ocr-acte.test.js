/* =========================================================================
 * GATE - Normalisation OCR acte + TRACE de la valeur brute (serveur).
 *
 * Verifie le comportement REEL de api/lib/ocr-acte.js::_normaliser (fixture
 * piegee, pas de reseau, pas de SDK charge — l'appel modele est paresseux) :
 *   1. Traduction : type provisoire/CP -> soumission ; montant parse ; banque
 *      rattachee au referentiel.
 *   2. TRACE : la valeur BRUTE lue reste dans lu_brut — une traduction ne doit
 *      JAMAIS effacer ce qui etait ecrit sur l'acte (decision Karim).
 *   3. Type non reconnu -> champ non lu (null) + confiance non_lu ; la brute
 *      reste quand meme dans la trace.
 *
 * Lancer : node test/ocr-acte.test.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var ocr = require('../api/lib/ocr-acte.js');

var fails = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); fails.push(name); }
}

var refBanques = ['Attijariwafa Bank', 'BMCE Bank', 'FINEA'];

console.log('\n=== 1. Traduction (type / montant / banque) ===');
var r = ocr._normaliser({
  montant: '99 072,00 MAD', banque: 'bmce', reference: 'CP-2026-7', type: 'caution provisoire',
  date_emission: '2026-01-05', echeance: '2026-07-05',
  confiances: { montant: 95, banque: 90, reference: 88, type: 92, date_emission: 90, echeance: 60 }
}, refBanques);
check('type provisoire -> soumission (pont)', r.champs.type === 'soumission', r.champs.type);
check('montant "99 072,00 MAD" -> 99072', r.champs.montant === 99072, String(r.champs.montant));
check('banque "bmce" -> "BMCE Bank" (referentiel)', r.champs.banque === 'BMCE Bank', r.champs.banque);
check('confiance echeance 60 -> douteux', r.confiances.echeance === 'douteux', r.confiances.echeance);

console.log('\n=== 2. TRACE : la valeur brute lue survit a la traduction ===');
check('lu_brut.type = ce qui etait ecrit sur l\'acte (pas "soumission")', r.lu_brut.type === 'caution provisoire', JSON.stringify(r.lu_brut.type));
check('lu_brut.montant = la chaine lue (pas 99072)', r.lu_brut.montant === '99 072,00 MAD', JSON.stringify(r.lu_brut.montant));
check('lu_brut.banque = ce qui etait lu (pas le libelle du referentiel)', r.lu_brut.banque === 'bmce', JSON.stringify(r.lu_brut.banque));

console.log('\n=== 3. Type non reconnu -> non lu, confiance zero, brute conservee ===');
var r2 = ocr._normaliser({ type: 'aval bancaire exotique', confiances: { type: 99 } }, refBanques);
check('type inconnu -> champs.type null (a choisir a la main)', r2.champs.type === null, JSON.stringify(r2.champs.type));
check('type inconnu -> confiance non_lu (meme si le modele etait sur)', r2.confiances.type === 'non_lu', r2.confiances.type);
check('type inconnu -> lu_brut.type garde la brute (trace non effacee)', r2.lu_brut.type === 'aval bancaire exotique', JSON.stringify(r2.lu_brut.type));

console.log('\n=== 4. Champ absent -> null partout (pas de valeur inventee) ===');
var r3 = ocr._normaliser({}, refBanques);
check('rien lu -> champs null, lu_brut null, confiance non_lu', r3.champs.montant === null && r3.lu_brut.montant === null && r3.confiances.montant === 'non_lu', JSON.stringify([r3.champs.montant, r3.lu_brut.montant, r3.confiances.montant]));

console.log('\n---------------------------------------------------------------');
if (fails.length) { console.log('ROUGE : ' + fails.length + ' / ' + count + ' echecs -> ' + fails.join(' | ')); process.exit(1); }
else { console.log('VERT : ' + count + ' / ' + count + ' assertions OK'); process.exit(0); }
