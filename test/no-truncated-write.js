/* =========================================================================
 * GATE - Aucun champ de DONNÉE ne doit être stocké tronqué.
 *
 * Vise l'ÉCRITURE, pas l'affichage : un champ d'un objet persisté (marché, AO,
 * caution, avenant…) ne doit jamais recevoir une valeur `X.substring(0,N)` ou
 * `X.slice(0,N)`. C'est le défaut de l'import historique (titre coupé à 80) qui a
 * amputé 25/33 marchés — corrigé, cette gate empêche qu'il revienne (prochain
 * import, nouveau formulaire…).
 *
 * Le formatage de DATE (`...toISOString().slice(0,10)`, champs date_*) est exclu :
 * ce n'est pas une donnée tronquée, c'est une date normalisée.
 *
 * Statique par nature (elle juge le code écrit, pas un runtime DOM). Rouge = un
 * chemin d'écriture tronque un champ.
 *
 * Lancer : node test/no-truncated-write.js   (exit 0 = vert, 1 = rouge)
 * ========================================================================= */
'use strict';
var fs = require('fs');
var src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');

// champ: <expr identifiants/points/parenthèses> .substring|slice ( 0 , N )
// La classe du milieu exclut guillemets, > et + : on ne matche donc PAS
// l'affichage (concaténation de chaînes / CSS style="color:...">'+x.substring).
var RE = /([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z0-9_.\[\]() |]*?)\.(substring|slice)\(\s*0\s*,\s*(\d+)\s*\)/g;
var DATE_FIELD = /(date|_at|_le|created|updated)/i;

var lines = src.split('\n');
var offenders = [];
var m;
while ((m = RE.exec(src))) {
  var field = m[1], expr = m[2], method = m[3], n = m[4];
  // Exclure le formatage de date (pas une donnée tronquée).
  if (DATE_FIELD.test(field)) continue;
  if (/toISOString|new Date|getFullYear/.test(expr)) continue;
  // Position -> numéro de ligne
  var line = src.slice(0, m.index).split('\n').length;
  offenders.push({ line: line, field: field, frag: field + ': ' + expr + '.' + method + '(0,' + n + ')' });
}

console.log('=== Gate : aucun champ de donnée stocké tronqué ===');
if (offenders.length) {
  offenders.forEach(function (o) { console.log('  ROUGE  L' + o.line + '  ' + o.frag); });
  console.log('\nROUGE : ' + offenders.length + ' écriture(s) tronquée(s). Stocker la valeur ENTIÈRE ; tronquer seulement à l\'affichage (wrap/tooltip).');
  process.exit(1);
} else {
  console.log('VERT : aucune écriture tronquée détectée.');
  process.exit(0);
}
