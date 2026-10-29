/* =========================================================================
 * MP - Etat affiche du DCE d'un AO de veille : logique PURE.
 *
 * Chargee par public/index.html (global window.MPDce) et par la gate node
 * (test/dce-statut.test.js via require). Aucun DOM, aucun reseau, le
 * "maintenant" est injecte.
 *
 * Filet du 29/10/2026 : une demande de DCE dont le run ne demarre jamais (PC du
 * runner eteint plus de 24 h, workflow abandonne par GitHub) ou est coupe sans
 * nommer son echec laissait le doc en "queued"/"downloading" : sablier sans fin,
 * relance refusee (99/2026/CM bloque du 28/09 au 29/10). Au-dela de
 * DELAI_SANS_REPONSE_MIN sans reponse, la demande s'affiche INTERROMPUE, avec son
 * motif et sa date, et redevient relancable. Le delai couvre le plus long cas
 * legitime : run de 18 min max, en file derriere la veille et d'autres DCE.
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MPDce = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DELAI_SANS_REPONSE_MIN = 45;
  var EN_COURS = ['queued', 'downloading'];

  function dateLisible(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    return new Date(t).toLocaleString('fr-FR', {
      timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).replace(' ', ' à ').replace(',', '');
  }

  /* -> { etat: 'pret'|'en_cours'|'interrompu'|'echec'|'a_demander', relancable, titre } */
  function etat(r, maintenantMs) {
    var st = (r && r.dce_status) || '';
    if (st === 'ready' && r.dce_url) {
      return { etat: 'pret', relancable: false, titre: 'Telecharger ZIP DCE' };
    }
    if (EN_COURS.indexOf(st) >= 0) {
      var debut = Date.parse(r.dce_started_at);
      var quand = dateLisible(r.dce_started_at);
      if (isNaN(debut)) {
        return { etat: 'interrompu', relancable: true,
          titre: 'Demande de DCE non datee et sans reponse : telechargement interrompu. Cliquer pour relancer' };
      }
      var minutes = Math.floor((maintenantMs - debut) / 60000);
      if (minutes > DELAI_SANS_REPONSE_MIN) {
        return { etat: 'interrompu', relancable: true,
          titre: 'Demande du ' + quand + ' sans reponse depuis plus de ' + DELAI_SANS_REPONSE_MIN +
                 ' min : telechargement interrompu. Cliquer pour relancer' };
      }
      return { etat: 'en_cours', relancable: false, titre: 'DCE en cours de telechargement (demande du ' + quand + ')' };
    }
    if (st === 'failed') {
      return { etat: 'echec', relancable: true,
        titre: 'Echec : ' + (r.dce_error || 'cause non renseignee') + '. Cliquer pour reessayer' };
    }
    return { etat: 'a_demander', relancable: true, titre: 'Telecharger DCE (via le PC du bureau, ~2 min)' };
  }

  return { etat: etat, DELAI_SANS_REPONSE_MIN: DELAI_SANS_REPONSE_MIN };
});
