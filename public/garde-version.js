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
  /* CHARTE NEURONES (05/11/2026) : la garde de version commune — rouge (onglet perime, ecritures suspendues) ou jaune (API en
   * retard) — rendue par les classes de public/charte/entete/entete.css ; aucune couleur en dur, 12 px minimum. Marqueurs et
   * libelles inchanges (gate test/garde-version.test.js). */
  function bandeauHTML(v) {
    if (!v || v.type === 'ok' || !v.bloquant) return '';
    var perime = v.type === 'perime';
    var marker = perime ? 'data-version-perime' : 'data-version-api';
    var classe = perime ? 'charte-garde charte-garde--rouge' : 'charte-garde charte-garde--jaune';
    var bouton = perime ? ' <button type="button" class="charte-garde__bouton" onclick="location.reload()">Recharger</button>' : '';
    return '<div ' + marker + ' role="alert" class="' + classe + '">'
      + '<div class="charte-garde__titre">' + esc(v.titre) + bouton + '</div>'
      + '<div class="charte-garde__message">' + esc(v.message) + '</div></div>';
  }

  /* En-tete COMMUN (charte NEURONES), haut-gauche : logo officiel sur fond blanc, « NEURONES · Marchés Publics », puis
   * « build N · sha · JJ/MM » (version.json execute). Survol de la ligne de build = build + commit de l'API. */
  function badgeHTML(execute, api) {
    execute = execute || {}; api = api || {};
    var ligne = 'build ' + esc(execute.build || '—') + ' · ' + esc(execute.commit || '—') + ' · ' + esc(jjmm(execute.buildDate));
    var survol = 'API build ' + esc(api.build || '—') + ' · commit ' + esc(api.commit || '—');
    return '<div class="mp-ident" title="' + survol + '">'
      + '<a class="charte-logo" href="/" aria-label="NEURONES — tableau de bord"><img src="charte/logo-neurones.png" alt="NEURONES Technologies" width="87" height="80"></a>'
      + '<div class="charte-identite">NEURONES · <span class="charte-identite__appli">Marchés Publics</span></div>'
      + '<div class="charte-build" title="' + survol + '">' + ligne + '</div></div>';
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
