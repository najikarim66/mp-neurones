/* =========================================================================
 * MP - Registre des cautions : logique PURE de la fusion collection + provisoires.
 *
 * Chargé par public/index.html (global window.MPCaution) ET par la gate node
 * (test/cautions.test.js via require) : une seule implémentation, testée telle
 * qu'elle est livrée. Aucune dépendance au DOM.
 *
 * Modèle : une provisoire (portée par un AO, a.caution_prov) est une caution au
 * même titre qu'une définitive/RG (collection mp_cautions). Cycle (règle DG 20/11/2026) :
 * active -> [mainlevee_demandee : demandée au maître d'ouvrage] -> piece_recue (mainlevée du
 * client OU original restitué, scan + date) -> demande_deposee (demande déposée à la banque)
 * -> liberee (accusé de la banque joint). "Encore bloquée à la banque" = tout état avant
 * liberee/restituee : l'argent ne revient qu'avec l'accusé. Les agrégats se calculent sur
 * l'ensemble FILTRÉ. L'ancien statut « mainlevee_recue » se lit comme piece_recue.
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MPCaution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY = 86400000;
  var DELAI_ALERTE_BANQUE_DEFAUT = 15; // jours après le dépôt : au-delà, la banque continue à prélever ses commissions

  /* Champs du cycle transportés tels quels (pièces, dates, demande banque) : l'écran offre « voir la
   * pièce » (jamais le blob nu) et les blocs banque lisent demande_banque / piece_liberation. */
  var CHAMPS_CYCLE = ['acte', 'mainlevee_client', 'original_caution', 'accuse_banque', 'decharge_banque', 'lettre_mainlevee',
    'piece_liberation', 'demande_banque', 'date_mainlevee_recue', 'date_original_recu', 'date_liberation', 'date_decharge',
    'date_lettre', 'date_demande_mainlevee', 'derniere_vue_banque'];
  function _copierCycle(src, out) {
    CHAMPS_CYCLE.forEach(function (k) { out[k] = (src && src[k] !== undefined) ? src[k] : null; });
    return out;
  }

  /* Etat du cycle, l'ancien « mainlevee_recue » normalisé. */
  function etatCycle(c) { var s = c && c.statut; return s === 'mainlevee_recue' ? 'piece_recue' : s; }

  /* Liste unifiée. gm(marche_id) -> {ref,titre,objet,maitre_ouvrage} (injecté ; en app = le résolveur
   * marché de index.html, en test = un stub). */
  function unify(cautions, aos, gm) {
    gm = gm || function () { return { ref: '', titre: '' }; };
    var col = (cautions || []).map(function (c) {
      var m = gm(c.marche_id) || {};
      return _copierCycle(c, { src: 'col', id: c.id, num: c.num, referenceBanque: c.referenceBanque || null, type: c.type, banque: c.banque || '',
        montant: +c.montant || 0, date_emission: c.date_emission || null, statut: c.statut,
        ref: m.ref || '', titre: m.titre || '', objet: m.objet || m.titre || '', maitre_ouvrage: m.maitre_ouvrage || '', marche_id: c.marche_id });
    });
    var prov = (aos || []).filter(function (a) { return a.caution_prov; }).map(function (a) {
      var p = a.caution_prov;
      return _copierCycle(p, { src: 'ao', _aoId: a.id, id: 'prov_' + a.id, num: p.num || '', referenceBanque: p.referenceBanque || null, type: 'provisoire',
        banque: p.banque || '', montant: +p.montant || 0, date_emission: p.date_emission || null,
        statut: p.statut || '', ref: a.ref || '', titre: a.objet || '', objet: a.objet || '', maitre_ouvrage: a.maitre_ouvrage || '', aoStatut: a.statut || '', marche_id: null });
    });
    return col.concat(prov);
  }

  /* Encore bloquée à la banque = argent pas encore revenu : tout état du cycle avant l'accusé. */
  function isBlocked(c) {
    var e = etatCycle(c);
    return e === 'active' || e === 'mainlevee_demandee' || e === 'piece_recue' || e === 'demande_deposee';
  }

  function applyFilters(rows, f) {
    f = f || {};
    var out = rows;
    if (f.search) {
      var q = String(f.search).toLowerCase();
      out = out.filter(function (c) {
        // La recherche trouve la reference banque complete autant que l'alias abrege.
        return [c.num, c.referenceBanque, c.banque, c.ref].some(function (x) { return (x || '').toLowerCase().indexOf(q) >= 0; });
      });
    }
    if (f.statut) out = out.filter(function (c) { return etatCycle(c) === f.statut; });
    if (f.type)   out = out.filter(function (c) { return c.type === f.type; });
    if (f.banque) out = out.filter(function (c) { return c.banque === f.banque; });
    return out;
  }

  /* Agrégats de l'ensemble reçu (déjà filtré par l'appelant). kpi.mainlevee = demandée au client,
   * kpi.recue = pièce reçue (à demander à la banque), kpi.banque = demande déposée (en attente). */
  function aggregate(rows) {
    var engage = 0, byBank = {}, kpi = { active: 0, mainlevee: 0, recue: 0, banque: 0, expiree: 0, liberee: 0 };
    rows.forEach(function (c) {
      var e = etatCycle(c);
      if (e === 'active') kpi.active++;
      else if (e === 'mainlevee_demandee') kpi.mainlevee++;
      else if (e === 'piece_recue') kpi.recue++;
      else if (e === 'demande_deposee') kpi.banque++;
      else if (e === 'expiree') kpi.expiree++;
      else if (e === 'liberee' || e === 'restituee') kpi.liberee++;
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

  /* "À restituer" = argent immobilisé dont la pièce du client n'est PAS encore là : toute caution
   * en mainlevee_demandee (demandée au maître d'ouvrage) + toute provisoire encore active sur un AO
   * déjà décidé (dormante). Les cautions dont la pièce est reçue ou la demande déposée ont leurs
   * propres blocs (aDemanderBanque, enAttenteBanque). Reçoit la liste unifiée. */
  function aRestituer(rows) {
    var items = rows.filter(function (c) {
      var e = etatCycle(c);
      if (e === 'mainlevee_demandee') return true;
      if (c.src === 'ao' && _decidee(c.aoStatut) && e === 'active') return true;
      return false;
    });
    var total = items.reduce(function (s, c) { return s + c.montant; }, 0);
    return { items: items, total: total };
  }

  function _parBanque(items) {
    var map = {}, ordre = [];
    items.forEach(function (c) {
      var b = c.banque || 'banque non renseignée';
      if (!map[b]) { map[b] = { banque: b, items: [], total: 0 }; ordre.push(b); }
      map[b].items.push(c); map[b].total += c.montant;
    });
    return ordre.sort().map(function (b) { return map[b]; });
  }

  /* Bloc « À demander à la banque » : pièce reçue, demande non déposée. Groupé par banque (une lettre
   * = une banque). Reçoit la liste unifiée. */
  function aDemanderBanque(rows) {
    var items = rows.filter(function (c) { return etatCycle(c) === 'piece_recue'; });
    return { items: items, total: items.reduce(function (s, c) { return s + c.montant; }, 0), parBanque: _parBanque(items) };
  }

  /* Bloc « En attente de la banque » : demande déposée, accusé absent. Jours écoulés depuis le dépôt
   * (nowMs injecté) ; alerte au-delà du délai paramétrable (défaut 15 jours). Tri : plus ancien d'abord. */
  function enAttenteBanque(rows, nowMs, delaiJours) {
    var delai = (delaiJours != null && isFinite(+delaiJours) && +delaiJours > 0) ? +delaiJours : DELAI_ALERTE_BANQUE_DEFAUT;
    var items = rows.filter(function (c) { return etatCycle(c) === 'demande_deposee'; }).map(function (c) {
      var d = c.demande_banque && c.demande_banque.date_depot, t = d ? new Date(d).getTime() : NaN;
      var jours = isNaN(t) ? null : Math.floor((nowMs - t) / DAY);
      var out = {};
      Object.keys(c).forEach(function (k) { out[k] = c[k]; });
      out.jours = jours; out.alerte = jours != null && jours >= delai; out.date_depot_absente = (jours == null);
      return out;
    }).sort(function (a, b) { return (b.jours == null ? -1 : b.jours) - (a.jours == null ? -1 : a.jours); });
    return { items: items, total: items.reduce(function (s, c) { return s + c.montant; }, 0), nbAlerte: items.filter(function (c) { return c.alerte; }).length, delai: delai };
  }

  return { DELAI_ALERTE_BANQUE_DEFAUT: DELAI_ALERTE_BANQUE_DEFAUT, etatCycle: etatCycle, unify: unify, isBlocked: isBlocked, applyFilters: applyFilters, aggregate: aggregate, aRestituer: aRestituer, aDemanderBanque: aDemanderBanque, enAttenteBanque: enAttenteBanque };
});
