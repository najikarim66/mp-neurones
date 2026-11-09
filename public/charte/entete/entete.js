/* entete.js — AIDE FACULTATIVE pour l'en-tête commun (charte NEURONES). ES5, aucune dépendance, aucune logique métier :
   remplir l'identité (appli, build, commit, date) depuis version.json, montrer ou cacher une garde, ouvrir le menu du téléphone.
   La DÉCISION d'afficher une garde appartient à l'application (sa garde de version) : ici, seulement le rendu. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChartNeurones = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function texte(doc, attribut, valeur) {
    var el = doc.querySelector('[' + attribut + ']');
    if (el) el.textContent = valeur == null || valeur === '' ? '—' : String(valeur);
  }
  function jjmm(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (m[3] + '/' + m[2]) : ''; }
  /* identite : { appli, version: {build, commit, buildDate}, api: {build, commit} } — tout est facultatif. */
  function remplirIdentite(doc, identite) {
    identite = identite || {};
    if (identite.appli) texte(doc, 'data-charte-appli', identite.appli);
    var v = identite.version;
    if (v) {
      var build = v.build && v.build !== 'dev' ? v.build : null, commit = v.commit && v.commit !== 'dev' ? v.commit : null;
      texte(doc, 'data-charte-build', build || 'local');
      texte(doc, 'data-charte-commit', commit);
      texte(doc, 'data-charte-date', jjmm(v.buildDate));
      var ligne = doc.querySelector('[data-charte-build-ligne]');
      if (ligne) ligne.title = (v.buildDate ? 'Front build ' + (build || '?') + ' · ' + (commit || '?') + ' · ' + v.buildDate : 'Front : build local (non déployé)')
        + (identite.api ? '\nAPI build ' + (identite.api.build || '?') + ' · ' + (identite.api.commit || '?') : '');
    }
  }
  /* lireVersion : GET sans cache, puis rappel (null si illisible — une version illisible ne conclut jamais). */
  function lireVersion(url, rappel) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), true);
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        var v = null; try { v = x.status === 200 ? JSON.parse(x.responseText) : null; } catch (e) { v = null; }
        rappel(v);
      };
      x.send();
    } catch (e) { rappel(null); }
  }
  /* garde : type 'jaune' | 'rouge' | null (rien) ; titre et message remplacent le texte par défaut s'ils sont donnés. */
  function garde(doc, type, titre, message) {
    var gardes = doc.querySelectorAll('[data-charte-garde]');
    for (var i = 0; i < gardes.length; i++) {
      var g = gardes[i], mien = g.getAttribute('data-charte-garde') === type;
      if (mien) {
        if (titre) { var t = g.querySelector('.charte-garde__titre'); if (t) t.textContent = titre; }
        if (message) { var m = g.querySelector('.charte-garde__message'); if (m) m.textContent = message; }
        g.removeAttribute('hidden');
      } else g.setAttribute('hidden', '');
    }
  }
  function brancherMenuMobile(doc) {
    var barre = doc.querySelector('[data-charte-barre]'), ouvrir = doc.querySelector('[data-charte-ouvrir]'), fermer = doc.querySelector('[data-charte-fermer]');
    if (!barre) return;
    var voile = null;
    function clore() { barre.className = barre.className.replace(/\s*charte-barre--ouverte/g, ''); if (voile && voile.parentNode) voile.parentNode.removeChild(voile); voile = null; }
    function montrer() { barre.className += ' charte-barre--ouverte'; voile = doc.createElement('div'); voile.className = 'charte-voile'; voile.setAttribute('aria-hidden', 'true'); voile.onclick = clore; doc.body.appendChild(voile); }
    if (ouvrir) ouvrir.onclick = montrer;
    if (fermer) fermer.onclick = clore;
  }
  return { remplirIdentite: remplirIdentite, lireVersion: lireVersion, garde: garde, brancherMenuMobile: brancherMenuMobile, jjmm: jjmm };
}));
