/* =========================================================================
 * MP - Echeances de depot d'offres : SOURCE UNIQUE du calcul du temps restant.
 *
 * Charge par public/index.html (global window.MPEch) ET par la gate Node
 * (test/echeances.test.js via require) : une seule implementation, testee telle
 * qu'elle est livree. Aucune dependance au DOM ici.
 *
 * OU tourne le calcul : 100% cote NAVIGATEUR. L'API Azure ne fait aucun calcul
 * de date d'echeance ; le scraper ne stocke que des chaines "heure legale
 * marocaine". "Maintenant" = Date.now() (instant absolu, independant du fuseau).
 * Seule etape sensible au fuseau : convertir l'heure legale marocaine d'une
 * echeance en instant absolu -> connaitre l'offset Casablanca a cette date.
 *
 * Le tzdata PERIME de l'hote Azure n'intervient donc pas au runtime (pas de
 * calcul serveur). Reste le tzdata du poste utilisateur. Pour ne pas faire
 * confiance aveuglement a un fuseau nomme, l'offset est resolu dans cet ordre :
 *   1) MP_TZ_OVERRIDES : transitions qu'on AFFIRME nous-memes (explicites) ;
 *   2) Intl 'Africa/Casablanca' : tzdata du poste (faillible) ;
 *   3) filet : +60 min (heure standard marocaine, hors Ramadan).
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MPEch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Transitions d'offset affirmees explicitement. Chaque entree :
   *   { fromUTC: <instant UTC ms>, offsetMin: <minutes a l'est de UTC apres cet instant> }
   * VIDE par defaut : on ne code EN DUR aucune date non confirmee (un override
   * faux serait exactement le piege "fuseau perime cru juste"). A remplir apres
   * confirmation de l'equipe (ex. bascule GMT du 20/09 : instant + sens exacts). */
  var MP_TZ_OVERRIDES = [];

  function offsetViaOverrides(utcMs) {
    var best = null;
    for (var i = 0; i < MP_TZ_OVERRIDES.length; i++) {
      var o = MP_TZ_OVERRIDES[i];
      if (utcMs >= o.fromUTC && (best === null || o.fromUTC > best.fromUTC)) best = o;
    }
    return best ? best.offsetMin : null;
  }

  function offsetViaIntl(utcMs) {
    try {
      var dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Casablanca', timeZoneName: 'longOffset', hour12: false, year: 'numeric'
      });
      var parts = dtf.formatToParts(new Date(utcMs));
      var tzn = null;
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'timeZoneName') tzn = parts[i].value;
      if (!tzn) return null;
      var m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(tzn);
      if (!m) return /GMT/.test(tzn) ? 0 : null; // "GMT" seul = +00:00
      var sign = m[1] === '-' ? -1 : 1;
      return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
    } catch (e) { return null; }
  }

  /* Offset Casablanca (minutes) pour une DATE calendaire. On sonde a midi :
   * l'offset est constant sur une journee sauf a l'instant de transition, et
   * midi est loin de toute heure de bascule. */
  function offsetForCasaDate(y, mo, d) {
    var noon = Date.UTC(y, mo - 1, d, 12, 0, 0);
    var ov = offsetViaOverrides(noon);
    if (ov !== null) return ov;
    var intl = offsetViaIntl(noon);
    if (intl !== null) return intl;
    return 60;
  }

  /* Offset Casablanca pour un INSTANT (utilise pour situer "maintenant"). */
  function offsetForCasaInstant(utcMs) {
    var ov = offsetViaOverrides(utcMs);
    if (ov !== null) return ov;
    var intl = offsetViaIntl(utcMs);
    if (intl !== null) return intl;
    return 60;
  }

  /* Composantes de l'heure legale Casablanca a un instant donne. */
  function casaComponents(utcMs) {
    var off = offsetForCasaInstant(utcMs);
    var d = new Date(utcMs + off * 60000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
             hh: d.getUTCHours(), mm: d.getUTCMinutes(), off: off };
  }

  /* Parse "JJ/MM/AAAA" et "JJ/MM/AAAA HH:MM" (heure collee toleree), plus une
   * heure separee optionnelle qui prime. Heure absente -> 23:59 + estimee=true.
   * On n'INVENTE jamais une heure : 23:59 est une BORNE, signalee comme estimee. */
  function parseParts(dateStr, heureStr) {
    if (!dateStr && dateStr !== 0) return null;
    var s = String(dateStr).trim();
    var mDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})[:hH](\d{2}))?/.exec(s);
    if (!mDate) {
      // tolere aussi l'ISO "AAAA-MM-JJ" (avec heure optionnelle)
      var mIso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
      if (!mIso) return null;
      mDate = [null, mIso[3], mIso[2], mIso[1], mIso[4], mIso[5]];
    }
    var d = +mDate[1], mo = +mDate[2], y = +mDate[3];
    var hh = null, mm = null;
    if (mDate[4] != null && mDate[4] !== '') { hh = +mDate[4]; mm = +mDate[5]; }
    if (heureStr) {
      var mh = /(\d{1,2})[:hH](\d{2})/.exec(String(heureStr));
      if (mh) { hh = +mh[1]; mm = +mh[2]; }
    }
    var estimee = false;
    if (hh == null) { hh = 23; mm = 59; estimee = true; }
    if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 &&
          hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
    return { y: y, mo: mo, d: d, hh: hh, mm: mm, estimee: estimee };
  }

  /* Echeance -> instant absolu (epoch ms). resolver(y,mo,d)->minutes injectable. */
  function echeanceEpoch(dateStr, heureStr, resolver) {
    var p = parseParts(dateStr, heureStr);
    if (!p) return null;
    var off = (resolver || offsetForCasaDate)(p.y, p.mo, p.d);
    var epoch = Date.UTC(p.y, p.mo - 1, p.d, p.hh, p.mm) - off * 60000;
    return { epoch: epoch, estimee: p.estimee, offsetMin: off, parts: p };
  }

  /* Difference pure entre deux instants absolus. jours/heures/minutes = duree. */
  function tempsRestant(epoch, nowMs) {
    var ms = epoch - nowMs;
    var abs = Math.abs(ms);
    var totalMin = Math.floor(abs / 60000);
    return {
      ms: ms, passe: ms < 0,
      jours: Math.floor(totalMin / 1440),
      heures: Math.floor((totalMin % 1440) / 60),
      minutes: totalMin % 60
    };
  }

  /* Jours CALENDAIRES restants (heure Casablanca). 0 = aujourd'hui, <0 = passe.
   * Sert aux filtres d'urgence (J-3/J-7/...) : granularite jour, pas ms. */
  function joursRestantsCal(ec, nowMs) {
    var nowC = casaComponents(nowMs);
    var startNow = Date.UTC(nowC.y, nowC.mo - 1, nowC.d) - nowC.off * 60000;
    var startDl = Date.UTC(ec.parts.y, ec.parts.mo - 1, ec.parts.d) - ec.offsetMin * 60000;
    return Math.round((startDl - startNow) / 86400000);
  }

  function joursRestants(dateStr, heureStr, opts) {
    opts = opts || {};
    var ec = echeanceEpoch(dateStr, heureStr, opts.offsetResolver);
    if (!ec) return null;
    var nowMs = (opts.nowMs != null) ? opts.nowMs : Date.now();
    return joursRestantsCal(ec, nowMs);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fdatFR(p) { return pad2(p.d) + '/' + pad2(p.mo) + '/' + p.y; }

  /* Duree lisible et courte : "2 j 3 h", "3 h", "45 min". */
  function dureeCourte(tr) {
    if (tr.jours >= 1) return tr.jours + ' j' + (tr.heures ? ' ' + tr.heures + ' h' : '');
    if (tr.heures >= 1) return tr.heures + ' h' + (tr.minutes ? ' ' + tr.minutes + ' min' : '');
    return Math.max(tr.minutes, 0) + ' min';
  }

  /* Coeur d'affichage : dit la verite a la minute pres, ne declare "depassee"
   * que quand l'instant reel est franchi, ne chiffre jamais une heure estimee.
   * Retourne aussi sortRank (0 = estimee & encore ouverte -> tout en haut). */
  function libelleEcheance(dateStr, heureStr, opts) {
    opts = opts || {};
    var nowMs = (opts.nowMs != null) ? opts.nowMs : Date.now();
    var resolver = opts.offsetResolver;
    var ec = echeanceEpoch(dateStr, heureStr, resolver);
    if (!ec) {
      return { text: '-', urgence: 'inconnu', estimee: false, valide: false,
               passe: false, jours: null, transitionWarn: false, sortRank: 2 };
    }
    var tr = tempsRestant(ec.epoch, nowMs);
    var joursCal = joursRestantsCal(ec, nowMs);
    var nowC = casaComponents(nowMs);
    var offNow = (resolver || offsetForCasaDate)(nowC.y, nowC.mo, nowC.d);
    var transitionWarn = (offNow !== ec.offsetMin) && !tr.passe && joursCal <= 14;

    var text, urgence;
    if (tr.passe) {
      urgence = 'passe';
      if (joursCal === 0) {
        text = ec.estimee ? ('echeance du jour depassee (' + fdatFR(ec.parts) + ')')
                          : ('depassee depuis ' + dureeCourte(tr));
      } else {
        text = 'depassee le ' + fdatFR(ec.parts);
      }
    } else if (joursCal === 0) {
      urgence = 'aujourdhui';
      text = ec.estimee
        ? "echeance aujourd'hui - heure a confirmer sur le portail"
        : "echeance aujourd'hui - encore " + dureeCourte(tr);
    } else {
      urgence = joursCal <= 3 ? 'imminent' : (joursCal <= 7 ? 'proche' : 'lointain');
      text = 'J-' + joursCal + (ec.estimee ? ' - heure a confirmer' : '');
    }

    return {
      text: text, urgence: urgence, estimee: ec.estimee, valide: true,
      passe: tr.passe, jours: joursCal, heures: tr.heures, minutes: tr.minutes,
      transitionWarn: transitionWarn, epoch: ec.epoch, offsetMin: ec.offsetMin,
      dateFR: fdatFR(ec.parts),
      /* Priorite de tri : une echeance a heure ESTIMEE encore OUVERTE remonte
       * en tete (a verifier avant de rater le depot). Passe / heure connue = 1. */
      sortRank: (ec.estimee && !tr.passe) ? 0 : 1
    };
  }

  return {
    MP_TZ_OVERRIDES: MP_TZ_OVERRIDES,
    offsetForCasaDate: offsetForCasaDate,
    offsetForCasaInstant: offsetForCasaInstant,
    casaComponents: casaComponents,
    parseParts: parseParts,
    echeanceEpoch: echeanceEpoch,
    tempsRestant: tempsRestant,
    joursRestants: joursRestants,
    libelleEcheance: libelleEcheance,
    dureeCourte: dureeCourte,
    fdatFR: fdatFR
  };
});
