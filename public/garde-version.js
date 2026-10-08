/* ============================================================================
 * garde-version.js — Garde de version MP (modele ERP/RH 878acef, decision Karim
 * 08/10). La garde JUGE LE CONTRAT (un entier dans api/contrat-api.json), plus les
 * empreintes de commit : un deploiement sans changement de contrat ne dit rien a
 * personne (fini le « Mise en service » reste 3 h 30 chez le DG). Deux cas bloquent
 * les ECRITURES (jamais les lectures) :
 *   · onglet PERIME  : le build DEPLOYE (version.json relu) est plus recent que le
 *     build EXECUTE (version.json fige au chargement) -> « Nouvelle version
 *     disponible — Recharger ». Recharger regle tout.
 *   · API EN RETARD  : le contrat servi par /api/version est plus petit que le
 *     contrat EXIGE par l'onglet (apiContractMin, grave dans version.json par la CI
 *     depuis api/contrat-api.json) -> « Mise en service en cours ». S'eteint seul
 *     quand l'API rattrape, sans rechargement.
 * Un numero manquant/illisible (hors ligne, 302 Entra, build local) ne conclut
 * JAMAIS (doctrine #35). Interrupteur : gardeVersionActive=false (servi par
 * /api/version) eteint tout ; absent/illisible -> garde ACTIVE.
 *
 * ES5 vanilla (charge par index.html ET par la gate node). Aucune horloge, aucun
 * commit dans la decision — le PUR est verdictVersion ; badgeHTML/bandeauHTML ne
 * font que du rendu (chaines), testables sans DOM.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GardeVersion = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TITRE_PERIME = 'Nouvelle version disponible — Recharger';
  var TITRE_API = 'Mise en service en cours';
  var MSG_REFUS_PERIME = 'Enregistrement suspendu : cet ecran execute une version plus ancienne que celle en ligne. Rien n\'a ete envoye — rechargez la page (bouton « Recharger »), puis refaites le geste.';
  var MSG_REFUS_API = 'Enregistrement suspendu : cet ecran attend une version du serveur plus recente, dont la mise en service est en cours. Rien n\'a ete envoye. Reessayez dans quelques minutes — recharger la page n\'y change rien.';

  function entier(x) {
    if (typeof x === 'number' && isFinite(x) && Math.floor(x) === x) return x;
    if (typeof x === 'string' && /^\d+$/.test(x)) return parseInt(x, 10);
    return null;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function jjmm(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (m[3] + '/' + m[2]) : ''; }

  /* VERDICT PUR. execute = version.json fige au chargement {build,commit,buildDate,
   * apiContractMin} ; deploye = version.json relu {build,commit} ; api = /api/version
   * {apiContract, gardeVersionActive}. Renvoie {type:'ok'|'perime'|'api_retard',
   * bloquant, titre, message}. */
  function verdictVersion(execute, deploye, api) {
    var ok = { type: 'ok', bloquant: false, titre: null, message: null };
    if (api && api.gardeVersionActive === false) return ok;               // interrupteur
    var be = entier(execute && execute.build), bd = entier(deploye && deploye.build);
    if (be !== null && bd !== null && bd > be) {                          // onglet perime
      return { type: 'perime', bloquant: true, titre: TITRE_PERIME, message: MSG_REFUS_PERIME };
    }
    var exige = entier(execute && execute.apiContractMin), servi = entier(api && api.apiContract);
    if (exige !== null && servi !== null && servi < exige) {              // API en retard
      return { type: 'api_retard', bloquant: true, titre: TITRE_API, message: MSG_REFUS_API };
    }
    return ok;
  }

  /* Bandeau : '' si rien ; sinon div MARQUEE (data-version-perime / data-version-api),
   * distincte du reste, libelle + message. Le bouton Recharger n'apparait que sur perime. */
  function bandeauHTML(v) {
    if (!v || v.type === 'ok' || !v.bloquant) return '';
    var perime = v.type === 'perime';
    var marker = perime ? 'data-version-perime' : 'data-version-api';
    var fond = perime ? '#b91c1c' : '#b45309';
    var bouton = perime ? ' <button type="button" onclick="location.reload()" style="margin-left:10px;background:#fff;color:#b91c1c;border:0;border-radius:4px;padding:2px 10px;font-weight:600;cursor:pointer">Recharger</button>' : '';
    return '<div ' + marker + ' role="alert" style="background:' + fond + ';color:#fff;padding:8px 14px;text-align:center;font-size:13px">'
      + '<span style="font-weight:600">' + esc(v.titre) + '</span>' + bouton
      + '<div style="font-size:11px;opacity:.92;margin-top:2px">' + esc(v.message) + '</div></div>';
  }

  /* Badge d'identite, haut-gauche : NEURONES / Marches Publics / build·sha·JJ/MM
   * (depuis version.json execute). Survol (title) = build + commit de l'API. */
  function badgeHTML(execute, api) {
    execute = execute || {}; api = api || {};
    var ligne = 'build ' + esc(execute.build || '—') + ' · ' + esc(execute.commit || '—') + ' · ' + esc(jjmm(execute.buildDate));
    var survol = 'API build ' + esc(api.build || '—') + ' · commit ' + esc(api.commit || '—');
    return '<div class="mp-ident" title="' + survol + '" style="line-height:1.18">'
      + '<div style="font-weight:700;letter-spacing:.5px">NEURONES</div>'
      + '<div style="font-size:12px;color:var(--ink-soft)">Marchés Publics</div>'
      + '<div style="font-size:11px;color:var(--ink-muted);font-family:var(--FM,monospace)">' + ligne + '</div></div>';
  }

  return {
    verdictVersion: verdictVersion,
    bandeauHTML: bandeauHTML,
    badgeHTML: badgeHTML,
    entier: entier,
    TITRE_PERIME: TITRE_PERIME,
    TITRE_API: TITRE_API,
    MSG_REFUS_PERIME: MSG_REFUS_PERIME,
    MSG_REFUS_API: MSG_REFUS_API
  };
}));
