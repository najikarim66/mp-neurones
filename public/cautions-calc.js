/* =========================================================================
 * MP - Registre des cautions : logique PURE de la fusion collection + provisoires.
 *
 * Chargé par public/index.html (global window.MPCaution) ET par la gate node
 * (test/cautions.test.js via require) : une seule implémentation, testée telle
 * qu'elle est livrée. Aucune dépendance au DOM.
 *
 * Modèle : une provisoire (portée par un AO, a.caution_prov) est une caution au
 * même titre qu'une définitive/RG (collection mp_cautions). "Encore bloquée à la
 * banque" = statut active OU mainlevee_demandee (l'argent n'est revenu qu'une fois
 * liberee/restituee). Les agrégats se calculent sur l'ensemble FILTRÉ.
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MPCaution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Liste unifiée. gm(marche_id) -> {ref,titre} (injecté ; en app = le résolveur
   * marché de index.html, en test = un stub). */
  function unify(cautions, aos, gm) {
    gm = gm || function () { return { ref: '', titre: '' }; };
    var col = (cautions || []).map(function (c) {
      var m = gm(c.marche_id) || {};
      return { src: 'col', id: c.id, num: c.num, type: c.type, banque: c.banque || '',
        montant: +c.montant || 0, date_emission: c.date_emission || null, statut: c.statut,
        ref: m.ref || '', titre: m.titre || '', marche_id: c.marche_id };
    });
    var prov = (aos || []).filter(function (a) { return a.caution_prov; }).map(function (a) {
      var p = a.caution_prov;
      return { src: 'ao', _aoId: a.id, id: 'prov_' + a.id, num: p.num || '', type: 'provisoire',
        banque: p.banque || '', montant: +p.montant || 0, date_emission: p.date_emission || null,
        statut: p.statut || '', ref: a.ref || '', aoStatut: a.statut || '' };
    });
    return col.concat(prov);
  }

  /* Encore bloquée à la banque = argent pas encore revenu. */
  function isBlocked(c) { return c.statut === 'active' || c.statut === 'mainlevee_demandee'; }

  function applyFilters(rows, f) {
    f = f || {};
    var out = rows;
    if (f.search) {
      var q = String(f.search).toLowerCase();
      out = out.filter(function (c) {
        return [c.num, c.banque, c.ref].some(function (x) { return (x || '').toLowerCase().indexOf(q) >= 0; });
      });
    }
    if (f.statut) out = out.filter(function (c) { return c.statut === f.statut; });
    if (f.type)   out = out.filter(function (c) { return c.type === f.type; });
    if (f.banque) out = out.filter(function (c) { return c.banque === f.banque; });
    return out;
  }

  /* Agrégats de l'ensemble reçu (déjà filtré par l'appelant). */
  function aggregate(rows) {
    var engage = 0, byBank = {}, kpi = { active: 0, mainlevee: 0, expiree: 0, liberee: 0 };
    rows.forEach(function (c) {
      if (c.statut === 'active') kpi.active++;
      else if (c.statut === 'mainlevee_demandee') kpi.mainlevee++;
      else if (c.statut === 'expiree') kpi.expiree++;
      else if (c.statut === 'liberee' || c.statut === 'restituee') kpi.liberee++;
      if (isBlocked(c)) {
        engage += c.montant;
        if (c.banque) {
          byBank[c.banque] = byBank[c.banque] || { eng: 0, nb: 0 };
          byBank[c.banque].eng += c.montant; byBank[c.banque].nb++;
        }
      }
    });
    var banksSorted = Object.keys(byBank).map(function (b) { return [b, byBank[b]]; })
      .sort(function (a, b) { return b[1].eng - a[1].eng; });
    return { engage: engage, byBank: byBank, banksSorted: banksSorted, kpi: kpi };
  }

  function _decidee(aoStatut) {
    return aoStatut === 'attribue' || aoStatut === 'infructueux' || aoStatut === 'annule';
  }

  /* "À restituer" = argent immobilisé à récupérer : toute caution en mainlevee_demandee
   * (définitive OU provisoire) + toute provisoire encore active sur un AO déjà décidé
   * (dormante pas encore demandée). Reçoit la liste unifiée. */
  function aRestituer(rows) {
    var items = rows.filter(function (c) {
      if (c.statut === 'mainlevee_demandee') return true;
      if (c.src === 'ao' && _decidee(c.aoStatut) && c.statut === 'active') return true;
      return false;
    });
    var total = items.reduce(function (s, c) { return s + c.montant; }, 0);
    return { items: items, total: total };
  }

  return { unify: unify, isBlocked: isBlocked, applyFilters: applyFilters, aggregate: aggregate, aRestituer: aRestituer };
});
