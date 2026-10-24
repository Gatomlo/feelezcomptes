(function () {
  "use strict";

  // Chemin de montage de l'app (ex. '/budget-foyer' si une passerelle Node monte
  // plusieurs outils sous des sous-dossiers, '' si servie a la racine). Deduit de
  // l'URL reelle utilisee pour charger ce script (balise <script src="app.js">,
  // volontairement relative) : fonctionne sans configuration a coder en dur.
  var BASE = (function () {
    try {
      var scriptUrl = document.currentScript && document.currentScript.src;
      if (!scriptUrl) return '';
      return new URL('.', scriptUrl).pathname.replace(/\/$/, '');
    } catch (e) { return ''; }
  })();

  var MONTH_ABBREVS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
  var ICONS = [
    '🛒', '🍽️', '☕', '🍕', '🍎', '🚗', '⛽', '🚌', '🚆', '✈️',
    '🏠', '💡', '🔥', '💧', '📶', '📱', '💻', '🎉', '🎬', '🎮',
    '📚', '🎵', '⚽', '🏋️', '👕', '👗', '👟', '💄', '🧴', '💊',
    '🏥', '🦷', '🐾', '🎁', '👶', '🎓', '🧳', '🏖️', '💳', '🏦',
    '📄', '🛡️', '💰', '🧾', '🔧', '🐶', '🌳', '❤️'
  ];
  var DEFAULT_ICON = '🏷️';
  var TAG_COLORS = [
    '#2B5F6B', '#A9711F', '#3E7D4C', '#A23E33', '#6B5B95', '#B5495B', '#4F6D7A', '#8C5E58',
    '#3F6B2F', '#8A4B9E', '#1F7A6C', '#B0562A', '#5A5FA8', '#9E4A6A', '#2E7D8C', '#7A6B1F',
    '#4F8C3E', '#A83E7A', '#2F5F9E', '#8C5F1F', '#6B3E8C', '#3E8C7A', '#9E2F4A', '#5F7A2F'
  ];

  // Couleur d'un budget ou d'un tag : celle choisie manuellement si elle existe,
  // sinon une couleur stable dérivée de l'identifiant. monthKey sert à retrouver
  // un budget éphémère (qui n'existe que dans le mois indiqué).
  function tagColor(id, monthKey) {
    var env = state.recurring.envelopes.find(function (e) { return e.id === id; });
    if (env && env.color) return env.color;
    if (!env) {
      var monthData = state.months[monthKey || selectedMonthKey];
      var eph = monthData && monthData.ephemeralEnvelopes && monthData.ephemeralEnvelopes.find(function (e) { return e.id === id; });
      if (eph && eph.color) return eph.color;
    }
    var tag = state.recurring.tags.find(function (t) { return t.id === id; });
    if (tag && tag.color) return tag.color;
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return TAG_COLORS[h % TAG_COLORS.length];
  }

  // Couleur stable d'un mode de paiement, dérivée de son identifiant (pas de
  // personnalisation manuelle pour ceux-ci, contrairement aux budgets et tags).
  function paymentColor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return TAG_COLORS[(h + 3) % TAG_COLORS.length];
  }

  var state = null;
  var currentUsername = '';
  var isAuthenticated = false;
  var booted = false;

  var uiRestore = restoreUiState();
  var selectedMonthKey = uiRestore.month || currentMonthKey();
  var currentPage = uiRestore.page || 'dashboard';
  var selectedYear = uiRestore.year || new Date().getFullYear();
  var movementGroupBy = uiRestore.groupBy || 'week';
  var statsCols = uiRestore.statsCols || { income: true, budget: true, tags: true, payment: true };
  var editingMovementId = null;
  // Palette de couleurs (budget ou tag) actuellement dépliée, une seule à la fois —
  // vaut 'tag-<id>' ou 'env-<id>', ou null si aucune n'est ouverte. État d'affichage
  // pur, jamais publié.
  var colorGridOpenFor = null;
  // Modale d'icône de budget actuellement ouverte — vaut 'env-<id>' ou 'eph-<id>',
  // ou null. Même logique que colorGridOpenFor : état d'affichage pur.
  var iconModalTarget = null;
  // Formulaire de création d'un nouveau budget : affiché dans une modale plutôt
  // qu'en permanence dans la grille des budgets, pour ne pas alourdir la vue.
  var addEnvelopeModalOpen = false;
  var pendingConfirmAction = null;
  var pendingConfirmMessage = '';
  var pendingConfirmExtra = null;
  var pendingConfirmMainLabel = 'Confirmer';
  // Un seul accordéon ouvert à la fois : si un état restauré en contenait plusieurs
  // (ancienne session), on ne garde que le dernier.
  var restoredAccordions = uiRestore.openAccordions || [];
  var openAccordions = new Set(restoredAccordions.length ? [restoredAccordions[restoredAccordions.length - 1]] : []);
  var loginError = '';
  var accountMessage = '';
  var accountError = false;
  var movementSearchQuery = '';
  var movementTypeFilter = 'all';
  var filterEnvelopeId = null;   // id, 'none' (hors budget) ou null
  var filterTagId = null;        // id, 'none' (sans tag) ou null
  var filterPaymentId = null;    // id, 'none' ou null
  var selectedWeekIdx = null;    // semaine choisie sur l'accueil (null = semaine en cours)
  var budgetDetailId = uiRestore.budgetId || null;
  var showAllBudgets = false;
  var budgetMode = 'week';       // cartes budget de l'accueil : 'week' (reste de la semaine) ou 'month' (reste du mois)
  var infoOpen = {}; // explications dévoilées par les boutons ⓘ (clé → booléen)
  var revealedMovementId = null; // ligne dont les actions Modifier / Supprimer sont visibles
  var openSheet = null;          // id de la feuille (dialog) à rouvrir après un re-rendu
  var statsMonthKey = null;
  var statsBy = 'budget';

  function requestConfirm(message, action, onClose, extra, mainLabel) {
    pendingConfirmMessage = message;
    pendingConfirmAction = action;
    pendingConfirmExtra = extra || null;
    pendingConfirmMainLabel = mainLabel || 'Confirmer';
    var openDlg = document.getElementById('movement-modal');
    if (openDlg && openDlg.open) openDlg.close();
    render();
    var dlg = document.getElementById('confirm-dialog');
    if (dlg) {
      if (onClose) dlg.addEventListener('close', onClose, { once: true });
      dlg.showModal();
    }
  }

  var moneyFmt = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
  var monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

  function defaultState() {
    return { recurring: { incomes: [], fixedExpenses: [], envelopes: [], tags: [], paymentMethods: [] }, months: {}, settings: { weekStartDay: 1, defaultPaymentMethodId: null } };
  }

  function migrateState(st) {
    Object.keys(st.months || {}).forEach(function (key) {
      var m = st.months[key];
      if (!m.movements) {
        var movements = [];
        (m.extraIncomes || []).forEach(function (i) { movements.push({ id: i.id, date: key + '-01', type: 'income', label: i.name, amount: i.amount, envelopeId: null, tagId: null }); });
        (m.extraFixedExpenses || []).forEach(function (f) { movements.push({ id: f.id, date: key + '-01', type: 'expense', label: f.name, amount: f.amount, envelopeId: null, tagId: null }); });
        (m.expenses || []).forEach(function (e) { movements.push({ id: e.id, date: key + '-' + String((e.week || 0) * 7 + 1).padStart(2, '0'), type: 'expense', label: e.label, amount: e.amount, envelopeId: e.envId, tagId: null }); });
        m.movements = movements;
        delete m.extraIncomes; delete m.extraFixedExpenses; delete m.expenses;
      }
      m.movements.forEach(function (mv) {
        if (mv.tagId === undefined) mv.tagId = null;
        if (mv.paymentMethodId === undefined) mv.paymentMethodId = null;
      });
      if (!m.envelopeAmounts) m.envelopeAmounts = {};
      if (!m.envelopeWeeks) m.envelopeWeeks = {};
      if (!m.fixedPaid) m.fixedPaid = {};
      if (!m.ephemeralEnvelopes) m.ephemeralEnvelopes = [];
      if (!m.incomeAmounts) m.incomeAmounts = {};
      if (!m.fixedAmounts) m.fixedAmounts = {};
      if (!m.removedIncomes) m.removedIncomes = [];
      if (!m.removedFixed) m.removedFixed = [];
      if (!m.removedEnvelopes) m.removedEnvelopes = [];
    });
    (st.recurring.envelopes || []).forEach(function (env) {
      if (!env.icon) env.icon = DEFAULT_ICON;
      if (env.startMonth === undefined) env.startMonth = null;
      if (env.endMonth === undefined) env.endMonth = null;
    });
    (st.recurring.incomes || []).forEach(function (i) { if (i.startMonth === undefined) i.startMonth = null; if (i.endMonth === undefined) i.endMonth = null; });
    (st.recurring.fixedExpenses || []).forEach(function (f) { if (f.startMonth === undefined) f.startMonth = null; if (f.endMonth === undefined) f.endMonth = null; });
    if (!st.recurring.tags) st.recurring.tags = [];
    if (!st.recurring.paymentMethods) st.recurring.paymentMethods = [];
    if (!st.settings) st.settings = { weekStartDay: 1 };
    if (st.settings.weekStartDay == null) st.settings.weekStartDay = 1;
    if (st.settings.defaultPaymentMethodId === undefined) st.settings.defaultPaymentMethodId = null;
    delete st.settings.auth; // l'authentification vit désormais côté serveur, jamais dans cet état.
    return st;
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n) {
    var v = Math.round((n || 0) * 100) / 100;
    return moneyFmt.format(v);
  }

  function movementMatchesQuery(m, q) {
    if (m.label && m.label.toLowerCase().indexOf(q) !== -1) return true;
    if (String(m.amount).indexOf(q) !== -1) return true;
    if (fmt(m.amount).toLowerCase().indexOf(q) !== -1) return true;
    return false;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function monthKeyAdd(key, delta) {
    var parts = key.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1);
  }

  function monthLabel(key) {
    var parts = key.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, 1));
    var s = monthFmt.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatDateShort(d) {
    if (!d || d.length < 10) return '';
    return d.slice(8, 10) + '/' + d.slice(5, 7);
  }

  function daysInMonth(key) {
    var parts = key.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
  }

  // Numéro de semaine calendaire (lundi-dimanche), indépendant du changement d'année.
  // Jour de départ de semaine configurable (0=dimanche … 6=samedi, 1=lundi par défaut).
  function weekStartDay() {
    return (state.settings && state.settings.weekStartDay != null) ? state.settings.weekStartDay : 1;
  }

  function weekStartIndex(dateUTC) {
    var REF = Date.UTC(1970, 0, 4 + weekStartDay()); // 1970-01-04 est un dimanche
    return Math.floor((dateUTC.getTime() - REF) / 86400000 / 7);
  }

  function weekStartDateOfIndex(w) {
    return new Date(w * 7 * 86400000 + Date.UTC(1970, 0, 4 + weekStartDay()));
  }

  // Semaines de 7 jours pleines (démarrant au jour configuré) attribuées à ce mois :
  // une semaine à cheval sur deux mois est comptée entièrement dans celui où elle a
  // le plus de jours (jamais coupée en deux). Donne toujours 4 ou 5 semaines, jamais plus.
  function monthWeeks(key) {
    var parts = key.split('-').map(Number);
    var totalDays = daysInMonth(key);
    var monthStartMs = Date.UTC(parts[0], parts[1] - 1, 1);
    var monthEndMs = Date.UTC(parts[0], parts[1] - 1, totalDays);
    var firstWeek = weekStartIndex(new Date(monthStartMs));
    var lastWeek = weekStartIndex(new Date(monthEndMs));
    var weeks = [];
    for (var w = firstWeek; w <= lastWeek; w++) {
      var weekStartMs = weekStartDateOfIndex(w).getTime();
      var count = 0;
      for (var i = 0; i < 7; i++) {
        var dayMs = weekStartMs + i * 86400000;
        if (dayMs >= monthStartMs && dayMs <= monthEndMs) count++;
      }
      if (count >= 4) weeks.push(w);
    }
    return weeks;
  }

  function isISODate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // Mois budgétaire d'une date : celui auquel sa semaine pleine est attribuée (même
  // règle que monthWeeks — le mois où la semaine a au moins 4 jours, donc celui de son
  // 4e jour). Ex. avec des semaines du samedi au vendredi : le 01/10 appartient à la
  // dernière semaine de septembre, le 03/10 à la première d'octobre.
  function budgetMonthKeyForDate(dateStr) {
    var parts = dateStr.split('-').map(Number);
    var start = weekStartDateOfIndex(weekStartIndex(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))));
    var mid = new Date(start.getTime() + 3 * 86400000);
    return mid.getUTCFullYear() + '-' + pad2(mid.getUTCMonth() + 1);
  }

  // Mois dans lequel un mouvement est affiché et compté : celui de sa date (mois
  // budgétaire), quel que soit le mois affiché au moment de sa saisie (storedKey).
  // Exception : un mouvement rattaché à un budget ponctuel reste dans le mois de ce
  // budget, qui n'existe nulle part ailleurs.
  function movementMonthKey(st, mv, storedKey) {
    if (!isISODate(mv.date)) return storedKey;
    var eph = (st.months[storedKey] && st.months[storedKey].ephemeralEnvelopes) || [];
    if (mv.envelopeId && eph.some(function (e) { return e.id === mv.envelopeId; })) return storedKey;
    return budgetMonthKeyForDate(mv.date);
  }

  function findMovementMonthKey(id) {
    return Object.keys(state.months).find(function (k) {
      return (state.months[k].movements || []).some(function (mv) { return mv.id === id; });
    }) || null;
  }

  // Attribue une date à sa semaine calendaire pleine dans ce mois. Une date dont la
  // semaine appartient majoritairement au mois voisin (ex. le 31 dans une semaine à
  // cheval sur le mois suivant) est absorbée par la tranche la plus proche. Si
  // weeksCount a été réduit manuellement, l'excédent est absorbé par la dernière tranche.
  function weekIndexForDate(dateStr, monthKey, weeksCount) {
    var parts = (isISODate(dateStr) ? dateStr : monthKey + '-01').split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    var w = weekStartIndex(d);
    var weeks = monthWeeks(monthKey);
    var idx = weeks.indexOf(w);
    if (idx === -1) idx = (weeks.length && w < weeks[0]) ? 0 : weeks.length - 1;
    return Math.min(weeksCount - 1, Math.max(0, idx));
  }

  // Libellé de la semaine idx (peut chevaucher le mois voisin dans son libellé).
  function weekRangeLabel(monthKey, idx) {
    var weeks = monthWeeks(monthKey);
    var w = idx < weeks.length ? weeks[idx] : weeks[weeks.length - 1] + (idx - weeks.length + 1);
    var start = weekStartDateOfIndex(w);
    var end = new Date(start.getTime() + 6 * 86400000);
    return pad2(start.getUTCDate()) + '/' + pad2(start.getUTCMonth() + 1) + '-' + pad2(end.getUTCDate()) + '/' + pad2(end.getUTCMonth() + 1);
  }

  function autoSplit(amount, n) {
    n = Math.max(1, n | 0);
    var base = Math.round((amount / n) * 100) / 100;
    var arr = new Array(n).fill(base);
    var sumSoFar = Math.round(base * (n - 1) * 100) / 100;
    arr[n - 1] = Math.round((amount - sumSoFar) * 100) / 100;
    return arr;
  }

  function ensureMonth(key) {
    if (!state.months[key]) {
      // Pas de weeksCount ici : il est calculé automatiquement à partir du vrai
      // calendrier (4, 5 ou 6 semaines) tant que l'utilisateur ne le force pas
      // explicitement via « Semaines ce mois-ci ».
      state.months[key] = { envelopeAmounts: {}, envelopeWeeks: {}, fixedPaid: {}, movements: [], ephemeralEnvelopes: [], incomeAmounts: {}, fixedAmounts: {}, removedIncomes: [], removedFixed: [], removedEnvelopes: [] };
    }
    return state.months[key];
  }

  // Un revenu ou une dépense fixe n'existe que dans les mois compris entre son
  // démarrage et sa fin (bornes optionnelles) : ainsi, en arrêter un ou en ajouter
  // un nouveau n'affecte jamais rétroactivement les mois déjà passés.
  function isActiveInMonth(item, monthKey) {
    if (item.startMonth && monthKey < item.startMonth) return false;
    if (item.endMonth && monthKey >= item.endMonth) return false;
    return true;
  }

  function computeMonthView(st, key, cache) {
    if (cache[key]) return cache[key];
    var carry = 0;
    var monthData = st.months[key] || {};
    var weeksCount = monthData.weeksCount || monthWeeks(key).length;
    var monthMovements = [];
    Object.keys(st.months).forEach(function (k) {
      (st.months[k].movements || []).forEach(function (m) {
        if (movementMonthKey(st, m, k) === key) monthMovements.push(m);
      });
    });
    var movements = monthMovements.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return 0;
    }).map(function (m) {
      return Object.assign({}, m, { weekIndex: weekIndexForDate(m.date, key, weeksCount) });
    });

    var incomeLines = st.recurring.incomes.filter(function (i) {
      return isActiveInMonth(i, key) && (monthData.removedIncomes || []).indexOf(i.id) === -1;
    }).map(function (i) {
      var amount = (monthData.incomeAmounts && monthData.incomeAmounts[i.id] != null) ? monthData.incomeAmounts[i.id] : i.amount;
      return { id: i.id, name: i.name, amount: amount };
    });
    var recurringIncomeTotal = incomeLines.reduce(function (s, i) { return s + i.amount; }, 0);
    // Un revenu rattaché à un budget est un remboursement qui recrédite ce budget (voir
    // computeEnvelopeView) : il réduit la dépense nette plutôt que de s'ajouter au revenu
    // du mois. Seuls les revenus sans budget comptent comme du revenu réel disponible.
    var movementIncomes = movements.filter(function (m) { return m.type === 'income'; });
    var envelopeTiedIncomeTotal = movementIncomes.filter(function (m) { return m.envelopeId; }).reduce(function (s, m) { return s + m.amount; }, 0);
    var movementIncomeTotal = movementIncomes.filter(function (m) { return !m.envelopeId; }).reduce(function (s, m) { return s + m.amount; }, 0);
    var totalIncome = recurringIncomeTotal + movementIncomeTotal;
    var available = carry + totalIncome;

    var fixedLines = st.recurring.fixedExpenses.filter(function (f) {
      return isActiveInMonth(f, key) && (monthData.removedFixed || []).indexOf(f.id) === -1;
    }).map(function (f) {
      var amount = (monthData.fixedAmounts && monthData.fixedAmounts[f.id] != null) ? monthData.fixedAmounts[f.id] : f.amount;
      var paid = !!(monthData.fixedPaid && monthData.fixedPaid[f.id]);
      return { id: f.id, name: f.name, amount: amount, paid: paid };
    });
    var recurringFixedTotal = fixedLines.filter(function (f) { return f.paid; }).reduce(function (s, f) { return s + f.amount; }, 0);
    var recurringFixedDue = fixedLines.reduce(function (s, f) { return s + f.amount; }, 0);
    var movementExpenses = movements.filter(function (m) { return m.type === 'expense'; });
    var movementExpenseTotal = movementExpenses.reduce(function (s, m) { return s + m.amount; }, 0);
    var totalOutflow = recurringFixedTotal + movementExpenseTotal - envelopeTiedIncomeTotal;

    function computeEnvelopeView(env, isEphemeral) {
      var amount = (!isEphemeral && monthData.envelopeAmounts && monthData.envelopeAmounts[env.id] != null) ? monthData.envelopeAmounts[env.id] : env.amount;
      var weeks = (monthData.envelopeWeeks && monthData.envelopeWeeks[env.id]) || null;
      if (!weeks || weeks.length !== weeksCount) weeks = autoSplit(amount, weeksCount);
      // Les revenus liés à ce budget (ex: remboursement) le recréditent au lieu de le
      // débiter, d'où le filtre sur tous les mouvements (pas seulement les dépenses).
      var envMovements = movements.filter(function (m) { return m.envelopeId === env.id; });
      var spentByWeek = weeks.map(function (_, idx) {
        return envMovements.filter(function (m) { return m.weekIndex === idx; })
          .reduce(function (s, m) { return s + (m.type === 'income' ? -m.amount : m.amount); }, 0);
      });
      // Un dépassement sur une semaine grève le budget de la semaine suivante (report du
      // seul déficit, jamais du surplus) : effectiveWeeks est le budget réellement
      // disponible chaque semaine une fois ce report appliqué (weeks reste la valeur
      // brute éditable par l'utilisateur).
      var effectiveWeeks = weeks.slice();
      var carryDeficit = 0;
      for (var wIdx = 0; wIdx < effectiveWeeks.length; wIdx++) {
        effectiveWeeks[wIdx] = effectiveWeeks[wIdx] - carryDeficit;
        var weekOverage = spentByWeek[wIdx] - effectiveWeeks[wIdx];
        carryDeficit = weekOverage > 0 ? weekOverage : 0;
      }
      var spentTotal = spentByWeek.reduce(function (a, b) { return a + b; }, 0);
      return { id: env.id, name: env.name, icon: env.icon || DEFAULT_ICON, amount: amount, weeksCount: weeksCount, weeks: weeks, effectiveWeeks: effectiveWeeks, movements: envMovements, spentByWeek: spentByWeek, spentTotal: spentTotal, remaining: amount - spentTotal, ephemeral: !!isEphemeral };
    }
    var envelopes = st.recurring.envelopes.filter(function (env) {
      return isActiveInMonth(env, key) && (monthData.removedEnvelopes || []).indexOf(env.id) === -1;
    }).map(function (env) { return computeEnvelopeView(env, false); })
      .concat((monthData.ephemeralEnvelopes || []).map(function (env) { return computeEnvelopeView(env, true); }));
    var totalEnvelopeBudget = envelopes.reduce(function (s, e) { return s + e.amount; }, 0);
    var totalEnvelopeSpent = envelopes.reduce(function (s, e) { return s + e.spentTotal; }, 0);
    var plannedRemaining = available - recurringFixedTotal - totalEnvelopeBudget;
    var endingBalance = available - totalOutflow;

    var view = {
      key: key, carry: carry, incomeLines: incomeLines, recurringIncomeTotal: recurringIncomeTotal, movementIncomeTotal: movementIncomeTotal, totalIncome: totalIncome, available: available,
      recurringFixedTotal: recurringFixedTotal, recurringFixedDue: recurringFixedDue, fixedLines: fixedLines, movementExpenseTotal: movementExpenseTotal, totalOutflow: totalOutflow,
      weeksCount: weeksCount, envelopes: envelopes, totalEnvelopeBudget: totalEnvelopeBudget, totalEnvelopeSpent: totalEnvelopeSpent,
      plannedRemaining: plannedRemaining, endingBalance: endingBalance, movements: movements
    };
    cache[key] = view;
    return view;
  }

  // --- mutations ---
  // Un revenu ou une dépense fixe n'est jamais supprimé rétroactivement : l'arrêter
  // fixe seulement le mois à partir duquel il ne compte plus, les mois précédents
  // gardent leur calcul intact (même logique que pour le montant mensuel des budgets).
  function addIncome(name, amount, startMonth) { state.recurring.incomes.push({ id: uid('inc'), name: name, amount: amount, startMonth: startMonth || null, endMonth: null }); }
  function endIncome(key, id) { var it = state.recurring.incomes.find(function (i) { return i.id === id; }); if (it) it.endMonth = key; }
  // Retire ce revenu uniquement pour ce mois précis (les autres mois, passés comme
  // futurs, continuent de le compter normalement) — alternative à endIncome, qui lui
  // l'arrête définitivement à partir de ce mois.
  function removeIncomeThisMonth(key, id) {
    var m = ensureMonth(key);
    if (!m.removedIncomes) m.removedIncomes = [];
    if (m.removedIncomes.indexOf(id) === -1) m.removedIncomes.push(id);
  }
  function setMonthIncomeAmount(key, incomeId, amount) { var m = ensureMonth(key); m.incomeAmounts[incomeId] = amount; }

  function addFixed(name, amount, startMonth) { state.recurring.fixedExpenses.push({ id: uid('fix'), name: name, amount: amount, startMonth: startMonth || null, endMonth: null }); }
  function endFixed(key, id) { var it = state.recurring.fixedExpenses.find(function (f) { return f.id === id; }); if (it) it.endMonth = key; }
  function removeFixedThisMonth(key, id) {
    var m = ensureMonth(key);
    if (!m.removedFixed) m.removedFixed = [];
    if (m.removedFixed.indexOf(id) === -1) m.removedFixed.push(id);
  }
  function setMonthFixedAmount(key, fixedId, amount) { var m = ensureMonth(key); m.fixedAmounts[fixedId] = amount; }
  function toggleFixedPaid(key, fixedId) {
    var m = ensureMonth(key);
    if (m.fixedPaid[fixedId]) delete m.fixedPaid[fixedId]; else m.fixedPaid[fixedId] = true;
  }

  function addEnvelope(name, amount, icon) { state.recurring.envelopes.push({ id: uid('env'), name: name, amount: amount, icon: icon || DEFAULT_ICON, startMonth: null, endMonth: null }); }
  // Arrête ce budget à partir de ce mois (les mois passés restent inchangés) —
  // même logique que endIncome/endFixed.
  function endEnvelope(key, id) { var it = state.recurring.envelopes.find(function (e) { return e.id === id; }); if (it) it.endMonth = key; }
  // Retire ce budget uniquement pour ce mois précis — alternative à endEnvelope.
  function removeEnvelopeThisMonth(key, id) {
    var m = ensureMonth(key);
    if (!m.removedEnvelopes) m.removedEnvelopes = [];
    if (m.removedEnvelopes.indexOf(id) === -1) m.removedEnvelopes.push(id);
  }
  function setEnvelopeIcon(id, icon) { var it = state.recurring.envelopes.find(function (e) { return e.id === id; }); if (it) it.icon = icon; }
  function renameEnvelope(id, name) { var it = state.recurring.envelopes.find(function (e) { return e.id === id; }); if (it) it.name = name; }
  function setEnvelopeColor(id, color) { var it = state.recurring.envelopes.find(function (e) { return e.id === id; }); if (it) it.color = color; }

  // Budgets éphémères : n'existent que pour un seul mois, jamais dans state.recurring.
  function addEphemeralEnvelope(key, name, amount, icon) {
    var m = ensureMonth(key);
    if (!m.ephemeralEnvelopes) m.ephemeralEnvelopes = [];
    m.ephemeralEnvelopes.push({ id: uid('eph'), name: name, amount: amount, icon: icon || DEFAULT_ICON });
  }
  function removeEphemeralEnvelope(key, id) {
    var m = state.months[key];
    if (!m) return;
    m.ephemeralEnvelopes = (m.ephemeralEnvelopes || []).filter(function (e) { return e.id !== id; });
    delete m.envelopeWeeks[id];
    m.movements = m.movements.filter(function (mv) { return mv.envelopeId !== id; });
  }
  function renameEphemeralEnvelope(key, id, name) {
    var m = state.months[key];
    var it = m && (m.ephemeralEnvelopes || []).find(function (e) { return e.id === id; });
    if (it) it.name = name;
  }
  function setEphemeralEnvelopeAmount(key, id, amount) {
    var m = state.months[key];
    var it = m && (m.ephemeralEnvelopes || []).find(function (e) { return e.id === id; });
    if (it) it.amount = amount;
    if (m) delete m.envelopeWeeks[id];
  }
  function setEphemeralEnvelopeIcon(key, id, icon) {
    var m = state.months[key];
    var it = m && (m.ephemeralEnvelopes || []).find(function (e) { return e.id === id; });
    if (it) it.icon = icon;
  }
  function setEphemeralEnvelopeColor(key, id, color) {
    var m = state.months[key];
    var it = m && (m.ephemeralEnvelopes || []).find(function (e) { return e.id === id; });
    if (it) it.color = color;
  }

  function addTag(name) { var id = uid('tag'); state.recurring.tags.push({ id: id, name: name }); return id; }
  function renameTag(id, name) { var it = state.recurring.tags.find(function (t) { return t.id === id; }); if (it) it.name = name; }
  function setTagColor(id, color) { var it = state.recurring.tags.find(function (t) { return t.id === id; }); if (it) it.color = color; }
  function removeTag(id) {
    state.recurring.tags = state.recurring.tags.filter(function (t) { return t.id !== id; });
    Object.keys(state.months).forEach(function (k) {
      state.months[k].movements.forEach(function (mv) { if (mv.tagId === id) mv.tagId = null; });
    });
  }

  function addPaymentMethod(name, icon) { state.recurring.paymentMethods.push({ id: uid('pay'), name: name, icon: icon || DEFAULT_ICON }); }
  function renamePaymentMethod(id, name) { var it = state.recurring.paymentMethods.find(function (p) { return p.id === id; }); if (it) it.name = name; }
  function setPaymentMethodIcon(id, icon) { var it = state.recurring.paymentMethods.find(function (p) { return p.id === id; }); if (it) it.icon = icon; }
  function setDefaultPaymentMethod(id) { state.settings.defaultPaymentMethodId = id || null; }
  function removePaymentMethod(id) {
    state.recurring.paymentMethods = state.recurring.paymentMethods.filter(function (p) { return p.id !== id; });
    if (state.settings.defaultPaymentMethodId === id) state.settings.defaultPaymentMethodId = null;
    Object.keys(state.months).forEach(function (k) {
      state.months[k].movements.forEach(function (mv) { if (mv.paymentMethodId === id) mv.paymentMethodId = null; });
    });
  }

  function setMonthEnvelopeAmount(key, envId, amount) {
    var m = ensureMonth(key);
    m.envelopeAmounts[envId] = amount;
    delete m.envelopeWeeks[envId];
  }

  // Nombre de semaines effectif d'un mois (forcé manuellement, ou calculé sur le calendrier réel).
  function monthWeeksCountFor(key) {
    var m = state.months[key];
    return (m && m.weeksCount) || monthWeeks(key).length;
  }

  // Mois qui suivent fromKey (sur les 12 mois suivants, qu'ils existent déjà ou non
  // dans l'état) et comptent le même nombre de semaines — cibles valables pour
  // répercuter une modification de budget. Un mois pas encore visité est créé à la
  // volée si l'utilisateur confirme la répercussion (voir setMonthEnvelopeAmount).
  function futureMonthsWithSameWeeks(fromKey) {
    var fromCount = monthWeeksCountFor(fromKey);
    var results = [];
    for (var i = 1; i <= 12; i++) {
      var k = monthKeyAdd(fromKey, i);
      if (monthWeeksCountFor(k) === fromCount) results.push(k);
    }
    return results;
  }

  // Les 12 mois suivants, sans condition (contrairement aux budgets, un revenu ou
  // une dépense fixe n'a pas de découpage hebdomadaire à faire correspondre).
  function futureMonths(fromKey) {
    var results = [];
    for (var i = 1; i <= 12; i++) results.push(monthKeyAdd(fromKey, i));
    return results;
  }

  function setWeeksCount(key, n) {
    var m = ensureMonth(key);
    m.weeksCount = Math.max(1, Math.min(5, Math.round(n)));
    m.envelopeWeeks = {};
  }

  function setWeekStartDay(day) {
    state.settings.weekStartDay = Math.max(0, Math.min(6, Math.round(day)));
  }

  // Le budget du mois reste corrélé aux semaines : modifier une semaine met à jour
  // le total du mois (somme des semaines), tout comme modifier le total du mois
  // recalcule déjà les semaines (autoSplit).
  function setEnvelopeWeekAmount(key, envId, weekIdx, amount, isEphemeral) {
    var m = ensureMonth(key);
    var view = computeMonthView(state, key, {});
    var env = view.envelopes.find(function (e) { return e.id === envId; });
    var weeks = env ? env.weeks.slice() : [];
    weeks[weekIdx] = amount;
    m.envelopeWeeks[envId] = weeks;
    var total = weeks.reduce(function (a, b) { return a + b; }, 0);
    if (isEphemeral) {
      var eph = (m.ephemeralEnvelopes || []).find(function (e) { return e.id === envId; });
      if (eph) eph.amount = total;
    } else {
      m.envelopeAmounts[envId] = total;
    }
  }

  function addMovement(key, date, type, label, amount, envelopeId, tagId, paymentMethodId) {
    var m = ensureMonth(key);
    m.movements.push({ id: uid('mv'), date: date || todayISO(), type: type === 'income' ? 'income' : 'expense', label: label, amount: amount, envelopeId: envelopeId || null, tagId: tagId || null, paymentMethodId: paymentMethodId || null });
  }
  function updateMovement(key, id, date, type, label, amount, envelopeId, tagId, paymentMethodId) {
    // Le mouvement peut être stocké dans un autre mois que celui affiché (voir movementMonthKey).
    var storedKey = findMovementMonthKey(id);
    var m = state.months[storedKey];
    var mv = m && m.movements.find(function (x) { return x.id === id; });
    if (!mv) return;
    // Re-range le mouvement dans le mois affiché, dont viennent les budgets proposés
    // dans le formulaire (un budget ponctuel n'existe que dans ce mois-là).
    if (storedKey !== key) {
      m.movements = m.movements.filter(function (x) { return x.id !== id; });
      ensureMonth(key).movements.push(mv);
    }
    mv.date = date || todayISO();
    mv.type = type === 'income' ? 'income' : 'expense';
    mv.label = label;
    mv.amount = amount;
    mv.envelopeId = envelopeId || null;
    mv.tagId = tagId || null;
    mv.paymentMethodId = paymentMethodId || null;
  }
  function removeMovement(key, id) {
    var m = state.months[findMovementMonthKey(id) || key];
    if (m) m.movements = m.movements.filter(function (mv) { return mv.id !== id; });
  }

  function mutate(fn) {
    fn();
    commit();
  }

  function navigateMonth(delta) {
    editingMovementId = null;
    selectedWeekIdx = null;
    revealedMovementId = null;
    selectedMonthKey = monthKeyAdd(selectedMonthKey, delta);
    render();
  }

  function navigatePage(page) {
    editingMovementId = null;
    revealedMovementId = null;
    currentPage = page;
    render();
    window.scrollTo(0, 0);
  }

  function navigateYear(delta) {
    selectedYear += delta;
    render();
  }

  // --- persistence côté client (préférences d'affichage seulement) ---
  function stashUi() {
    try { sessionStorage.setItem('fee-lezcomptes-ui', JSON.stringify({ month: selectedMonthKey, page: currentPage, year: selectedYear, groupBy: movementGroupBy, statsCols: statsCols, openAccordions: Array.from(openAccordions), budgetId: budgetDetailId })); } catch (e) {}
  }
  function restoreUiState() {
    try {
      var raw = sessionStorage.getItem('fee-lezcomptes-ui');
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) { return {}; }
  }

  var toastAction = null;
  function showToast(msg, actionLabel, actionFn) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button type="button" class="toast-btn">' + esc(actionLabel) + '</button>' : '');
    toastAction = actionFn || null;
    t.hidden = false;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; toastAction = null; }, actionLabel ? 5000 : 3500);
  }
  document.getElementById('toast').addEventListener('click', function (e) {
    if (!e.target.closest('.toast-btn') || !toastAction) return;
    var fn = toastAction;
    toastAction = null;
    this.hidden = true;
    fn();
  });

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach(function (el) { el.classList.remove('field-error'); });
  }
  function markFieldError(form, fieldName) {
    var el = form.querySelector('[name="' + fieldName + '"]');
    if (el) el.classList.add('field-error');
    return el;
  }

  function commit() {
    render();
    stashUi();
    saveState();
  }

  // --- API serveur ---
  function apiFetch(url, options) {
    options = options || {};
    options.credentials = 'same-origin';
    if (options.body && typeof options.body !== 'string') {
      options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      options.body = JSON.stringify(options.body);
    }
    return fetch(BASE + url, options);
  }

  // --- Synchronisation et hors-ligne ---
  // L'état vit d'abord sur l'appareil (localStorage) : chaque modification y est
  // écrite tout de suite puis envoyée au serveur dès que possible. Le serveur numérote
  // ses versions ; si quelqu'un a modifié le budget entre-temps (409), on fusionne à
  // trois (dernier état serveur connu / local / serveur actuel) puis on renvoie.
  var STORE_KEY = 'fee-lezcomptes-data';
  var baseState = null;   // dernier état reçu du serveur : ancêtre commun de la fusion
  var baseVersion = null;
  var dirty = false;      // modifications locales pas encore acceptées par le serveur
  var online = true;      // serveur joignable au dernier essai
  var syncing = false;
  var syncAgain = false;
  var retryTimer = null;
  var renderDeferred = false;

  function persistLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ state: state, base: baseState, version: baseVersion, dirty: dirty, user: currentUsername })); } catch (e) {}
  }
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch (e) { return null; }
  }
  function clearLocal() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isPlainObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function idList(arr) { return arr.every(function (x) { return isPlainObj(x) && typeof x.id === 'string'; }); }
  function scalarList(arr) { return arr.every(function (x) { return x === null || typeof x !== 'object'; }); }

  // Fusion à trois (undefined = absent). Ce qui n'a changé que d'un côté est repris ;
  // listes d'objets à `id` fusionnées élément par élément, listes simples comme des
  // ensembles ; vrai conflit : l'appareil l'emporte, et une modification l'emporte
  // sur une suppression.
  function merge3(base, mine, theirs) {
    if (sameJson(mine, theirs)) return mine;
    if (sameJson(mine, base)) return theirs;
    if (sameJson(theirs, base)) return mine;
    if (isPlainObj(mine) && isPlainObj(theirs)) {
      var bo = isPlainObj(base) ? base : {};
      var out = {};
      Object.keys(Object.assign({}, bo, theirs, mine)).forEach(function (k) {
        var v = merge3(bo[k], mine[k], theirs[k]);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    if (Array.isArray(mine) && Array.isArray(theirs)) {
      var ba = Array.isArray(base) ? base : [];
      if (idList(mine) && idList(theirs) && idList(ba)) {
        var index = function (arr) { var m = {}; arr.forEach(function (x) { m[x.id] = x; }); return m; };
        var bm = index(ba), mm = index(mine), tm = index(theirs);
        var ids = theirs.map(function (x) { return x.id; });
        mine.forEach(function (x) { if (!tm[x.id]) ids.push(x.id); });
        var res = [];
        ids.forEach(function (id) { var v = merge3(bm[id], mm[id], tm[id]); if (v !== undefined) res.push(v); });
        return res;
      }
      if (scalarList(mine) && scalarList(theirs) && scalarList(ba)) {
        var kept = theirs.filter(function (x) { return !(ba.indexOf(x) !== -1 && mine.indexOf(x) === -1); });
        mine.forEach(function (x) { if (ba.indexOf(x) === -1 && kept.indexOf(x) === -1) kept.push(x); });
        return kept;
      }
    }
    if (mine === undefined) return theirs;
    return mine;
  }

  // Ne pas redessiner sous une fenêtre ouverte (saisie en cours) : on attend sa fermeture.
  function safeRender() {
    if (document.querySelector('#app dialog[open]')) { renderDeferred = true; return; }
    render();
  }

  function updateSyncStatus() {
    var el = document.getElementById('sync-chip');
    if (!el) return;
    var cls = 'ok', txt = 'À jour';
    if (!online) { cls = 'off'; txt = dirty ? 'Hors ligne · en attente' : 'Hors ligne'; }
    else if (dirty || syncing) { cls = 'busy'; txt = 'Envoi…'; }
    el.className = 'sync-chip ' + cls;
    el.innerHTML = '<span class="sync-dot"></span>' + txt;
    el.setAttribute('aria-label', 'Synchronisation : ' + txt + ' (toucher pour synchroniser)');
  }
  function setOnline(v) {
    if (online === v) return;
    online = v;
    updateSyncStatus();
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { if (dirty) syncNow(); else pullState(); }, 15000);
  }

  // Reçoit un état serveur : fusionne avec les modifications locales éventuelles.
  function receiveRemote(remote, version) {
    remote = migrateState(remote || defaultState());
    state = (dirty && state) ? merge3(baseState, state, remote) : clone(remote);
    baseState = clone(remote);
    baseVersion = version;
    persistLocal();
  }
  function versionOf(r) {
    var v = r.headers.get('X-State-Version');
    return v != null && /^\d+$/.test(v) ? Number(v) : null;
  }
  function handleUnauthorized() {
    // Session expirée : on garde la copie locale (et ses modifications) pour après la reconnexion.
    isAuthenticated = false;
    updateSyncStatus();
    render();
  }

  function saveState() {
    dirty = true;
    persistLocal();
    updateSyncStatus();
    syncNow();
  }

  function syncNow() {
    if (!dirty || !isAuthenticated) return;
    if (baseVersion == null) { pullState(); return; }
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    var sent = clone(state);
    var hadOfflineChanges = !online;
    apiFetch('/api/state', { method: 'PUT', body: sent, headers: { 'X-Base-Version': String(baseVersion) } }).then(function (r) {
      if (r.status === 401) { handleUnauthorized(); return; }
      if (r.status === 409) {
        setOnline(true);
        return r.json().then(function (body) {
          receiveRemote(body.state, versionOf(r));
          syncAgain = true;
          safeRender();
        });
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().then(function (body) {
        baseState = sent;
        baseVersion = body.version;
        dirty = !sameJson(state, sent);
        persistLocal();
        setOnline(true);
        if (hadOfflineChanges && !dirty) showToast('Modifications synchronisées avec le serveur.');
      });
    }).catch(function () {
      setOnline(false);
      scheduleRetry();
    }).finally(function () {
      syncing = false;
      updateSyncStatus();
      if (syncAgain) { syncAgain = false; syncNow(); }
    });
  }

  function pullState() {
    if (!isAuthenticated || syncing) return Promise.resolve();
    if (dirty && baseVersion != null) { syncNow(); return Promise.resolve(); }
    return apiFetch('/api/state', { cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { handleUnauthorized(); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var v = versionOf(r);
      return r.json().then(function (remote) {
        setOnline(true);
        if (state && v != null && v === baseVersion && !dirty) return;
        var first = !state;
        receiveRemote(remote, v);
        if (first) render(); else safeRender();
        if (dirty) syncNow();
      });
    }).catch(function () {
      setOnline(false);
      scheduleRetry();
    }).finally(updateSyncStatus);
  }

  var POLL_MS = 20000;
  var pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () { if (!document.hidden) pullState(); }, POLL_MS);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && isAuthenticated) pullState(); });
  window.addEventListener('focus', function () { if (isAuthenticated) pullState(); });
  window.addEventListener('online', function () { if (isAuthenticated) { if (dirty) syncNow(); else pullState(); } });
  window.addEventListener('offline', function () { setOnline(false); });

  function boot() {
    var saved = readLocal();
    if (saved && saved.state) {
      state = migrateState(saved.state);
      baseState = saved.base || null;
      baseVersion = saved.version == null ? null : saved.version;
      dirty = !!saved.dirty;
      currentUsername = saved.user || '';
    }
    apiFetch('/api/session', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (sess) {
      setOnline(true);
      isAuthenticated = !!sess.authenticated;
      if (sess.username) currentUsername = sess.username;
      booted = true;
      if (!isAuthenticated) { render(); return; }
      if (state) { render(); handleLaunchAction(); }
      startPolling();
      return pullState().then(handleLaunchAction);
    }).catch(function () {
      // Pas de réseau : on ouvre la copie gardée sur l'appareil.
      online = false;
      booted = true;
      isAuthenticated = !!state;
      render();
      updateSyncStatus();
      if (state) { handleLaunchAction(); startPolling(); }
      scheduleRetry();
    });
  }

  // Après connexion : récupère l'état (en fusionnant d'éventuelles modifications locales).
  function loadStateAndRender() {
    booted = true;
    render();
    startPolling();
    return pullState().then(handleLaunchAction);
  }

  // Raccourci de l'icône installée (appui long → « Nouveau mouvement ») : ?action=nouveau-mouvement
  function handleLaunchAction() {
    var params = new URLSearchParams(location.search);
    if (params.get('action') !== 'nouveau-mouvement' || !state || !isAuthenticated) return;
    history.replaceState(null, '', location.pathname + location.hash);
    currentPage = 'dashboard';
    selectedMonthKey = budgetMonthKeyForDate(todayISO());
    editingMovementId = null;
    render();
    var dlg = document.getElementById('movement-modal');
    if (dlg && !dlg.open) dlg.showModal();
  }

  // --- rendering ---
  // ===================== Rendu (interface mobile d'abord) =====================
  // Tout l'affichage est reconstruit en chaîne HTML puis injecté dans #app. Les
  // « feuilles » (ajout de mouvement, filtres, vue, sélecteur) sont des <dialog>
  // ouverts par le bas ; openSheet mémorise celle à rouvrir après un re-rendu.
  var SVG = {
    chevL: '<path d="M15 18l-6-6 6-6"/>', chevR: '<path d="M9 18l6-6-6-6"/>', chevD: '<path d="M6 9l6 6 6-6"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    bill: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    edit: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    dot: '<circle cx="12" cy="12" r="4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
  };
  function svg(name, size, cls) {
    var s = size || 20;
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVG[name] + '</svg>';
  }

  var renderingNow = false;
  var lastRenderedPage = null;
  function render() {
    var app = document.getElementById('app');
    if (!booted) {
      app.innerHTML = '<div class="loading-shell"><img class="loading-logo" src="' + BASE + '/logo.svg" alt="">Chargement…</div>';
      return;
    }
    if (!isAuthenticated) {
      app.innerHTML = renderLoginScreen();
      return;
    }
    if (!state) {
      app.innerHTML = '<div class="loading-shell"><img class="loading-logo" src="' + BASE + '/logo.svg" alt="">Pas de connexion au serveur.<br>Le budget s’affichera dès que le réseau revient.</div>';
      return;
    }
    renderDeferred = false;
    if (currentPage === 'budget' && !budgetDetailId) currentPage = 'dashboard';
    var focus = captureFocus();
    var view = computeMonthView(state, selectedMonthKey, {});
    renderingNow = true;
    app.innerHTML = renderApp(view);
    renderingNow = false;
    if (openSheet) {
      var d = document.getElementById(openSheet);
      if (d && !d.open) { d.classList.add('instant'); d.showModal(); } else if (!d) openSheet = null;
    }
    restoreFocus(focus);
    updateSyncStatus();
    stashUi();
  }
  function captureFocus() {
    var el = document.activeElement;
    if (!el || !el.dataset || !el.dataset.focusKey) return null;
    return { key: el.dataset.focusKey, start: el.selectionStart, end: el.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f) return;
    var el = document.querySelector('[data-focus-key="' + f.key + '"]');
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(f.start, f.end); } catch (e) {}
  }
  function openDialog(id) {
    var d = document.getElementById(id);
    if (!d) return;
    openSheet = id;
    d.classList.remove('instant');
    if (!d.open) d.showModal();
  }
  function closeDialog(id) {
    var d = document.getElementById(id);
    if (openSheet === id) openSheet = null;
    if (d && d.open) d.close();
  }

  function renderLoginScreen() {
    return '<div class="login-shell"><form class="login-card" data-form="login">' +
      '<img class="login-logo" src="' + BASE + '/logo.svg" alt="">' +
      '<h1 class="login-title">Fée Lezcomptes</h1>' +
      '<p class="login-sub">Le budget du foyer</p>' +
      (loginError ? '<p class="login-error">' + esc(loginError) + '</p>' : '') +
      '<label>Identifiant<input type="text" name="username" required autocomplete="username"></label>' +
      '<label>Mot de passe<input type="password" name="password" required autocomplete="current-password"></label>' +
      '<label class="login-remember"><input type="checkbox" name="remember" checked> Rester connecté sur cet appareil</label>' +
      '<button type="submit" class="btn-primary big">Se connecter</button>' +
      '</form></div>';
  }

  function renderConfirmDialog() {
    return '<dialog class="modal" id="confirm-dialog">' +
      '<div class="modal-form">' +
        '<h3 class="card-title">Confirmation</h3>' +
        '<p class="empty-note">' + esc(pendingConfirmMessage) + '</p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" data-action="confirm-no">Non</button>' +
          (pendingConfirmExtra ? '<button type="button" class="btn-secondary" data-action="confirm-extra">' + esc(pendingConfirmExtra.label) + '</button>' : '') +
          '<button type="button" class="btn-danger" data-action="confirm-yes">' + esc(pendingConfirmMainLabel) + '</button>' +
        '</div>' +
      '</div>' +
    '</dialog>';
  }

  function stat(icon, label, value, tone) {
    return '<div class="stat-tile' + (tone ? ' stat-' + tone : '') + '"><span class="stat-label"><span class="stat-icon">' + icon + '</span>' + label + '</span><span class="stat-value">' + fmt(value) + '</span></div>';
  }

  // --- Aides communes ---
  function shortMonthLabel(key) {
    var p = key.split('-').map(Number);
    return MONTH_ABBREVS[p[1] - 1] + ' ' + p[0];
  }
  function isoOf(dateUTC) { return dateUTC.getUTCFullYear() + '-' + pad2(dateUTC.getUTCMonth() + 1) + '-' + pad2(dateUTC.getUTCDate()); }
  function currentWeekIndex(view) {
    var t = todayISO();
    return selectedMonthKey === budgetMonthKeyForDate(t) ? weekIndexForDate(t, selectedMonthKey, view.weeksCount) : -1;
  }
  function activeWeek(view) {
    var w = selectedWeekIdx;
    if (w == null || w >= view.weeksCount) {
      var c = currentWeekIndex(view);
      w = c >= 0 ? c : 0;
    }
    return w;
  }
  function monthStatusLabel(key) {
    var weeks = monthWeeks(key);
    if (!weeks.length) return '';
    var start = weekStartDateOfIndex(weeks[0]).getTime();
    var end = weekStartDateOfIndex(weeks[weeks.length - 1]).getTime() + 6 * 86400000;
    var p = todayISO().split('-').map(Number);
    var t = Date.UTC(p[0], p[1] - 1, p[2]);
    if (t > end) return 'Mois terminé';
    if (t < start) return 'À venir';
    var n = Math.round((end - t) / 86400000) + 1;
    return n + (n > 1 ? ' jours restants' : ' jour restant');
  }
  function moveCtx(view) {
    var ctx = { envById: {}, tagById: {}, payById: {} };
    view.envelopes.forEach(function (e) { ctx.envById[e.id] = e; });
    state.recurring.tags.forEach(function (t) { ctx.tagById[t.id] = t; });
    state.recurring.paymentMethods.forEach(function (p) { ctx.payById[p.id] = p; });
    return ctx;
  }
  function signedTotal(moves) { return moves.reduce(function (s, m) { return s + (m.type === 'income' ? m.amount : -m.amount); }, 0); }
  function fmtShort(n) { return fmt(n).replace(/,00(?=\s| | |€)/, ''); }
  function signedFmt(n) { return (n > 0 ? '+' : '') + fmt(n); }
  function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : (a > 0 ? 100 : 0); }

  function renderApp(view) {
    var page = currentPage;
    var body = page === 'settings' ? renderSettingsPage(state, view, selectedMonthKey)
      : page === 'stats' ? renderStatsPage(state, selectedYear)
      : page === 'fixed' ? renderFixedPage(view)
      : page === 'movements' ? renderMovementsPage(view)
      : page === 'budget' ? renderBudgetPage(view)
      : renderHomePage(view);
    var animate = page !== lastRenderedPage;
    lastRenderedPage = page;
    return '<div class="shell">' +
      renderTopBar() +
      '<main class="page' + (animate ? ' page-in' : '') + '">' + body + '</main>' +
      renderNav(view) +
      '</div>' +
      renderMovementSheet(view) +
      '<dialog class="sheet tall" id="picker-sheet" aria-label="Choisir"><div class="sheet-body" id="picker-body"></div></dialog>' +
      (page === 'movements' ? renderFilterSheet(view) + renderViewSheet() : '') +
      renderConfirmDialog() +
      renderInstallDialog();
  }

  function renderTopBar() {
    var isStats = currentPage === 'stats';
    var pill = '<div class="month-pill">' +
      '<button type="button" class="round-btn" data-action="' + (isStats ? 'prev-year' : 'prev-month') + '" aria-label="' + (isStats ? 'Année précédente' : 'Mois précédent') + '">' + svg('chevL', 18) + '</button>' +
      '<span class="month-pill-label">' + (isStats ? 'Année ' + selectedYear : shortMonthLabel(selectedMonthKey)) + '</span>' +
      '<button type="button" class="round-btn" data-action="' + (isStats ? 'next-year' : 'next-month') + '" aria-label="' + (isStats ? 'Année suivante' : 'Mois suivant') + '">' + svg('chevR', 18) + '</button>' +
      '</div>';
    return '<header class="topbar">' + pill +
      '<div class="topbar-right">' +
        '<button type="button" class="sync-chip" id="sync-chip" data-action="sync-now" aria-live="polite"></button>' +
        '<button type="button" class="round-btn lg' + (currentPage === 'settings' ? ' active' : '') + '" data-action="nav-settings" aria-label="Réglages">' + svg('gear', 20) + '</button>' +
      '</div></header>';
  }

  function renderNav(view) {
    var due = view.fixedLines.filter(function (f) { return !f.paid; }).length;
    function tab(pages, action, icon, label, badge) {
      var on = pages.indexOf(currentPage) !== -1;
      return '<button type="button" class="tab' + (on ? ' active' : '') + '" data-action="' + action + '"' + (on ? ' aria-current="page"' : '') + '>' +
        '<span class="tab-ico">' + svg(icon, 22) + (badge ? '<span class="badge">' + badge + '</span>' : '') + '</span>' + label + '</button>';
    }
    return '<nav class="tabbar" aria-label="Navigation">' +
      tab(['dashboard', 'budget'], 'nav-dashboard', 'home', 'Accueil') +
      tab(['movements'], 'nav-movements', 'list', 'Mouvements') +
      '<button type="button" class="fab" data-action="open-movement-modal" aria-label="Ajouter un mouvement">' + svg('plus', 26) + '</button>' +
      tab(['fixed'], 'nav-fixed', 'bill', 'Fixes', due) +
      tab(['stats'], 'nav-stats', 'chart', 'Stats') +
      '</nav>';
  }

  // --- Ligne de mouvement : toucher la ligne dévoile Modifier / Supprimer ---
  function moveRowHtml(m, ctx) {
    var env = m.envelopeId ? ctx.envById[m.envelopeId] : null;
    var tag = m.tagId ? ctx.tagById[m.tagId] : null;
    var pay = m.paymentMethodId ? ctx.payById[m.paymentMethodId] : null;
    var inc = m.type === 'income';
    var what = inc ? (env ? 'Rembourse ' + env.name : 'Revenu') : (env ? env.name : 'Hors budget');
    var color = env ? tagColor(env.id) : (inc ? 'var(--good)' : 'var(--muted)');
    var icon = env ? '<span class="emo">' + env.icon + '</span>' : (inc ? svg('up', 18) : svg('dot', 18));
    var open = revealedMovementId === m.id;
    return '<div class="mv' + (open ? ' open' : '') + '" data-id="' + m.id + '">' +
      '<div class="mv-actions">' +
        '<button type="button" class="mv-edit" data-action="edit-movement" data-id="' + m.id + '" tabindex="' + (open ? 0 : -1) + '">' + svg('edit', 18) + 'Modifier</button>' +
        '<button type="button" class="mv-del" data-action="delete-movement" data-id="' + m.id + '" tabindex="' + (open ? 0 : -1) + '">' + svg('trash', 18) + 'Supprimer</button>' +
      '</div>' +
      '<button type="button" class="mv-row" data-action="toggle-movement" data-id="' + m.id + '" aria-expanded="' + open + '">' +
        '<span class="ibox" style="--c:' + color + '">' + icon + '</span>' +
        '<span class="mv-main"><span class="mv-label">' + esc(m.label) + '</span>' +
          '<span class="mv-sub">' + (tag ? '<span class="tag-pill" style="--c:' + tagColor(tag.id) + '">' + esc(tag.name) + '</span>' : '') +
          '<span class="mv-sub-txt">' + esc(what) + ' · ' + formatDateShort(m.date) + (pay ? ' · ' + esc(pay.name) : '') + '</span></span>' +
        '</span>' +
        '<span class="mv-amt' + (inc ? ' inc' : '') + '">' + (inc ? '+' : '−') + fmt(m.amount) + '</span>' +
      '</button>' +
      '</div>';
  }
  function moveListHtml(moves, ctx, emptyText) {
    if (!moves.length) return '<p class="empty-card">' + emptyText + '</p>';
    return '<div class="mv-list">' + moves.map(function (m) { return moveRowHtml(m, ctx); }).join('') + '</div>';
  }

  // Bouton ⓘ qui dévoile / masque une explication (rendue par infoText).
  function infoBtn(key, label) {
    return '<button type="button" class="info-btn' + (infoOpen[key] ? ' sel' : '') + '" data-action="toggle-info" data-key="' + key + '" aria-expanded="' + !!infoOpen[key] + '" aria-label="' + label + '">' + svg('info', 16) + '</button>';
  }
  function infoText(key, html, cls) {
    return infoOpen[key] ? '<p class="info-text' + (cls ? ' ' + cls : '') + '">' + html + '</p>' : '';
  }

  // --- Accueil ---
  function renderHomePage(view) {
    var w = activeWeek(view);
    var cur = currentWeekIndex(view);
    var netSpent = view.totalOutflow - view.recurringFixedTotal;
    var reste = view.totalIncome - view.recurringFixedDue - netSpent;
    var available = view.totalIncome - view.recurringFixedDue;
    var spentPct = pct(Math.max(0, netSpent), available);
    var hero = '<section class="hero">' +
      '<div class="hero-top"><div><span class="hero-cap">Reste à dépenser' + infoBtn('hero', 'Explication du reste à dépenser') + '</span>' +
        '<span class="hero-amount' + (reste < 0 ? ' neg' : '') + '">' + fmt(reste) + '</span>' +
        '<span class="hero-sub' + (view.endingBalance < 0 ? ' neg' : '') + '">Solde actuel (fixes payés) <b>' + fmt(view.endingBalance) + '</b></span></div>' +
        '<span class="hero-badge">' + monthStatusLabel(selectedMonthKey) + '</span></div>' +
      '<div class="hero-gauge">' +
        '<div class="hero-bar single" aria-hidden="true"><span class="seg seg-spent' + (reste < 0 ? ' over' : '') + '" style="width:' + spentPct.toFixed(2) + '%"></span></div>' +
        infoText('hero', '<b>' + fmt(netSpent) + '</b> dépensés sur <b>' + fmt(available) + '</b> disponibles après les frais fixes (revenus − frais fixes).<br><b>Grand chiffre</b> : revenus − tous les frais fixes du mois (payés ou non) − dépensé.<br><b>Solde actuel</b> : revenus − frais fixes cochés payés − dépensé, soit ce qu’il y a réellement en caisse.', 'hero-gauge-cap') +
      '</div>' +
      '<div class="hero-stats">' +
        '<div><span>Revenus</span><b>' + fmt(view.totalIncome) + '</b></div>' +
        '<div><span>Frais fixes</span><b>' + fmt(view.recurringFixedDue) + '</b></div>' +
        '<div><span>Dépensé</span><b>' + fmt(netSpent) + '</b></div>' +
      '</div></section>';

    var weekChips = '';
    for (var i = 0; i < view.weeksCount; i++) {
      var alloc = view.envelopes.reduce(function (s, e) { return s + e.effectiveWeeks[i]; }, 0);
      var spent = view.envelopes.reduce(function (s, e) { return s + e.spentByWeek[i]; }, 0);
      weekChips += '<button type="button" class="week-chip' + (i === w ? ' sel' : '') + (i === cur ? ' now' : '') + '" data-action="pick-week" data-idx="' + i + '" aria-pressed="' + (i === w) + '" aria-label="Semaine ' + (i + 1) + ', ' + weekRangeLabel(selectedMonthKey, i) + '">' +
        '<span>S' + (i + 1) + '</span><span class="week-chip-date">' + weekRangeLabel(selectedMonthKey, i).split('-')[0] + '</span><span class="week-chip-bar"><span style="width:' + pct(spent, alloc) + '%"></span></span></button>';
    }

    var monthMode = budgetMode === 'month';
    var ranked = view.envelopes.map(function (env) {
      var a = monthMode ? env.amount : env.effectiveWeeks[w], s = monthMode ? env.spentTotal : env.spentByWeek[w], p = monthMode ? env.amount : env.weeks[w];
      return { env: env, alloc: a, spent: s, plan: p, report: monthMode ? 0 : Math.max(0, p - a), ratio: a > 0 ? s / a : (s > 0 ? 99 : 0) };
    }).sort(function (a, b) { return b.ratio - a.ratio; });
    var shown = showAllBudgets ? ranked : ranked.slice(0, 6);
    var tiles = shown.map(function (r) {
      // Dispo = prévu de la semaine − dépassement reporté de la semaine précédente ;
      // grand chiffre = reste réel (dispo − dépensé) ; jauge = dépensé / dispo.
      var rem = r.alloc - r.spent, over = rem < 0;
      var gauge = r.alloc > 0 ? pct(r.spent, r.alloc) : (r.spent > 0 || r.report ? 100 : 0);
      return '<button type="button" class="budget-tile' + (over ? ' over' : '') + '" data-action="open-budget" data-id="' + r.env.id + '" aria-label="' + esc(r.env.name) + ' : ' + (over ? 'dépassé de ' + fmtShort(-rem) : 'reste ' + fmtShort(rem)) + ', disponible ' + fmtShort(r.alloc) + ' sur ' + fmtShort(r.plan) + ' prévus, ' + fmtShort(r.spent) + ' dépensés">' +
        '<span class="budget-tile-head"><span class="ibox sm" style="--c:' + tagColor(r.env.id) + '"><span class="emo">' + r.env.icon + '</span></span>' +
        '<span class="budget-tile-name">' + esc(r.env.name) + '</span></span>' +
        '<span class="tile-ratio"><b>' + fmtShort(rem) + '</b></span>' +
        '<span class="bar"><span style="width:' + gauge.toFixed(1) + '%"></span></span>' +
        (monthMode ? '<span class="tile-foot">sur <b>' + fmtShort(r.plan) + '</b> prévus</span>'
          : '<span class="tile-foot">dispo <b' + (r.report ? ' class="cut"' : '') + '>' + fmtShort(r.alloc) + '</b> / ' + fmtShort(r.plan) + '</span>') +
        '</button>';
    }).join('');
    var budgetsBlock = view.envelopes.length
      ? '<div class="budget-grid">' + tiles + '</div>' +
        (view.envelopes.length > 6 ? '<button type="button" class="btn-ghost" data-action="toggle-all-budgets">' + (showAllBudgets ? 'Réduire' : 'Afficher les ' + view.envelopes.length + ' budgets') + svg('chevD', 16, showAllBudgets ? 'flip' : '') + '</button>' : '')
      : '<p class="empty-card">Aucun budget ce mois-ci. <button type="button" class="link" data-action="goto-settings" data-section="settings-budgets">Créer un budget</button></p>';

    var ctx = moveCtx(view);
    var weekMoves = view.movements.filter(function (m) { return m.weekIndex === w; });
    return renderInstallBanner() + hero +
      '<div class="week-chips">' + weekChips + '</div>' +
      '<section class="block"><div class="block-head"><h2>Budgets' + infoBtn('budgets', 'Explication des cartes budget') + '</h2>' +
        '<span class="seg" role="group" aria-label="Période des budgets"><button type="button" data-action="budget-mode" data-mode="week" aria-pressed="' + !monthMode + '">Semaine</button><button type="button" data-action="budget-mode" data-mode="month" aria-pressed="' + monthMode + '">Mois</button></span></div>' +
      '<p class="block-sub">' + (monthMode ? 'Reste sur le mois' : weekRangeLabel(selectedMonthKey, w).replace('-', ' → ')) + '</p>' +
        infoText('budgets', '<b>Grand chiffre</b> : ce qu’il reste réellement à dépenser cette semaine (dispo − dépensé).<br><b>Dispo / prévu</b> : le prévu de la semaine, diminué du dépassement de la semaine précédente (en rouge quand il y a un report).<br><b>Jauge</b> : dépensé par rapport au dispo.<br>En vue <b>Mois</b> : reste du budget sur tout le mois.') +
        budgetsBlock + '</section>' +
      '<section class="block"><div class="block-head"><h2>' + (w === cur ? 'Cette semaine' : 'Semaine ' + (w + 1)) + '</h2>' +
        '<button type="button" class="link" data-action="nav-movements">Tout voir</button></div>' +
        moveListHtml(weekMoves, ctx, 'Aucun mouvement cette semaine.') + '</section>';
  }

  // --- Détail d'un budget ---
  function renderBudgetPage(view) {
    var env = view.envelopes.find(function (e) { return e.id === budgetDetailId; });
    if (!env) return renderHomePage(view);
    var w = activeWeek(view);
    var alloc = env.effectiveWeeks[w], spent = env.spentByWeek[w], rem = alloc - spent, over = rem < 0;
    var dash = (pct(spent, alloc) / 100 * 414.7).toFixed(1);
    var maxRatio = Math.max.apply(null, env.weeks.map(function (_, i) { return env.effectiveWeeks[i] > 0 ? env.spentByWeek[i] / env.effectiveWeeks[i] : 0; }).concat([1]));
    var bars = env.weeks.map(function (_, i) {
      var a = env.effectiveWeeks[i], s = env.spentByWeek[i];
      var h = a > 0 ? Math.max(4, s / a / maxRatio * 100) : (s > 0 ? 100 : 4);
      var cls = s > a ? ' over' : (s > 0 ? (i === w ? ' sel' : ' used') : '');
      return '<button type="button" class="wbar" data-action="pick-week" data-idx="' + i + '" aria-label="Semaine ' + (i + 1) + ' : ' + fmt(s) + ' sur ' + fmt(a) + '">' +
        '<span class="wbar-val">' + (s ? fmt(s).replace(/\s?€/, '') : '') + '</span>' +
        '<span class="wbar-fill' + cls + '" style="height:' + h.toFixed(1) + '%"></span>' +
        '<span class="wbar-lab' + (i === w ? ' sel' : '') + '">S' + (i + 1) + '</span></button>';
    }).join('');
    var ctx = moveCtx(view);
    return '<div class="detail-head">' +
        '<button type="button" class="round-btn lg" data-action="nav-dashboard" aria-label="Retour">' + svg('chevL', 20) + '</button>' +
        '<h1 class="detail-title"><span class="ibox sm" style="--c:' + tagColor(env.id) + '"><span class="emo">' + env.icon + '</span></span>' + esc(env.name) + (env.ephemeral ? '<span class="pill-soft">ponctuel</span>' : '') + '</h1>' +
        '<button type="button" class="round-btn lg" data-action="next-budget" aria-label="Budget suivant">' + svg('chevR', 20) + '</button>' +
      '</div>' +
      '<section class="card ring-card">' +
        '<div class="ring"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="66" class="ring-track"/><circle cx="80" cy="80" r="66" class="ring-fill' + (over ? ' over' : '') + '" stroke-dasharray="' + dash + ' 415" transform="rotate(-90 80 80)"/></svg>' +
          '<span class="ring-center"><b>' + fmt(rem) + '</b><span>' + (over ? 'dépassé' : 'restants') + '</span></span></div>' +
        '<div class="ring-facts"><span class="muted-sm">Semaine ' + (w + 1) + ' · ' + weekRangeLabel(selectedMonthKey, w) + '</span>' +
          '<div class="fact"><span>Prévu</span><b>' + fmt(env.weeks[w]) + '</b></div>' +
          (env.weeks[w] - alloc > 0.004 ? '<div class="fact report"><span>Report S' + w + '</span><b>−' + fmt(env.weeks[w] - alloc) + '</b></div>' : '') +
          '<div class="fact"><span>Dépensé</span><b>' + fmt(spent) + '</b></div>' +
          '<div class="fact sep"><span>Mois</span><b>' + fmt(env.spentTotal) + ' / ' + fmt(env.amount) + '</b></div>' +
        '</div></section>' +
      '<section class="card"><div class="block-head"><h2>Par semaine</h2><span class="muted-sm">touche une semaine</span></div>' +
        '<div class="wbars" style="--n:' + env.weeks.length + '">' + bars + '</div></section>' +
      '<section class="block"><div class="block-head"><h2>Mouvements du mois</h2>' +
        '<button type="button" class="link" data-action="goto-settings" data-section="settings-budgets">Régler le budget</button></div>' +
        moveListHtml(env.movements, ctx, 'Rien sur ce budget ce mois-ci.') + '</section>';
  }

  // --- Mouvements : recherche, filtres, vues groupées ---
  var VIEWS = [
    { id: 'week', title: 'Par semaine', desc: 'Les semaines du mois, la semaine en cours ouverte', icon: 'calendar' },
    { id: 'budget', title: 'Par budget', desc: 'Chaque budget, plus hors budget et revenus', icon: 'grid' },
    { id: 'tag', title: 'Par tag', desc: 'Chaque tag, plus les mouvements sans tag', icon: 'tag' },
    { id: 'payment', title: 'Par mode de paiement', desc: 'Carte, espèces, virement…', icon: 'card' }
  ];
  function activeFilterCount() {
    return (movementTypeFilter !== 'all' ? 1 : 0) + (filterEnvelopeId ? 1 : 0) + (filterTagId ? 1 : 0) + (filterPaymentId ? 1 : 0);
  }
  function filterMovements(moves, q, ctx) {
    return moves.filter(function (m) {
      if (movementTypeFilter !== 'all' && m.type !== movementTypeFilter) return false;
      if (filterEnvelopeId && (filterEnvelopeId === 'none' ? !!m.envelopeId : m.envelopeId !== filterEnvelopeId)) return false;
      if (filterTagId && (filterTagId === 'none' ? !!m.tagId : m.tagId !== filterTagId)) return false;
      if (filterPaymentId && (filterPaymentId === 'none' ? !!m.paymentMethodId : m.paymentMethodId !== filterPaymentId)) return false;
      if (!q) return true;
      if (movementMatchesQuery(m, q)) return true;
      var env = ctx.envById[m.envelopeId], tag = ctx.tagById[m.tagId], pay = ctx.payById[m.paymentMethodId];
      return [env ? env.name : 'hors budget', tag ? tag.name : '', pay ? pay.name : ''].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }
  function groupHtml(key, title, meta, color, right, moves, ctx, defaultOpen) {
    var isOpen = openAccordions.has(key) || defaultOpen;
    return '<details class="grp" data-key="' + key + '"' + (isOpen ? ' open' : '') + '>' +
      '<summary class="grp-head"><span class="dot lg" style="--c:' + color + '"></span>' +
        '<span class="grp-title"><b>' + title + '</b><span>' + meta + '</span></span>' +
        '<span class="grp-right">' + right + '</span>' + svg('chevD', 18, 'chev') + '</summary>' +
      '<div class="grp-body">' + (moves.length ? '<div class="mv-list">' + moves.map(function (m) { return moveRowHtml(m, ctx); }).join('') + '</div>' : '<p class="empty-note">Aucun mouvement.</p>') + '</div>' +
      '</details>';
  }
  function countLabel(n) { return n + (n > 1 ? ' mouvements' : ' mouvement'); }
  function renderMovementsPage(view) {
    var ctx = moveCtx(view);
    var q = movementSearchQuery.trim().toLowerCase();
    var fcount = activeFilterCount();
    var curView = VIEWS.find(function (v) { return v.id === movementGroupBy; }) || VIEWS[0];
    var html = '<h1 class="page-title">Mouvements</h1>' +
      '<div class="search-row">' +
        '<label class="search-box">' + svg('search', 18) + '<span class="sr-only">Rechercher un mouvement</span>' +
          '<input type="search" placeholder="Rechercher…" value="' + esc(movementSearchQuery) + '" data-field="mv-search" data-focus-key="mv-search" autocomplete="off">' +
        '</label>' +
        '<button type="button" class="square-btn' + (fcount ? ' on' : '') + '" data-action="open-filter-sheet" aria-label="Filtres' + (fcount ? ' (' + fcount + ' actifs)' : '') + '">' + svg('filter', 20) + (fcount ? '<span class="badge">' + fcount + '</span>' : '') + '</button>' +
        '<button type="button" class="square-btn" data-action="open-view-sheet" aria-label="Vue : ' + curView.title.toLowerCase() + ' (changer)">' + svg(curView.icon, 20) + '</button>' +
      '</div>';

    var pills = [];
    if (movementTypeFilter !== 'all') pills.push({ key: 'type', name: movementTypeFilter === 'expense' ? 'Dépenses' : 'Revenus' });
    if (filterEnvelopeId) pills.push({ key: 'envelope', name: filterEnvelopeId === 'none' ? 'Hors budget' : (ctx.envById[filterEnvelopeId] ? ctx.envById[filterEnvelopeId].name : 'Budget') });
    if (filterTagId) pills.push({ key: 'tag', name: filterTagId === 'none' ? 'Sans tag' : '#' + (ctx.tagById[filterTagId] ? ctx.tagById[filterTagId].name : 'tag') });
    if (filterPaymentId) pills.push({ key: 'payment', name: filterPaymentId === 'none' ? 'Sans mode de paiement' : (ctx.payById[filterPaymentId] ? ctx.payById[filterPaymentId].name : 'Paiement') });
    if (pills.length) {
      html += '<div class="pill-row">' + pills.map(function (p) {
        return '<button type="button" class="filter-pill" data-action="clear-filter" data-key="' + p.key + '" aria-label="Retirer le filtre ' + esc(p.name) + '">' + esc(p.name) + svg('x', 12) + '</button>';
      }).join('') + '</div>';
    }

    if (q || fcount) {
      var res = filterMovements(view.movements, q, ctx);
      html += '<div class="block-head"><h2>' + countLabel(res.length) + '</h2><span class="grp-total">' + signedFmt(signedTotal(res)) + '</span></div>' +
        moveListHtml(res, ctx, 'Aucun mouvement ne correspond.') +
        '<button type="button" class="btn-ghost" data-action="clear-filters">Effacer la recherche et les filtres</button>';
      return html;
    }

    html += '<div class="block-head"><h2>' + curView.title + '</h2><button type="button" class="link" data-action="open-view-sheet">Changer de vue</button></div>';
    var moves = view.movements;
    var groups = [];
    if (movementGroupBy === 'budget') {
      view.envelopes.forEach(function (env) {
        var list = moves.filter(function (m) { return m.envelopeId === env.id; });
        groups.push({ key: 'grp-b-' + env.id, title: env.icon + ' ' + esc(env.name), meta: countLabel(list.length) + ' · prévu ' + fmt(env.amount), color: tagColor(env.id),
          right: '<span class="' + (env.spentTotal > env.amount ? 'neg' : '') + '">' + fmt(env.spentTotal) + '</span>', moves: list });
      });
      var off = moves.filter(function (m) { return m.type === 'expense' && !m.envelopeId; });
      groups.push({ key: 'grp-b-none', title: 'Hors budget', meta: countLabel(off.length), color: 'var(--muted)', right: fmt(off.reduce(function (s, m) { return s + m.amount; }, 0)), moves: off });
      var incs = moves.filter(function (m) { return m.type === 'income' && !m.envelopeId; });
      groups.push({ key: 'grp-b-inc', title: 'Revenus', meta: countLabel(incs.length) + ' · hors revenus récurrents', color: 'var(--good)', right: signedFmt(signedTotal(incs)), moves: incs });
    } else if (movementGroupBy === 'tag') {
      state.recurring.tags.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }).forEach(function (t) {
        var list = moves.filter(function (m) { return m.tagId === t.id; });
        groups.push({ key: 'grp-t-' + t.id, title: esc(t.name), meta: countLabel(list.length), color: tagColor(t.id), right: signedFmt(signedTotal(list)), moves: list });
      });
      var noTag = moves.filter(function (m) { return !m.tagId; });
      groups.push({ key: 'grp-t-none', title: 'Sans tag', meta: countLabel(noTag.length), color: 'var(--line-strong)', right: signedFmt(signedTotal(noTag)), moves: noTag });
    } else if (movementGroupBy === 'payment') {
      state.recurring.paymentMethods.forEach(function (p) {
        var list = moves.filter(function (m) { return m.paymentMethodId === p.id; });
        groups.push({ key: 'grp-p-' + p.id, title: p.icon + ' ' + esc(p.name), meta: countLabel(list.length) + (p.id === state.settings.defaultPaymentMethodId ? ' · par défaut' : ''), color: paymentColor(p.id), right: signedFmt(signedTotal(list)), moves: list });
      });
      var noPay = moves.filter(function (m) { return !m.paymentMethodId; });
      if (noPay.length) groups.push({ key: 'grp-p-none', title: 'Sans mode de paiement', meta: countLabel(noPay.length), color: 'var(--line-strong)', right: signedFmt(signedTotal(noPay)), moves: noPay });
    } else {
      var cur = currentWeekIndex(view);
      for (var i = 0; i < view.weeksCount; i++) {
        var wl = moves.filter(function (m) { return m.weekIndex === i; });
        var alloc = view.envelopes.reduce(function (s, e) { return s + e.effectiveWeeks[i]; }, 0);
        var spent = view.envelopes.reduce(function (s, e) { return s + e.spentByWeek[i]; }, 0);
        groups.push({ key: 'grp-w-' + selectedMonthKey + '-' + i, title: 'Semaine ' + (i + 1), meta: weekRangeLabel(selectedMonthKey, i) + ' · ' + countLabel(wl.length),
          color: i === cur ? 'var(--accent)' : 'var(--peach)', right: '<span class="' + (spent > alloc ? 'neg' : '') + '">' + fmt(spent) + '</span><small>/ ' + fmt(alloc) + '</small>', moves: wl, isCur: i === cur });
      }
    }
    var anyOpen = groups.some(function (g) { return openAccordions.has(g.key); });
    html += '<div class="grp-list">' + groups.map(function (g, idx) {
      var def = !anyOpen && (movementGroupBy === 'week' ? (g.isCur || (idx === 0 && currentWeekIndex(view) < 0)) : false);
      return groupHtml(g.key, g.title, g.meta, g.color, g.right, g.moves, ctx, def);
    }).join('') + '</div>';
    return html;
  }

  function renderFilterSheet(view) {
    var ctx = moveCtx(view);
    var res = filterMovements(view.movements, movementSearchQuery.trim().toLowerCase(), ctx);
    function chip(key, val, name, color, sel) {
      return '<button type="button" class="chip' + (sel ? ' sel' : '') + '" data-action="set-filter" data-key="' + key + '" data-val="' + val + '" aria-pressed="' + sel + '">' +
        (color ? '<span class="dot" style="--c:' + color + '"></span>' : '') + '<span class="chip-txt">' + esc(name) + '</span></button>';
    }
    var types = [['all', 'Tout'], ['expense', 'Dépenses'], ['income', 'Revenus']].map(function (t) {
      var sel = movementTypeFilter === t[0];
      return '<button type="button" class="seg-btn' + (sel ? ' sel' : '') + '" data-action="set-filter" data-key="type" data-val="' + t[0] + '" aria-pressed="' + sel + '">' + t[1] + '</button>';
    }).join('');
    var envs = chip('envelope', 'none', 'Hors budget', 'var(--muted)', filterEnvelopeId === 'none') +
      view.envelopes.map(function (e) { return chip('envelope', e.id, e.icon + ' ' + e.name, null, filterEnvelopeId === e.id); }).join('');
    var tags = chip('tag', 'none', 'Sans tag', 'var(--line-strong)', filterTagId === 'none') +
      state.recurring.tags.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }).map(function (t) { return chip('tag', t.id, t.name, tagColor(t.id), filterTagId === t.id); }).join('');
    var pays = state.recurring.paymentMethods.map(function (p) { return chip('payment', p.id, p.icon + ' ' + p.name, null, filterPaymentId === p.id); }).join('') +
      chip('payment', 'none', 'Sans mode', 'var(--line-strong)', filterPaymentId === 'none');
    return '<dialog class="sheet tall" id="filter-sheet" aria-labelledby="filter-title"><div class="sheet-body">' +
      '<div class="grabber"></div>' +
      '<div class="sheet-head"><h2 id="filter-title" class="sheet-title">Filtres</h2><button type="button" class="link" data-action="clear-filters">Réinitialiser</button></div>' +
      '<div class="sheet-scroll">' +
        '<div class="field-group"><span class="field-cap">Type</span><div class="seg-group">' + types + '</div></div>' +
        '<div class="field-group"><span class="field-cap">Budget</span><div class="chip-wrap">' + envs + '</div></div>' +
        '<div class="field-group"><span class="field-cap">Tag</span><div class="chip-wrap">' + tags + '</div></div>' +
        '<div class="field-group"><span class="field-cap">Mode de paiement</span><div class="chip-wrap">' + pays + '</div></div>' +
      '</div>' +
      '<button type="button" class="btn-primary big" data-action="close-sheet" data-id="filter-sheet">Voir ' + countLabel(res.length) + '</button>' +
      '</div></dialog>';
  }
  function renderViewSheet() {
    return '<dialog class="sheet" id="view-sheet" aria-labelledby="view-title"><div class="sheet-body">' +
      '<div class="grabber"></div><h2 id="view-title" class="sheet-title">Afficher les mouvements</h2>' +
      '<div class="option-list">' + VIEWS.map(function (v) {
        var sel = movementGroupBy === v.id;
        return '<button type="button" class="option' + (sel ? ' sel' : '') + '" data-action="set-view" data-val="' + v.id + '" aria-pressed="' + sel + '">' +
          '<span class="option-ico">' + svg(v.icon, 20) + '</span><span class="option-txt"><b>' + v.title + '</b><span>' + v.desc + '</span></span>' +
          '<span class="option-check">' + svg('check', 14) + '</span></button>';
      }).join('') + '</div></div></dialog>';
  }

  // --- Feuille d'ajout / modification d'un mouvement ---
  function usageCounts(field) {
    var c = {};
    Object.keys(state.months).forEach(function (k) {
      (state.months[k].movements || []).forEach(function (m) { if (m[field]) c[m[field]] = (c[m[field]] || 0) + 1; });
    });
    return c;
  }
  function pickerItems(kind, view) {
    if (kind === 'envelope') return view.envelopes.map(function (e) { return { id: e.id, name: e.name, icon: e.icon, color: tagColor(e.id), sub: fmt(e.remaining) + (e.remaining < 0 ? ' de dépassement' : ' restants ce mois') }; });
    var use = usageCounts('tagId');
    return state.recurring.tags.map(function (t) { var n = use[t.id] || 0; return { id: t.id, name: t.name, color: tagColor(t.id), sub: countLabel(n) }; });
  }
  function sortedByUse(kind, items) {
    var use = usageCounts(kind === 'envelope' ? 'envelopeId' : 'tagId');
    return items.slice().sort(function (a, b) { return (use[b.id] || 0) - (use[a.id] || 0) || a.name.localeCompare(b.name, 'fr'); });
  }
  function noneItem(kind, isInc) { return { id: '', name: kind === 'envelope' ? (isInc ? 'Aucun' : 'Hors budget') : 'Aucun', color: 'var(--line-strong)' }; }
  function chipBtn(kind, x, sel) {
    return '<button type="button" class="chip' + (sel ? ' sel' : '') + '" data-action="pick-quick" data-kind="' + kind + '" data-id="' + esc(x.id || '') + '" aria-pressed="' + sel + '">' +
      (x.icon ? '<span class="emo">' + x.icon + '</span>' : '<span class="dot" style="--c:' + (x.color || 'var(--line-strong)') + '"></span>') +
      '<span class="chip-txt">' + esc(x.name) + '</span></button>';
  }
  function quickChips(kind, selId, isInc, view, pendingName) {
    var items = pickerItems(kind, view);
    var top = sortedByUse(kind, items).slice(0, 3);
    if (selId === '__new_tag__') {
      top = [{ id: '__new_tag__', name: pendingName || 'Nouveau tag', color: 'var(--accent)' }].concat(top.slice(0, 2));
    } else if (selId) {
      var s = items.find(function (x) { return x.id === selId; });
      if (s && !top.some(function (x) { return x.id === selId; })) top = [s].concat(top.slice(0, 2));
    } else {
      top = [noneItem(kind, isInc)].concat(top.slice(0, 2));
    }
    return '<div class="quick-scroll">' + top.map(function (x) { return chipBtn(kind, x, (x.id || '') === (selId || '')); }).join('') + '</div>' +
      '<button type="button" class="chip more" data-action="open-picker" data-kind="' + kind + '">Tous (' + items.length + ')' + svg('chevR', 14) + '</button>';
  }
  function defaultEnvelopeId(view) {
    if (currentPage === 'budget' && budgetDetailId && view.envelopes.some(function (e) { return e.id === budgetDetailId; })) return budgetDetailId;
    var sorted = sortedByUse('envelope', pickerItems('envelope', view));
    return sorted.length ? sorted[0].id : null;
  }
  function defaultMovementDate(view) {
    var w = activeWeek(view);
    if (w === currentWeekIndex(view)) return todayISO();
    var weeks = monthWeeks(selectedMonthKey);
    return weeks[w] != null ? isoOf(weekStartDateOfIndex(weeks[w])) : todayISO();
  }
  function renderMovementSheet(view) {
    var mv = editingMovementId ? view.movements.find(function (m) { return m.id === editingMovementId; }) : null;
    var isInc = !!(mv && mv.type === 'income');
    var envId = mv ? mv.envelopeId : defaultEnvelopeId(view);
    var tagId = mv ? mv.tagId : null;
    var payId = mv ? mv.paymentMethodId : state.settings.defaultPaymentMethodId;
    var payOptions = '<option value="">Sans mode de paiement</option>' + state.recurring.paymentMethods.map(function (p) {
      return '<option value="' + p.id + '"' + (payId === p.id ? ' selected' : '') + '>' + p.icon + ' ' + esc(p.name) + '</option>';
    }).join('');
    return '<dialog class="sheet" id="movement-modal" aria-labelledby="mv-title">' +
      '<form class="sheet-body" data-form="add-movement" novalidate>' +
        '<div class="grabber"></div>' +
        '<div class="sheet-head">' +
          '<div class="seg-group compact" role="radiogroup" aria-label="Type">' +
            '<label class="seg-btn"><input type="radio" name="type" value="expense" data-field="mv-type"' + (!isInc ? ' checked' : '') + '><span>Dépense</span></label>' +
            '<label class="seg-btn"><input type="radio" name="type" value="income" data-field="mv-type"' + (isInc ? ' checked' : '') + '><span>Revenu</span></label>' +
          '</div>' +
          '<h2 id="mv-title" class="sheet-title sm">' + (mv ? 'Modifier' : 'Nouveau') + '</h2>' +
          '<button type="button" class="round-btn" data-action="close-movement-modal" aria-label="Fermer">' + svg('x', 16) + '</button>' +
        '</div>' +
        (mv ? '<input type="hidden" name="movementId" value="' + mv.id + '">' : '') +
        '<label class="amount-field' + (isInc ? ' inc' : '') + '"><span class="sr-only">Montant en euros</span><span class="amount-sign">' + (isInc ? '+' : '−') + '</span>' +
          '<input type="text" inputmode="decimal" name="amount" placeholder="0,00" autocomplete="off" value="' + (mv ? String(mv.amount).replace('.', ',') : '') + '"><span class="amount-cur">€</span></label>' +
        '<label class="line-field"><span class="sr-only">Description</span><input type="text" name="label" maxlength="60" placeholder="Description (facultatif)" value="' + (mv ? esc(mv.label) : '') + '"></label>' +
        '<div class="field-group"><span class="field-cap" data-role="env-cap">' + (isInc ? 'Rattacher à un budget (remboursement)' : 'Budget') + '</span>' +
          '<input type="hidden" name="envelopeId" value="' + esc(envId || '') + '">' +
          '<div class="quick-row" data-quick="envelope">' + quickChips('envelope', envId, isInc, view) + '</div></div>' +
        '<div class="field-group"><span class="field-cap">Tag</span>' +
          '<input type="hidden" name="tagId" value="' + esc(tagId || '') + '"><input type="hidden" name="newTagName" value="">' +
          '<div class="quick-row" data-quick="tag">' + quickChips('tag', tagId, isInc, view) + '</div></div>' +
        '<div class="two-col">' +
          '<label class="pill-field">' + svg('calendar', 16) + '<span class="sr-only">Date</span><input type="date" name="date" value="' + (mv ? mv.date : defaultMovementDate(view)) + '" required></label>' +
          '<label class="pill-field">' + svg('card', 16) + '<span class="sr-only">Mode de paiement</span><select name="paymentMethodId">' + payOptions + '</select></label>' +
        '</div>' +
        '<button type="submit" class="btn-primary big">' + svg('check', 20) + (mv ? 'Enregistrer' : 'Ajouter') + '</button>' +
      '</form></dialog>';
  }
  // Met à jour la sélection de budget / tag dans la feuille ouverte, sans re-rendu
  // (la saisie en cours est conservée).
  function setSheetSelection(kind, id, newName) {
    var form = document.querySelector('form[data-form="add-movement"]');
    if (!form) return;
    if (kind === 'envelope') form.elements.envelopeId.value = id || '';
    else { form.elements.tagId.value = id || ''; form.elements.newTagName.value = newName || ''; }
    refreshSheetChips(form);
  }
  function refreshSheetChips(form) {
    var view = computeMonthView(state, selectedMonthKey, {});
    var isInc = form.querySelector('input[name="type"]:checked').value === 'income';
    form.querySelector('[data-quick="envelope"]').innerHTML = quickChips('envelope', form.elements.envelopeId.value || null, isInc, view);
    form.querySelector('[data-quick="tag"]').innerHTML = quickChips('tag', form.elements.tagId.value || null, isInc, view, form.elements.newTagName.value);
    form.querySelector('[data-role="env-cap"]').textContent = isInc ? 'Rattacher à un budget (remboursement)' : 'Budget';
    var amount = form.querySelector('.amount-field');
    amount.classList.toggle('inc', isInc);
    amount.querySelector('.amount-sign').textContent = isInc ? '+' : '−';
  }
  // Sélecteur plein écran (recherche, fréquents, liste complète) pour 20 budgets ou tags et plus.
  function openPicker(kind) {
    var form = document.querySelector('form[data-form="add-movement"]');
    if (!form) return;
    var view = computeMonthView(state, selectedMonthKey, {});
    var isInc = form.querySelector('input[name="type"]:checked').value === 'income';
    var selId = (kind === 'envelope' ? form.elements.envelopeId.value : form.elements.tagId.value) || '';
    var items = pickerItems(kind, view);
    var frequent = sortedByUse(kind, items).slice(0, 5);
    var all = [noneItem(kind, isInc)].concat(items.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }));
    function tile(x) {
      return '<button type="button" class="pick-tile' + ((x.id || '') === selId ? ' sel' : '') + '" data-action="picker-choose" data-kind="' + kind + '" data-id="' + esc(x.id || '') + '" data-name="' + esc(x.name.toLowerCase()) + '">' +
        (x.icon ? '<span class="ibox sm" style="--c:' + x.color + '"><span class="emo">' + x.icon + '</span></span>' : '<span class="dot lg" style="--c:' + x.color + '"></span>') +
        '<span class="pick-txt"><b>' + esc(x.name) + '</b><span>' + esc(x.sub || (x.id ? '' : (kind === 'envelope' ? (isInc ? 'ne recrédite aucun budget' : 'compté à part') : 'pas de tag'))) + '</span></span></button>';
    }
    var title = kind === 'envelope' ? (isInc ? 'Rattacher à un budget' : 'Choisir un budget') : 'Choisir un tag';
    document.getElementById('picker-body').innerHTML =
      '<div class="sheet-head"><h2 class="sheet-title">' + title + '</h2><button type="button" class="round-btn" data-action="close-picker" aria-label="Fermer">' + svg('x', 16) + '</button></div>' +
      '<label class="search-box"><span class="sr-only">Rechercher</span>' + svg('search', 18) +
        '<input type="search" data-picker-search="' + kind + '" placeholder="' + (kind === 'envelope' ? 'Rechercher un budget' : 'Rechercher ou créer un tag') + '" autocomplete="off"></label>' +
      '<div class="sheet-scroll">' +
        (frequent.length ? '<div class="field-group" data-role="frequent"><span class="field-cap">Fréquents</span><div class="chip-wrap">' +
          frequent.map(function (x) { return '<button type="button" class="chip' + (x.id === selId ? ' sel' : '') + '" data-action="picker-choose" data-kind="' + kind + '" data-id="' + esc(x.id) + '">' + (x.icon ? '<span class="emo">' + x.icon + '</span>' : '<span class="dot" style="--c:' + x.color + '"></span>') + '<span class="chip-txt">' + esc(x.name) + '</span></button>'; }).join('') +
          '</div></div>' : '') +
        '<div class="field-group"><span class="field-cap" data-role="all-cap">' + (kind === 'envelope' ? 'Tous les budgets' : 'Tous les tags') + '</span>' +
          '<div class="pick-grid">' + all.map(tile).join('') + '</div>' +
          (kind === 'tag' ? '<button type="button" class="btn-dashed" data-action="picker-create" hidden></button>' : '') +
          '<p class="empty-note" data-role="no-result" hidden>Aucun résultat</p></div>' +
      '</div>';
    var d = document.getElementById('picker-sheet');
    d.classList.remove('instant');
    d.showModal();
  }
  function filterPicker(input) {
    var q = input.value.trim().toLowerCase();
    var body = document.getElementById('picker-body');
    var shown = 0;
    body.querySelectorAll('.pick-tile').forEach(function (b) {
      var ok = !q || b.dataset.name.indexOf(q) !== -1;
      b.hidden = !ok;
      if (ok) shown++;
    });
    var freq = body.querySelector('[data-role="frequent"]');
    if (freq) freq.hidden = !!q;
    var create = body.querySelector('[data-action="picker-create"]');
    if (create) {
      var exact = state.recurring.tags.some(function (t) { return t.name.toLowerCase() === q; });
      create.hidden = !q || exact;
      create.dataset.name = input.value.trim();
      create.textContent = '+ Créer le tag « ' + input.value.trim() + ' »';
    }
    body.querySelector('[data-role="no-result"]').hidden = shown > 0 || !!(create && !create.hidden);
  }

  // --- Frais fixes ---
  function renderFixedPage(view) {
    var lines = view.fixedLines.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    var paid = lines.filter(function (f) { return f.paid; });
    var due = lines.filter(function (f) { return !f.paid; });
    var left = view.recurringFixedDue - view.recurringFixedTotal;
    function row(f) {
      return '<button type="button" class="fixed-row' + (f.paid ? ' paid' : '') + '" data-action="toggle-fixed" data-id="' + f.id + '" aria-pressed="' + f.paid + '">' +
        '<span class="check">' + svg('check', 14) + '</span>' +
        '<span class="fixed-name"><b>' + esc(f.name) + '</b><span>' + (f.paid ? 'payé · toucher pour annuler' : 'à payer') + '</span></span>' +
        '<span class="fixed-amt">' + fmt(f.amount) + '</span></button>';
    }
    return '<h1 class="page-title">Frais fixes</h1>' +
      '<section class="hero">' +
        '<div class="hero-top"><div><span class="hero-cap">Reste à payer ce mois</span><span class="hero-amount">' + fmt(left) + '</span></div>' +
        '<span class="hero-badge">' + paid.length + ' / ' + lines.length + ' payés</span></div>' +
        '<div class="hero-bar single"><span class="seg seg-good" style="width:' + pct(view.recurringFixedTotal, view.recurringFixedDue) + '%"></span></div>' +
        '<div class="hero-stats two"><div><span>Total du mois</span><b>' + fmt(view.recurringFixedDue) + '</b></div><div><span>Déjà payé</span><b>' + fmt(view.recurringFixedTotal) + '</b></div></div>' +
      '</section>' +
      (lines.length ? '' : '<p class="empty-card">Aucun frais fixe ce mois-ci. Ajoute ton loyer, tes abonnements… ci-dessous.</p>') +
      (due.length ? '<section class="block"><div class="block-head"><h2>À payer</h2></div><div class="fixed-list">' + due.map(row).join('') + '</div></section>' :
        (lines.length ? '<p class="done-card">' + svg('check', 18) + 'Tous les frais fixes sont payés ce mois-ci</p>' : '')) +
      (paid.length ? '<section class="block"><div class="block-head"><h2>Payés</h2></div><div class="fixed-list">' + paid.map(row).join('') + '</div></section>' : '') +
      '<section class="block"><div class="block-head"><h2>Ajouter un frais fixe</h2></div>' +
        '<form class="inline-form" data-form="add-fixed">' +
          '<input type="text" name="name" placeholder="Loyer, abonnement…" required maxlength="60" aria-label="Nom">' +
          '<input type="text" inputmode="decimal" name="amount" placeholder="Montant" required aria-label="Montant">' +
          '<button type="submit" class="btn-primary">Ajouter</button></form>' +
        '<button type="button" class="link center" data-action="goto-settings" data-section="settings-fixed">Modifier les montants ou supprimer · Réglages</button>' +
      '</section>';
  }

  function renderIconGrid(selectedIcon, editMode, envId, ephemeral) {
    return '<div class="icon-grid">' + ICONS.map(function (ic) {
      var sel = ic === selectedIcon;
      var action = editMode ? (ephemeral ? 'set-ephemeral-envelope-icon' : 'set-envelope-icon') : 'pick-icon';
      return '<button type="button" class="icon-choice' + (sel ? ' selected' : '') + '" data-action="' + action + '"' + (editMode ? ' data-id="' + envId + '"' : '') + ' data-icon="' + ic + '">' + ic + '</button>';
    }).join('') + '</div>';
  }

  // Palette de couleurs prédéfinies (celles déjà utilisées pour l'attribution auto),
  // affichée en grille dépliable à côté du sélecteur natif — plus facile pour repérer
  // des teintes vraiment distinctes qu'avec la roue de couleurs du navigateur seule.
  function renderColorGrid(selectedColor, action, id) {
    var sel = (selectedColor || '').toLowerCase();
    return '<div class="color-grid">' + TAG_COLORS.map(function (c) {
      var isSel = c.toLowerCase() === sel;
      return '<button type="button" class="color-choice' + (isSel ? ' selected' : '') + '" data-action="' + action + '" data-id="' + id + '" data-color="' + c + '" style="background:' + c + '" aria-label="Choisir ' + c + '"></button>';
    }).join('') + '</div>';
  }

  function renderStatsPage(st, year) {
    var months = [];
    for (var m = 1; m <= 12; m++) months.push(computeMonthView(st, year + '-' + pad2(m), {}));
    var yearIncome = months.reduce(function (s, v) { return s + v.totalIncome; }, 0);
    var yearOutflow = months.reduce(function (s, v) { return s + v.totalOutflow; }, 0);
    var yearBalance = yearIncome - yearOutflow;
    var key = statsMonthKey && statsMonthKey.slice(0, 4) === String(year) ? statsMonthKey
      : (String(year) === selectedMonthKey.slice(0, 4) ? selectedMonthKey : year + '-01');
    var maxVal = Math.max(1, Math.max.apply(null, months.map(function (v) { return Math.max(v.totalIncome, v.totalOutflow); })));
    var cols = months.map(function (v, i) {
      var sel = v.key === key;
      return '<button type="button" class="ycol' + (sel ? ' sel' : '') + '" data-action="stats-month" data-key="' + v.key + '" aria-pressed="' + sel + '" aria-label="' + monthLabel(v.key) + ' : revenus ' + fmt(v.totalIncome) + ', dépenses ' + fmt(v.totalOutflow) + '">' +
        '<span class="ycol-bars"><span class="yb inc" style="height:' + (v.totalIncome / maxVal * 100).toFixed(1) + '%"></span><span class="yb out" style="height:' + (v.totalOutflow / maxVal * 100).toFixed(1) + '%"></span></span>' +
        '<span class="ycol-lab">' + MONTH_ABBREVS[i].charAt(0) + '</span></button>';
    }).join('');

    var v = months.find(function (x) { return x.key === key; }) || months[0];
    var expenses = v.movements.filter(function (mv) { return mv.type === 'expense'; });
    var sumOf = function (arr) { return arr.reduce(function (s, mv) { return s + mv.amount; }, 0); };
    var shares = [];
    if (statsBy === 'tag') {
      st.recurring.tags.forEach(function (t) { shares.push({ name: t.name, value: sumOf(expenses.filter(function (mv) { return mv.tagId === t.id; })), color: tagColor(t.id) }); });
      shares.push({ name: 'Sans tag', value: sumOf(expenses.filter(function (mv) { return !mv.tagId; })), color: 'var(--line-strong)' });
    } else if (statsBy === 'payment') {
      st.recurring.paymentMethods.forEach(function (p) { shares.push({ name: p.icon + ' ' + p.name, value: sumOf(expenses.filter(function (mv) { return mv.paymentMethodId === p.id; })), color: paymentColor(p.id) }); });
      shares.push({ name: 'Sans mode de paiement', value: sumOf(expenses.filter(function (mv) { return !mv.paymentMethodId; })), color: 'var(--line-strong)' });
    } else {
      v.envelopes.forEach(function (env) { shares.push({ name: env.icon + ' ' + env.name, value: env.spentTotal, color: tagColor(env.id, v.key) }); });
      shares.push({ name: 'Frais fixes payés', value: v.recurringFixedTotal, color: 'var(--warning)' });
      shares.push({ name: 'Hors budget', value: sumOf(expenses.filter(function (mv) { return !mv.envelopeId; })), color: 'var(--muted)' });
    }
    shares = shares.filter(function (s) { return s.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    var shareTotal = shares.reduce(function (s, x) { return s + x.value; }, 0);
    var tabs = [['budget', 'Budgets'], ['tag', 'Tags'], ['payment', 'Paiement']].map(function (t) {
      var sel = statsBy === t[0];
      return '<button type="button" class="seg-btn' + (sel ? ' sel' : '') + '" data-action="stats-by" data-val="' + t[0] + '" aria-pressed="' + sel + '">' + t[1] + '</button>';
    }).join('');
    var shareHtml = shares.length
      ? '<div class="stack-bar">' + shares.map(function (s) { return '<span style="flex-grow:' + (s.value / shareTotal * 100).toFixed(2) + ';background:' + s.color + '" title="' + esc(s.name) + '"></span>'; }).join('') + '</div>' +
        '<div class="share-list">' + shares.map(function (s) {
          return '<div class="share-row"><span class="dot" style="--c:' + s.color + '"></span><span class="share-name">' + esc(s.name) + '</span><b>' + fmt(s.value) + '</b><span class="share-pct">' + Math.round(s.value / shareTotal * 100) + ' %</span></div>';
        }).join('') + '</div>'
      : '<p class="empty-note">Aucune dépense ce mois-ci.</p>';

    // Tableaux détaillés (comme avant), repliés et défilables horizontalement.
    var head = months.map(function (x) { return '<th>' + MONTH_ABBREVS[parseInt(x.key.slice(5, 7), 10) - 1] + '</th>'; }).join('');
    var budgetsTable = st.recurring.envelopes.length ? '<h3 class="table-title">Budgets par mois</h3><div class="table-scroll"><table class="stat-table"><thead><tr><th>Budget</th>' + head + '<th>Total</th></tr></thead><tbody>' +
      st.recurring.envelopes.map(function (env) {
        var vals = months.map(function (x) { var b = x.envelopes.find(function (e) { return e.id === env.id; }); return b ? b.spentTotal : 0; });
        return '<tr><td>' + env.icon + ' ' + esc(env.name) + '</td>' + vals.map(function (n) { return '<td>' + fmt(n) + '</td>'; }).join('') + '<td><strong>' + fmt(vals.reduce(function (a, b) { return a + b; }, 0)) + '</strong></td></tr>';
      }).join('') + '</tbody></table></div>' : '';
    function tagMonthTotal(x, tagId) { return signedTotal(x.movements.filter(function (mv) { return tagId ? mv.tagId === tagId : !mv.tagId; })); }
    var tagsTable = st.recurring.tags.length ? '<h3 class="table-title">Tags par mois</h3><div class="table-scroll"><table class="stat-table"><thead><tr><th>Tag</th>' + head + '<th>Total</th></tr></thead><tbody>' +
      st.recurring.tags.map(function (t) { return { id: t.id, name: t.name }; }).concat([{ id: null, name: 'Sans tag' }]).map(function (t) {
        var vals = months.map(function (x) { return tagMonthTotal(x, t.id); });
        return '<tr><td>' + esc(t.name) + '</td>' + vals.map(function (n) { return '<td>' + fmt(n) + '</td>'; }).join('') + '<td><strong>' + fmt(vals.reduce(function (a, b) { return a + b; }, 0)) + '</strong></td></tr>';
      }).join('') + '</tbody></table></div>' : '';

    return '<h1 class="page-title">Statistiques ' + year + '</h1>' +
      '<section class="hero">' +
        '<div class="hero-top"><div><span class="hero-cap">Solde de l’année</span><span class="hero-amount' + (yearBalance < 0 ? ' neg' : '') + '">' + fmt(yearBalance) + '</span></div></div>' +
        '<div class="hero-stats two"><div><span>Revenus</span><b>' + fmt(yearIncome) + '</b></div><div><span>Dépenses</span><b>' + fmt(yearOutflow) + '</b></div></div>' +
      '</section>' +
      '<section class="card"><div class="block-head"><h2>Mois par mois</h2><span class="legend"><span class="dot" style="--c:var(--good-bright)"></span>revenus <span class="dot" style="--c:var(--accent)"></span>dépenses</span></div>' +
        '<div class="ychart">' + cols + '</div></section>' +
      '<section class="card"><div class="block-head"><h2>' + monthLabel(v.key) + '</h2><span class="muted-sm">dépenses ' + fmt(v.totalOutflow) + '</span></div>' +
        '<div class="seg-group">' + tabs + '</div>' + shareHtml + '</section>' +
      ((budgetsTable || tagsTable) ? '<details class="card fold" data-key="stats-tables"' + (openAccordions.has('stats-tables') ? ' open' : '') + '><summary class="fold-head">Tableaux détaillés' + svg('chevD', 18, 'chev') + '</summary>' + budgetsTable + tagsTable + '</details>' : '');
  }

  function renderSettingsPage(st, view, monthKey) {
    return '<h1 class="page-title">Réglages</h1><div class="page-stack settings">' +
      renderRecurringSummaryCard(view) +
      renderRecurringIncomeCard(view) +
      renderRecurringFixedCard(view) +
      renderEnvelopesConfigCard(view, monthKey) +
      renderTagsCard(st) +
      renderPaymentMethodsCard(st) +
      renderGeneralSettingsCard(st) +
      renderInstallCard() +
      renderAccountCard() +
      '</div>' +
      renderIconModal(st, view);
  }

  function renderRecurringSummaryCard(view) {
    var available = view.recurringIncomeTotal - view.recurringFixedDue - view.totalEnvelopeBudget;
    return '<div class="stats-row">' +
      stat('💵', 'Revenus', view.recurringIncomeTotal) +
      stat('🧾', 'Frais fixes', view.recurringFixedDue) +
      stat('📦', 'Budgets', view.totalEnvelopeBudget) +
      stat('✅', 'Disponible', available, available < 0 ? 'critical' : 'good') +
      '</div>';
  }

  function renderRecurringIncomeCard(view) {
    var items = view.incomeLines.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    var isOpen = openAccordions.has('settings-income');
    var html = '<section class="card"><details data-key="settings-income"' + (isOpen ? ' open' : '') + '><summary class="card-title">Revenus</summary><div class="settings-body"><div class="ledger">';
    html += items.length ? items.map(function (i) {
      return '<div class="ledger-row"><span class="ledger-name">' + esc(i.name) + '</span>' +
        '<input class="amount-input" type="number" step="0.01" min="0" value="' + i.amount + '" data-field="income-amount" data-id="' + i.id + '">' +
        '<button type="button" class="chip-btn" data-action="remove-income" data-id="' + i.id + '" aria-label="Supprimer ' + esc(i.name) + '">✕</button>' +
        '</div>';
    }).join('') : '<p class="empty-note">Aucun revenu récurrent pour l’instant.</p>';
    html += '</div>';
    html += '<form class="add-row" data-form="add-income">' +
      '<input type="text" name="name" placeholder="Salaire, allocations…" required maxlength="60">' +
      '<input type="number" name="amount" placeholder="Montant" step="0.01" min="0" required>' +
      '<button type="submit" class="btn-add">+ Ajouter</button></form>';
    html += '</div></details></section>';
    return html;
  }

  function renderRecurringFixedCard(view) {
    var items = view.fixedLines.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    var isOpen = openAccordions.has('settings-fixed');
    var html = '<section class="card"><details data-key="settings-fixed"' + (isOpen ? ' open' : '') + '><summary class="card-title">Frais fixes</summary><div class="settings-body"><div class="ledger">';
    html += items.length ? items.map(function (f) {
      return '<div class="ledger-row"><span class="ledger-name">' + esc(f.name) + '</span>' +
        '<input class="amount-input" type="number" step="0.01" min="0" value="' + f.amount + '" data-field="fixed-amount" data-id="' + f.id + '">' +
        '<button type="button" class="chip-btn" data-action="remove-fixed" data-id="' + f.id + '" aria-label="Supprimer ' + esc(f.name) + '">✕</button>' +
        '</div>';
    }).join('') : '<p class="empty-note">Aucune dépense fixe pour l’instant.</p>';
    html += '</div>';
    html += '<form class="add-row" data-form="add-fixed">' +
      '<input type="text" name="name" placeholder="Loyer, abonnements…" required maxlength="60">' +
      '<input type="number" name="amount" placeholder="Montant" step="0.01" min="0" required>' +
      '<button type="submit" class="btn-add">+ Ajouter</button></form>';
    html += '</div></details></section>';
    return html;
  }

  function renderEnvelopesConfigCard(view, monthKey) {
    var isOpen = openAccordions.has('settings-budgets');
    var html = '<section class="card"><details data-key="settings-budgets"' + (isOpen ? ' open' : '') + '><summary class="card-title">Budgets</summary><div class="settings-body">' +
      '<label class="weeks-control">Semaines ce mois-ci<input type="number" min="1" max="5" value="' + view.weeksCount + '" data-field="weeks-count"></label>' +
      '<div class="envelopes-grid">';
    html += view.envelopes.map(function (env) { return renderEnvelopeConfigCard(env, monthKey); }).join('');
    if (!view.envelopes.length) html += '<p class="empty-note">Aucun budget pour l’instant.</p>';
    html += renderAddEnvelopeTrigger();
    html += '</div></div></details></section>';
    html += renderAddEnvelopeModal();
    return html;
  }

  // Le sélecteur d'icône (budget ou mode de paiement) s'ouvre dans une modale
  // partagée plutôt qu'affiché en permanence dans chaque carte, pour ne pas
  // alourdir la vue : iconModalTarget vaut 'env-<id>', 'eph-<id>' ou 'pay-<id>',
  // ou null si aucune n'est ouverte.
  function renderIconModal(st, view) {
    if (!iconModalTarget) return '';
    if (iconModalTarget.indexOf('pay-') === 0) {
      var payId = iconModalTarget.slice(4);
      var pm = st.recurring.paymentMethods.find(function (p) { return p.id === payId; });
      if (!pm) return '';
      return '<dialog class="modal" id="icon-modal">' +
        '<div class="modal-form">' +
          '<h3 class="card-title">Icône de ' + esc(pm.name) + '</h3>' +
          renderPaymentIconGrid(pm.icon, payId) +
          '<div class="modal-actions"><button type="button" class="btn-secondary" data-action="close-icon-modal">Fermer</button></div>' +
        '</div>' +
      '</dialog>';
    }
    var isEph = iconModalTarget.indexOf('eph-') === 0;
    var id = iconModalTarget.slice(4);
    var env = view.envelopes.find(function (e) { return e.id === id; });
    if (!env) return '';
    return '<dialog class="modal" id="icon-modal">' +
      '<div class="modal-form">' +
        '<h3 class="card-title">Icône de ' + esc(env.name) + '</h3>' +
        renderIconGrid(env.icon, true, id, isEph) +
        '<div class="modal-actions"><button type="button" class="btn-secondary" data-action="close-icon-modal">Fermer</button></div>' +
      '</div>' +
    '</dialog>';
  }

  function renderEnvelopeConfigCard(env, monthKey) {
    var eph = !!env.ephemeral;
    var ephAttr = eph ? ' data-ephemeral="true"' : '';
    var weekRows = env.weeks.map(function (planned, idx) {
      var spent = env.spentByWeek[idx];
      var pct = planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : (spent > 0 ? 100 : 0);
      var over = spent > planned;
      var status = over ? 'critical' : (pct >= 80 ? 'warning' : 'good');
      return '<div class="week-row"><span class="week-label">Sem. ' + (idx + 1) + '</span>' +
        '<div class="week-bar-track"><div class="week-bar-fill week-' + status + '" style="width:' + pct + '%"></div></div>' +
        '<span class="week-figures"><span class="mono' + (over ? ' amount-critical' : '') + '">' + fmt(spent) + '</span> / <input type="number" step="0.01" class="amount-input amount-input-sm" value="' + planned + '" data-field="envelope-week-amount" data-id="' + env.id + '" data-week="' + idx + '"' + ephAttr + '>' +
        '</span></div>';
    }).join('');
    return '<article class="envelope-card' + (eph ? ' envelope-card-ephemeral' : '') + '"><div class="envelope-flap"></div><div class="envelope-body">' +
      '<div class="envelope-header"><span class="envelope-name">' +
        '<button type="button" class="budget-icon-lg icon-trigger" data-action="open-icon-modal" data-target="' + (eph ? 'eph-' : 'env-') + env.id + '" aria-label="Changer l’icône de ' + esc(env.name) + '">' + env.icon + '</button>' +
        '<input type="text" class="envelope-name-input" value="' + esc(env.name) + '" data-field="envelope-name" data-id="' + env.id + '"' + ephAttr + ' maxlength="40">' +
      '</span>' +
      (eph ? '<span class="tag-extra">Éphémère</span>' : '') +
      '<input type="color" class="color-picker" value="' + tagColor(env.id, monthKey) + '" data-field="envelope-color" data-id="' + env.id + '"' + ephAttr + ' aria-label="Couleur du budget ' + esc(env.name) + '">' +
      '<button type="button" class="palette-toggle" data-action="toggle-color-grid" data-target="env-' + env.id + '" aria-label="Palette de couleurs pour ' + esc(env.name) + '">🎨</button>' +
      '<button type="button" class="chip-btn" data-action="' + (eph ? 'remove-ephemeral-envelope' : 'remove-envelope') + '" data-id="' + env.id + '" aria-label="Supprimer ' + esc(env.name) + '">✕</button>' +
      '</div>' +
      (colorGridOpenFor === 'env-' + env.id ? renderColorGrid(tagColor(env.id, monthKey), eph ? 'set-ephemeral-envelope-color-swatch' : 'set-envelope-color-swatch', env.id) : '') +
      '<div class="envelope-amount-row"><span class="field-label">Budget du mois' + (eph ? ' (éphémère)' : '') + '</span>' +
      '<input type="number" step="0.01" min="0" class="amount-input" value="' + env.amount + '" data-field="envelope-amount" data-id="' + env.id + '"' + ephAttr + '></div>' +
      '<div class="week-list">' + weekRows + '</div>' +
      '</div></article>';
  }

  // Le formulaire de création d'un budget s'ouvre dans une modale plutôt qu'affiché
  // en permanence dans la grille (il contient une grille d'icônes complète, trop
  // lourde pour rester visible en continu).
  function renderAddEnvelopeTrigger() {
    return '<article class="envelope-card envelope-card-add">' +
      '<button type="button" class="btn-add" data-action="open-add-envelope-modal">+ Créer un budget</button>' +
      '</article>';
  }

  function renderAddEnvelopeModal() {
    if (!addEnvelopeModalOpen) return '';
    return '<dialog class="modal" id="add-envelope-modal">' +
      '<div class="modal-form">' +
        '<h3 class="card-title">Nouveau budget</h3>' +
        '<form data-form="add-envelope" class="add-envelope-form">' +
        renderIconGrid(ICONS[0], false, null) +
        '<input type="hidden" name="icon" id="icon-input-new" value="' + ICONS[0] + '">' +
        '<input type="text" name="name" placeholder="Nom du budget (Courses, Loisirs…)" required maxlength="40">' +
        '<input type="number" name="amount" placeholder="Budget mensuel" step="0.01" min="0" required>' +
        '<label class="fixed-check-row"><input type="checkbox" name="ephemeral"><span class="fixed-check-name">Uniquement pour ce mois-ci (éphémère)</span></label>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" data-action="close-add-envelope-modal">Annuler</button>' +
          '<button type="submit" class="btn-add">+ Créer un budget</button>' +
        '</div>' +
        '</form>' +
      '</div>' +
    '</dialog>';
  }

  function renderTagsCard(st) {
    var items = st.recurring.tags.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    var isOpen = openAccordions.has('settings-tags');
    var html = '<section class="card"><details data-key="settings-tags"' + (isOpen ? ' open' : '') + '><summary class="card-title">Tags</summary><div class="settings-body"><div class="tags-list">';
    html += items.length ? items.map(function (t) {
      var gridKey = 'tag-' + t.id;
      return '<span class="tag-chip" style="--tag-color:' + tagColor(t.id) + '">' +
        '<input type="color" class="tag-color-picker" value="' + tagColor(t.id) + '" data-field="tag-color" data-id="' + t.id + '" aria-label="Couleur du tag ' + esc(t.name) + '">' +
        '<button type="button" class="palette-toggle" data-action="toggle-color-grid" data-target="' + gridKey + '" aria-label="Palette de couleurs pour ' + esc(t.name) + '">🎨</button>' +
        '<input type="text" class="tag-name-input" value="' + esc(t.name) + '" data-field="tag-name" data-id="' + t.id + '" maxlength="30" size="' + Math.max(4, t.name.length) + '">' +
        '<button type="button" class="tag-remove" data-action="remove-tag" data-id="' + t.id + '" aria-label="Supprimer ' + esc(t.name) + '">✕</button>' +
        '</span>' +
        (colorGridOpenFor === gridKey ? renderColorGrid(tagColor(t.id), 'set-tag-color-swatch', t.id) : '');
    }).join('') : '<p class="empty-note">Aucun tag pour l’instant.</p>';
    html += '</div>';
    html += '<form class="add-row" data-form="add-tag">' +
      '<input type="text" name="name" placeholder="Alimentation, cadeaux…" required maxlength="30">' +
      '<button type="submit" class="btn-add">+ Ajouter</button></form>';
    html += '</div></details></section>';
    return html;
  }

  function renderPaymentIconGrid(selectedIcon, id) {
    return '<div class="icon-grid">' + ICONS.map(function (ic) {
      var sel = ic === selectedIcon;
      return '<button type="button" class="icon-choice' + (sel ? ' selected' : '') + '" data-action="set-payment-icon" data-id="' + id + '" data-icon="' + ic + '">' + ic + '</button>';
    }).join('') + '</div>';
  }

  function renderPaymentMethodsCard(st) {
    var items = st.recurring.paymentMethods;
    var isOpen = openAccordions.has('settings-payment-methods');
    var defaultId = st.settings.defaultPaymentMethodId;
    var html = '<section class="card"><details data-key="settings-payment-methods"' + (isOpen ? ' open' : '') + '><summary class="card-title">Modes de paiement</summary><div class="settings-body"><div class="ledger">';
    html += items.length ? items.map(function (p) {
      return '<div class="ledger-row payment-method-row">' +
        '<button type="button" class="budget-icon-lg icon-trigger" data-action="open-icon-modal" data-target="pay-' + p.id + '" aria-label="Changer l’icône de ' + esc(p.name) + '">' + p.icon + '</button>' +
        '<input type="text" class="payment-method-name-input" value="' + esc(p.name) + '" data-field="payment-method-name" data-id="' + p.id + '" maxlength="30">' +
        '<label class="payment-default-label"><input type="radio" name="default-payment-method" data-field="default-payment-method" value="' + p.id + '" ' + (p.id === defaultId ? 'checked' : '') + '> Par défaut</label>' +
        '<button type="button" class="chip-btn" data-action="remove-payment-method" data-id="' + p.id + '" aria-label="Supprimer ' + esc(p.name) + '">✕</button>' +
        '</div>';
    }).join('') : '<p class="empty-note">Aucun mode de paiement pour l’instant.</p>';
    html += '</div>';
    html += '<form class="add-row" data-form="add-payment-method">' +
      '<input type="text" name="name" placeholder="Cash, Carte, Compte…" required maxlength="30">' +
      '<button type="submit" class="btn-add">+ Ajouter</button></form>';
    html += '</div></details></section>';
    return html;
  }

  var WEEKDAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

  function renderGeneralSettingsCard(st) {
    var currentStart = weekStartDay();
    var dayOptions = [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      return '<option value="' + d + '"' + (d === currentStart ? ' selected' : '') + '>' + WEEKDAY_NAMES[d] + '</option>';
    }).join('');
    var isOpen = openAccordions.has('settings-general');
    return '<section class="card"><details data-key="settings-general"' + (isOpen ? ' open' : '') + '><summary class="card-title">Général</summary>' +
      '<div class="settings-body">' +
      '<p class="empty-note">Chaque mois repart de zéro : aucun solde n’est reporté d’un mois sur l’autre.</p>' +
      '<label class="weeks-control">Jour de démarrage de la semaine<select data-field="week-start-day">' + dayOptions + '</select></label>' +
      '<button type="button" class="btn-danger" data-action="reset-all">Réinitialiser toutes les données</button>' +
      '</div></details></section>';
  }

  // --- Installation de l'app (PWA) ---
  // Invite du navigateur quand il en propose une (Chrome Android / PC), sinon marche à
  // suivre (iPhone : Safari > Partager). Rien n'est affiché si l'app tourne installée.
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; if (booted) safeRender(); });
  window.addEventListener('appinstalled', function () { installPrompt = null; showToast('App installée sur l’écran d’accueil.'); if (booted) safeRender(); });
  function isInstalled() {
    return ['standalone', 'fullscreen', 'minimal-ui'].some(function (m) { return window.matchMedia('(display-mode: ' + m + ')').matches; }) || navigator.standalone === true;
  }
  function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isAndroid() { return /android/i.test(navigator.userAgent); }
  function installHidden() { try { return localStorage.getItem('fee-lezcomptes-install-hidden') === '1'; } catch (e) { return false; } }
  function setInstallHidden() { try { localStorage.setItem('fee-lezcomptes-install-hidden', '1'); } catch (e) {} }

  function renderInstallBanner() {
    if (isInstalled() || installHidden()) return '';
    return '<div class="install-banner card">' +
      '<img src="' + BASE + '/icon-192.png" alt="" width="36" height="36">' +
      '<button type="button" class="install-banner-main" data-action="install"><b>Installer l’app</b><span>Icône sur l’écran d’accueil, ajout rapide d’un mouvement, marche sans réseau</span></button>' +
      '<button type="button" class="icon-btn" data-action="install-hide" aria-label="Masquer">✕</button>' +
      '</div>';
  }
  function renderInstallCard() {
    var isOpen = openAccordions.has('settings-install');
    return '<section class="card"><details data-key="settings-install"' + (isOpen ? ' open' : '') + '><summary class="card-title">Application</summary>' +
      '<div class="settings-body">' +
      (isInstalled()
        ? '<p class="empty-note">✓ L’app est installée sur cet appareil. Appui long sur son icône → « Nouveau mouvement ».</p>'
        : '<p class="empty-note">Installe Fée Lezcomptes sur l’écran d’accueil : elle s’ouvre comme une app, marche sans réseau, et un appui long sur l’icône permet d’ajouter directement un mouvement.</p>' +
          '<button type="button" class="btn-add" data-action="install">📲 Installer l’app</button>') +
      '</div></details></section>';
  }
  function installStep(n, html) { return '<li><span class="install-step-num">' + n + '</span><span>' + html + '</span></li>'; }
  function renderInstallDialog() {
    var safari = isIos() && !/crios|fxios|edgios/i.test(navigator.userAgent);
    var steps = isIos()
      ? (safari ? '' : installStep(0, 'Ouvre cette page dans <b>Safari</b> (sur iPhone, seul Safari sait installer une app web).')) +
        installStep(1, 'Touche le bouton <b>Partager</b> (carré avec une flèche vers le haut).') +
        installStep(2, 'Choisis <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.')
      : isAndroid()
        ? installStep(1, 'Ouvre le menu <b>⋮</b> de Chrome.') + installStep(2, 'Choisis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.')
        : installStep(1, 'Dans Chrome ou Edge : icône d’installation <b>⊕</b> à droite de la barre d’adresse.') +
          installStep(2, 'Sur téléphone, ouvre plutôt cette adresse dans Chrome :<br><code>' + esc(location.origin + BASE + '/') + '</code>');
    return '<dialog class="modal" id="install-dialog"><div class="modal-form">' +
      '<h3 class="card-title">📲 Installer l’app</h3>' +
      '<ol class="install-steps">' + steps + '</ol>' +
      '<div class="modal-actions"><button type="button" class="btn-secondary" data-action="install-close">Fermer</button></div>' +
      '</div></dialog>';
  }
  function startInstall() {
    if (installPrompt) {
      var p = installPrompt;
      installPrompt = null;
      p.prompt();
      p.userChoice.then(function (r) {
        if (!r || r.outcome !== 'accepted') showToast('Installation annulée : tu pourras la relancer depuis les réglages.');
        safeRender();
      }).catch(function () {});
      return;
    }
    var dlg = document.getElementById('install-dialog');
    if (dlg) dlg.showModal();
  }

  function renderAccountCard() {
    var isOpen = openAccordions.has('settings-account');
    return '<section class="card"><details data-key="settings-account"' + (isOpen ? ' open' : '') + '><summary class="card-title">Compte</summary>' +
      '<div class="settings-body">' +
      '<p class="empty-note">Le mot de passe est stocké haché côté serveur — il ne peut plus être affiché en clair.</p>' +
      '<form class="settings-form" data-form="change-username">' +
        '<label>Identifiant<input type="text" name="username" value="' + esc(currentUsername) + '" required></label>' +
        '<button type="submit" class="btn-add">Mettre à jour</button>' +
      '</form>' +
      '<form class="settings-form" data-form="change-password">' +
        '<label>Mot de passe actuel<input type="password" name="currentPassword" required autocomplete="current-password"></label>' +
        '<label>Nouveau mot de passe<input type="password" name="newPassword" required minlength="8" autocomplete="new-password"></label>' +
        '<button type="submit" class="btn-add">Changer le mot de passe</button>' +
      '</form>' +
      (accountMessage ? '<p class="' + (accountError ? 'login-error' : 'empty-note') + '">' + esc(accountMessage) + '</p>' : '') +
      '<button type="button" class="btn-secondary" data-action="logout">Se déconnecter</button>' +
      '</div></details></section>';
  }

  function openMovementSheet() {
    var dlg = document.getElementById('movement-modal');
    if (!dlg) return;
    dlg.classList.remove('instant');
    dlg.showModal();
    var amount = dlg.querySelector('input[name="amount"]');
    if (amount && !editingMovementId) setTimeout(function () { amount.focus(); }, 60);
  }
  function deleteMovementWithUndo(id) {
    var key = findMovementMonthKey(id);
    var mv = key && state.months[key].movements.find(function (x) { return x.id === id; });
    if (!mv) return;
    var copy = clone(mv);
    revealedMovementId = null;
    mutate(function () { removeMovement(selectedMonthKey, id); });
    showToast('« ' + copy.label + ' » supprimé', 'Annuler', function () {
      mutate(function () { ensureMonth(key).movements.push(copy); });
    });
  }

  // --- event delegation ---
  function onClick(e) {
    if (e.target.tagName === 'DIALOG') {
      if (e.target.id === 'confirm-dialog') pendingConfirmAction = null;
      if (e.target.id === 'icon-modal') iconModalTarget = null;
      if (e.target.id === 'add-envelope-modal') addEnvelopeModalOpen = false;
      if (e.target.id === 'movement-modal') editingMovementId = null;
      if (openSheet === e.target.id) openSheet = null;
      e.target.close();
      return;
    }
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    if (action === 'prev-month') { navigateMonth(-1); return; }
    if (action === 'next-month') { navigateMonth(1); return; }
    if (action === 'nav-dashboard') { navigatePage('dashboard'); return; }
    if (action === 'nav-stats') { navigatePage('stats'); return; }
    if (action === 'nav-settings') { navigatePage(currentPage === 'settings' ? 'dashboard' : 'settings'); return; }
    if (action === 'nav-movements') { navigatePage('movements'); return; }
    if (action === 'nav-fixed') { navigatePage('fixed'); return; }
    if (action === 'sync-now') {
      if (!online || dirty) { syncNow(); pullState(); showToast(online ? 'Envoi en cours…' : 'Toujours hors ligne : les modifications restent sur l’appareil.'); }
      else { pullState(); showToast('Budget à jour.'); }
      return;
    }
    if (action === 'pick-week') { selectedWeekIdx = parseInt(btn.dataset.idx, 10); revealedMovementId = null; render(); return; }
    if (action === 'toggle-info') { infoOpen[btn.dataset.key] = !infoOpen[btn.dataset.key]; render(); return; }
    if (action === 'budget-mode') { budgetMode = btn.dataset.mode === 'month' ? 'month' : 'week'; render(); return; }
    if (action === 'toggle-all-budgets') { showAllBudgets = !showAllBudgets; render(); return; }
    if (action === 'next-budget') {
      var envIds = computeMonthView(state, selectedMonthKey, {}).envelopes.map(function (en) { return en.id; });
      if (envIds.length) budgetDetailId = envIds[(envIds.indexOf(budgetDetailId) + 1) % envIds.length];
      render();
      return;
    }
    if (action === 'toggle-movement') {
      var mvId = btn.dataset.id;
      revealedMovementId = revealedMovementId === mvId ? null : mvId;
      document.querySelectorAll('.mv').forEach(function (row) {
        var on = row.dataset.id === revealedMovementId;
        row.classList.toggle('open', on);
        row.querySelector('.mv-row').setAttribute('aria-expanded', on);
        row.querySelectorAll('.mv-actions button').forEach(function (b) { b.tabIndex = on ? 0 : -1; });
      });
      return;
    }
    if (action === 'goto-settings') {
      openAccordions.clear();
      if (btn.dataset.section) openAccordions.add(btn.dataset.section);
      navigatePage('settings');
      return;
    }
    if (action === 'toggle-fixed') { mutate(function () { toggleFixedPaid(selectedMonthKey, btn.dataset.id); }); return; }
    if (action === 'stats-month') { statsMonthKey = btn.dataset.key; render(); return; }
    if (action === 'stats-by') { statsBy = btn.dataset.val; render(); return; }
    if (action === 'open-filter-sheet') { render(); openDialog('filter-sheet'); return; }
    if (action === 'open-view-sheet') { render(); openDialog('view-sheet'); return; }
    if (action === 'close-sheet') { closeDialog(btn.dataset.id); render(); return; }
    if (action === 'set-filter') {
      var fk = btn.dataset.key, fv = btn.dataset.val;
      if (fk === 'type') movementTypeFilter = fv;
      if (fk === 'envelope') filterEnvelopeId = filterEnvelopeId === fv ? null : fv;
      if (fk === 'tag') filterTagId = filterTagId === fv ? null : fv;
      if (fk === 'payment') filterPaymentId = filterPaymentId === fv ? null : fv;
      render();
      return;
    }
    if (action === 'clear-filter') {
      var ck = btn.dataset.key;
      if (ck === 'type') movementTypeFilter = 'all';
      if (ck === 'envelope') filterEnvelopeId = null;
      if (ck === 'tag') filterTagId = null;
      if (ck === 'payment') filterPaymentId = null;
      render();
      return;
    }
    if (action === 'clear-filters') {
      movementSearchQuery = ''; movementTypeFilter = 'all'; filterEnvelopeId = null; filterTagId = null; filterPaymentId = null;
      render();
      return;
    }
    if (action === 'set-view') {
      movementGroupBy = btn.dataset.val;
      Array.from(openAccordions).forEach(function (k) { if (k.indexOf('grp-') === 0) openAccordions.delete(k); });
      closeDialog('view-sheet');
      render();
      return;
    }
    if (action === 'pick-quick') { setSheetSelection(btn.dataset.kind, btn.dataset.id || null); return; }
    if (action === 'open-picker') { openPicker(btn.dataset.kind); var ps = document.querySelector('[data-picker-search]'); if (ps && !('ontouchstart' in window)) ps.focus(); return; }
    if (action === 'close-picker') { document.getElementById('picker-sheet').close(); return; }
    if (action === 'picker-choose') { setSheetSelection(btn.dataset.kind, btn.dataset.id || null); document.getElementById('picker-sheet').close(); return; }
    if (action === 'picker-create') { setSheetSelection('tag', '__new_tag__', btn.dataset.name); document.getElementById('picker-sheet').close(); return; }
    if (action === 'prev-year') { navigateYear(-1); return; }
    if (action === 'next-year') { navigateYear(1); return; }
    if (action === 'open-filter-modal') { render(); var dlgF = document.getElementById('filter-modal'); if (dlgF) dlgF.showModal(); return; }
    if (action === 'reset-filter') { movementSearchQuery = ''; movementTypeFilter = 'all'; render(); return; }
    if (action === 'group-week') { movementGroupBy = 'week'; render(); return; }
    if (action === 'group-budget') { movementGroupBy = 'budget'; render(); return; }
    if (action === 'group-tag') { movementGroupBy = 'tag'; render(); return; }
    if (action === 'group-payment') { movementGroupBy = 'payment'; render(); return; }
    if (action === 'open-budget') {
      budgetDetailId = btn.dataset.id;
      navigatePage('budget');
      return;
    }
    if (action === 'logout') {
      if (dirty) { showToast('Des modifications ne sont pas encore envoyées au serveur : attends le retour du réseau.'); return; }
      apiFetch('/api/logout', { method: 'POST' }).then(function () {
        isAuthenticated = false;
        clearInterval(pollTimer);
        pollTimer = null;
        clearLocal();
        state = null; baseState = null; baseVersion = null;
        render();
      }).catch(function () { showToast('Pas de réseau : déconnexion impossible pour l’instant.'); });
      return;
    }
    if (action === 'install') { startInstall(); return; }
    if (action === 'install-close') { var dlgI = document.getElementById('install-dialog'); if (dlgI) dlgI.close(); return; }
    if (action === 'install-hide') { setInstallHidden(); render(); return; }
    if (action === 'confirm-yes') {
      var confirmDlg = document.getElementById('confirm-dialog');
      if (confirmDlg) confirmDlg.close();
      var fn = pendingConfirmAction;
      pendingConfirmAction = null;
      pendingConfirmExtra = null;
      if (fn) fn();
      return;
    }
    if (action === 'confirm-extra') {
      var confirmDlgX = document.getElementById('confirm-dialog');
      if (confirmDlgX) confirmDlgX.close();
      var fnX = pendingConfirmExtra && pendingConfirmExtra.action;
      pendingConfirmAction = null;
      pendingConfirmExtra = null;
      if (fnX) fnX();
      return;
    }
    if (action === 'confirm-no') {
      pendingConfirmAction = null;
      pendingConfirmExtra = null;
      var confirmDlg2 = document.getElementById('confirm-dialog');
      if (confirmDlg2) confirmDlg2.close();
      return;
    }
    if (action === 'open-movement-modal') { editingMovementId = null; revealedMovementId = null; render(); openMovementSheet(); return; }
    if (action === 'close-movement-modal') { editingMovementId = null; var dlg2 = document.getElementById('movement-modal'); if (dlg2) dlg2.close(); return; }
    if (action === 'edit-movement') {
      editingMovementId = btn.dataset.id;
      revealedMovementId = null;
      render();
      openMovementSheet();
      return;
    }
    if (action === 'delete-movement') { deleteMovementWithUndo(btn.dataset.id); return; }
    if (action === 'pick-icon') {
      var grid = btn.closest('.icon-grid');
      var hiddenInput = document.getElementById('icon-input-new');
      if (hiddenInput) hiddenInput.value = btn.dataset.icon;
      if (grid) {
        grid.querySelectorAll('.icon-choice').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
      }
      return;
    }
    if (action === 'toggle-color-grid') {
      var target = btn.dataset.target;
      colorGridOpenFor = (colorGridOpenFor === target) ? null : target;
      render();
      return;
    }
    if (action === 'open-icon-modal') {
      iconModalTarget = btn.dataset.target;
      render();
      var dlgIcon = document.getElementById('icon-modal');
      if (dlgIcon) dlgIcon.showModal();
      return;
    }
    if (action === 'close-icon-modal') {
      iconModalTarget = null;
      var dlgIcon2 = document.getElementById('icon-modal');
      if (dlgIcon2) dlgIcon2.close();
      return;
    }
    if (action === 'open-add-envelope-modal') {
      addEnvelopeModalOpen = true;
      render();
      var dlgAddEnv = document.getElementById('add-envelope-modal');
      if (dlgAddEnv) dlgAddEnv.showModal();
      return;
    }
    if (action === 'close-add-envelope-modal') {
      addEnvelopeModalOpen = false;
      var dlgAddEnv2 = document.getElementById('add-envelope-modal');
      if (dlgAddEnv2) dlgAddEnv2.close();
      return;
    }
    if (action === 'reset-all') {
      requestConfirm('Réinitialiser toutes les données du budget ? Cette action est irréversible.', function () {
        state = defaultState();
        selectedMonthKey = currentMonthKey();
        commit();
      });
      return;
    }
    var id = btn.dataset.id;
    switch (action) {
      case 'remove-income':
        requestConfirm(
          'Supprimer ce revenu seulement pour ' + monthLabel(selectedMonthKey) + ', ou aussi pour les mois suivants ?',
          function () { mutate(function () { endIncome(selectedMonthKey, id); }); },
          null,
          { label: 'Ce mois', action: function () { mutate(function () { removeIncomeThisMonth(selectedMonthKey, id); }); } },
          'Tous'
        );
        break;
      case 'remove-fixed':
        requestConfirm(
          'Supprimer cette dépense fixe seulement pour ' + monthLabel(selectedMonthKey) + ', ou aussi pour les mois suivants ?',
          function () { mutate(function () { endFixed(selectedMonthKey, id); }); },
          null,
          { label: 'Ce mois', action: function () { mutate(function () { removeFixedThisMonth(selectedMonthKey, id); }); } },
          'Tous'
        );
        break;
      case 'remove-envelope':
        requestConfirm(
          'Supprimer ce budget seulement pour ' + monthLabel(selectedMonthKey) + ', ou aussi pour les mois suivants ?',
          function () { mutate(function () { endEnvelope(selectedMonthKey, id); }); },
          null,
          { label: 'Ce mois', action: function () { mutate(function () { removeEnvelopeThisMonth(selectedMonthKey, id); }); } },
          'Tous'
        );
        break;
      case 'set-envelope-icon': mutate(function () { setEnvelopeIcon(id, btn.dataset.icon); iconModalTarget = null; }); break;
      case 'set-envelope-color-swatch': mutate(function () { setEnvelopeColor(id, btn.dataset.color); colorGridOpenFor = null; }); break;
      case 'remove-ephemeral-envelope': mutate(function () { removeEphemeralEnvelope(selectedMonthKey, id); }); break;
      case 'set-ephemeral-envelope-icon': mutate(function () { setEphemeralEnvelopeIcon(selectedMonthKey, id, btn.dataset.icon); iconModalTarget = null; }); break;
      case 'set-ephemeral-envelope-color-swatch': mutate(function () { setEphemeralEnvelopeColor(selectedMonthKey, id, btn.dataset.color); colorGridOpenFor = null; }); break;
      case 'remove-tag': mutate(function () { removeTag(id); }); break;
      case 'set-tag-color-swatch': mutate(function () { setTagColor(id, btn.dataset.color); colorGridOpenFor = null; }); break;
      case 'remove-payment-method': mutate(function () { removePaymentMethod(id); }); break;
      case 'set-payment-icon': mutate(function () { setPaymentMethodIcon(id, btn.dataset.icon); iconModalTarget = null; }); break;
      case 'remove-movement':
        requestConfirm('Supprimer ce mouvement ?', function () {
          if (editingMovementId === id) editingMovementId = null;
          mutate(function () { removeMovement(selectedMonthKey, id); });
        });
        break;
    }
  }

  function onChange(e) {
    var el = e.target;
    var field = el.dataset.field;
    if (!field) return;
    if (field === 'stats-col') {
      statsCols[el.dataset.col] = el.checked;
      render();
      stashUi();
      return;
    }
    if (field === 'mv-type') {
      var mvForm = el.closest('form');
      if (!mvForm) return;
      // Nouveau mouvement : un revenu n'est rattaché à aucun budget par défaut (sinon il
      // deviendrait un remboursement) ; une dépense reprend le budget le plus utilisé.
      if (!mvForm.elements.movementId) {
        mvForm.elements.envelopeId.value = el.value === 'income' ? '' : (defaultEnvelopeId(computeMonthView(state, selectedMonthKey, {})) || '');
      }
      refreshSheetChips(mvForm);
      return;
    }
    if (field === 'movement-tag-select') {
      // Pas de render() ici : la modale de mouvement perdrait sa saisie en cours
      // (voir requestConfirm plus haut, qui referme explicitement cette modale
      // avant de re-render pour la même raison).
      var form = el.closest('form');
      var newTagInput = form && form.querySelector('[name="newTagName"]');
      if (newTagInput) {
        var showNewTag = el.value === '__new_tag__';
        newTagInput.hidden = !showNewTag;
        if (showNewTag) newTagInput.focus();
      }
      return;
    }
    var id = el.dataset.id;
    if (field === 'fixed-paid') {
      mutate(function () { toggleFixedPaid(selectedMonthKey, id); });
      return;
    }
    var isEphemeral = el.dataset.ephemeral === 'true';
    if (field === 'envelope-name') {
      if (isEphemeral) {
        mutate(function () { renameEphemeralEnvelope(selectedMonthKey, id, el.value.trim() || 'Budget'); });
      } else {
        mutate(function () { renameEnvelope(id, el.value.trim() || 'Budget'); });
      }
      return;
    }
    if (field === 'envelope-color') {
      if (isEphemeral) {
        mutate(function () { setEphemeralEnvelopeColor(selectedMonthKey, id, el.value); });
      } else {
        mutate(function () { setEnvelopeColor(id, el.value); });
      }
      return;
    }
    if (field === 'tag-name') {
      mutate(function () { renameTag(id, el.value.trim() || 'Tag'); });
      return;
    }
    if (field === 'tag-color') {
      mutate(function () { setTagColor(id, el.value); });
      return;
    }
    if (field === 'payment-method-name') {
      mutate(function () { renamePaymentMethod(id, el.value.trim() || 'Mode de paiement'); });
      return;
    }
    if (field === 'default-payment-method') {
      mutate(function () { setDefaultPaymentMethod(el.value); });
      return;
    }
    if (field === 'envelope-amount') {
      var amountValue = parseFloat(el.value);
      if (Number.isNaN(amountValue)) return;
      if (isEphemeral) {
        mutate(function () { setEphemeralEnvelopeAmount(selectedMonthKey, id, amountValue); });
        return;
      }
      var amountTargets = futureMonthsWithSameWeeks(selectedMonthKey);
      if (!amountTargets.length) {
        mutate(function () { setMonthEnvelopeAmount(selectedMonthKey, id, amountValue); });
        return;
      }
      // On applique le changement de suite (le champ doit refléter la saisie), mais on
      // retarde la publication tant que l'utilisateur n'a pas répondu à la question de
      // répercussion : publier tout de suite provoquerait le rechargement de cette vue
      // (déclenché par la plateforme sur toute publication), qui fermerait la modale de
      // confirmation avant que l'utilisateur ait pu y répondre — quel que soit son choix
      // (ou même s'il ne répond pas), la publication a lieu une fois la modale fermée.
      setMonthEnvelopeAmount(selectedMonthKey, id, amountValue);
      render();
      setTimeout(function () {
        requestConfirm(
          'Répercuter ce montant (' + fmt(amountValue) + ') sur les ' + amountTargets.length + ' mois suivants ayant le même nombre de semaines ?',
          function () { amountTargets.forEach(function (k) { setMonthEnvelopeAmount(k, id, amountValue); }); commit(); },
          commit
        );
      }, 0);
      return;
    }
    if (field === 'envelope-week-amount') {
      var weekIdx = parseInt(el.dataset.week, 10);
      var weekValue = parseFloat(el.value);
      if (Number.isNaN(weekValue)) return;
      var weekTargets = isEphemeral ? [] : futureMonthsWithSameWeeks(selectedMonthKey);
      if (!weekTargets.length) {
        mutate(function () { setEnvelopeWeekAmount(selectedMonthKey, id, weekIdx, weekValue, isEphemeral); });
        return;
      }
      // Voir le commentaire équivalent ci-dessus pour 'envelope-amount'.
      setEnvelopeWeekAmount(selectedMonthKey, id, weekIdx, weekValue, isEphemeral);
      render();
      setTimeout(function () {
        requestConfirm(
          'Répercuter ce montant (' + fmt(weekValue) + ') sur les ' + weekTargets.length + ' mois suivants ayant le même nombre de semaines ?',
          function () { weekTargets.forEach(function (k) { setEnvelopeWeekAmount(k, id, weekIdx, weekValue, isEphemeral); }); commit(); },
          commit
        );
      }, 0);
      return;
    }
    if (field === 'income-amount') {
      var incomeAmountValue = parseFloat(el.value);
      if (Number.isNaN(incomeAmountValue)) return;
      var incomeTargets = futureMonths(selectedMonthKey);
      if (!incomeTargets.length) {
        mutate(function () { setMonthIncomeAmount(selectedMonthKey, id, incomeAmountValue); });
        return;
      }
      // Voir le commentaire équivalent plus haut pour 'envelope-amount'.
      setMonthIncomeAmount(selectedMonthKey, id, incomeAmountValue);
      render();
      setTimeout(function () {
        requestConfirm(
          'Répercuter ce montant (' + fmt(incomeAmountValue) + ') sur les ' + incomeTargets.length + ' mois suivants ?',
          function () { incomeTargets.forEach(function (k) { setMonthIncomeAmount(k, id, incomeAmountValue); }); commit(); },
          commit
        );
      }, 0);
      return;
    }
    if (field === 'fixed-amount') {
      var fixedAmountValue = parseFloat(el.value);
      if (Number.isNaN(fixedAmountValue)) return;
      var fixedTargets = futureMonths(selectedMonthKey);
      if (!fixedTargets.length) {
        mutate(function () { setMonthFixedAmount(selectedMonthKey, id, fixedAmountValue); });
        return;
      }
      // Voir le commentaire équivalent plus haut pour 'envelope-amount'.
      setMonthFixedAmount(selectedMonthKey, id, fixedAmountValue);
      render();
      setTimeout(function () {
        requestConfirm(
          'Répercuter ce montant (' + fmt(fixedAmountValue) + ') sur les ' + fixedTargets.length + ' mois suivants ?',
          function () { fixedTargets.forEach(function (k) { setMonthFixedAmount(k, id, fixedAmountValue); }); commit(); },
          commit
        );
      }, 0);
      return;
    }
    var value = parseFloat(el.value);
    if (Number.isNaN(value)) return;
    switch (field) {
      case 'weeks-count': mutate(function () { setWeeksCount(selectedMonthKey, value); }); break;
      case 'week-start-day': mutate(function () { setWeekStartDay(value); }); break;
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var type = form.dataset.form;
    var fd = new FormData(form);

    if (type === 'movement-filter') {
      movementSearchQuery = (fd.get('query') || '').toString();
      movementTypeFilter = (fd.get('type') || 'all').toString();
      render();
      return;
    }

    if (type === 'login') {
      var u = (fd.get('username') || '').toString().trim();
      var p = (fd.get('password') || '').toString();
      var remember = fd.get('remember') === 'on';
      apiFetch('/api/login', { method: 'POST', body: { username: u, password: p, remember: remember } })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
          if (res.ok) {
            loginError = '';
            isAuthenticated = true;
            currentUsername = res.data.username || u;
            return loadStateAndRender();
          }
          loginError = (res.data && res.data.error) || 'Identifiant ou mot de passe incorrect.';
          render();
        })
        .catch(function () {
          loginError = 'Erreur de connexion au serveur.';
          render();
        });
      return;
    }

    if (type === 'change-username') {
      var newUsername = (fd.get('username') || '').toString().trim();
      apiFetch('/api/account/username', { method: 'POST', body: { username: newUsername } })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
          if (res.ok) {
            currentUsername = res.data.username;
            accountMessage = 'Identifiant mis à jour.';
            accountError = false;
          } else {
            accountMessage = (res.data && res.data.error) || "Impossible de mettre à jour l'identifiant.";
            accountError = true;
          }
          render();
        })
        .catch(function () {
          accountMessage = 'Erreur de connexion au serveur.';
          accountError = true;
          render();
        });
      return;
    }

    if (type === 'change-password') {
      var currentPassword = (fd.get('currentPassword') || '').toString();
      var newPassword = (fd.get('newPassword') || '').toString();
      apiFetch('/api/account/password', { method: 'POST', body: { currentPassword: currentPassword, newPassword: newPassword } })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
          if (res.ok) {
            accountMessage = 'Mot de passe changé.';
            accountError = false;
          } else {
            accountMessage = (res.data && res.data.error) || 'Impossible de changer le mot de passe.';
            accountError = true;
          }
          render();
        })
        .catch(function () {
          accountMessage = 'Erreur de connexion au serveur.';
          accountError = true;
          render();
        });
      return;
    }

    if (type === 'add-income') {
      var name = (fd.get('name') || '').toString().trim();
      var amount = parseFloat(fd.get('amount'));
      if (name && !Number.isNaN(amount)) mutate(function () { addIncome(name, amount, selectedMonthKey); });
    } else if (type === 'add-fixed') {
      name = (fd.get('name') || '').toString().trim();
      amount = parseFloat((fd.get('amount') || '').toString().replace(',', '.'));
      if (name && !Number.isNaN(amount)) mutate(function () { addFixed(name, amount, selectedMonthKey); });
    } else if (type === 'add-envelope') {
      name = (fd.get('name') || '').toString().trim();
      amount = parseFloat(fd.get('amount'));
      var icon = (fd.get('icon') || '').toString() || DEFAULT_ICON;
      var isEphemeralNew = fd.get('ephemeral') === 'on';
      if (name && !Number.isNaN(amount)) {
        if (isEphemeralNew) {
          mutate(function () { addEphemeralEnvelope(selectedMonthKey, name, amount, icon); addEnvelopeModalOpen = false; });
        } else {
          mutate(function () { addEnvelope(name, amount, icon); addEnvelopeModalOpen = false; });
        }
      }
    } else if (type === 'add-tag') {
      name = (fd.get('name') || '').toString().trim();
      if (name) mutate(function () { addTag(name); });
    } else if (type === 'add-payment-method') {
      name = (fd.get('name') || '').toString().trim();
      var defaultIcons = ['💵', '💳', '🏦'];
      var newIcon = defaultIcons[state.recurring.paymentMethods.length % defaultIcons.length];
      if (name) mutate(function () { addPaymentMethod(name, newIcon); });
    } else if (type === 'add-movement') {
      clearFieldErrors(form);
      var date = (fd.get('date') || '').toString() || todayISO();
      var mtype = (fd.get('type') || 'expense').toString();
      var envelopeId = (fd.get('envelopeId') || '').toString() || null;
      var tagId = (fd.get('tagId') || '').toString() || null;
      var newTagName = (fd.get('newTagName') || '').toString().trim();
      var paymentMethodId = (fd.get('paymentMethodId') || '').toString() || null;
      var label = (fd.get('label') || '').toString().trim();
      amount = parseFloat((fd.get('amount') || '').toString().replace(/\s/g, '').replace(',', '.'));
      var movementId = (fd.get('movementId') || '').toString() || null;
      if (!label) {
        var labelEnv = envelopeId && computeMonthView(state, selectedMonthKey, {}).envelopes.find(function (en) { return en.id === envelopeId; });
        label = mtype === 'income' ? (labelEnv ? 'Remboursement ' + labelEnv.name : 'Revenu') : (labelEnv ? labelEnv.name : 'Dépense');
      }

      var invalidFields = [];
      if (Number.isNaN(amount) || amount <= 0) invalidFields.push('amount');
      if (invalidFields.length) {
        invalidFields.forEach(function (f) { markFieldError(form, f); });
        var firstInvalid = form.querySelector('[name="' + invalidFields[0] + '"]');
        if (firstInvalid) firstInvalid.focus();
        showToast('Indique un montant.');
        return;
      }

      closeDialog('movement-modal');
      editingMovementId = null;
      mutate(function () {
        if (tagId === '__new_tag__') tagId = newTagName ? addTag(newTagName) : null;
        if (movementId) {
          updateMovement(selectedMonthKey, movementId, date, mtype, label, amount, envelopeId, tagId, paymentMethodId);
        } else {
          addMovement(selectedMonthKey, date, mtype, label, amount, envelopeId, tagId, paymentMethodId);
        }
      });
      var shownKey = movementMonthKey(state, { date: date, envelopeId: envelopeId }, selectedMonthKey);
      if (shownKey !== selectedMonthKey) showToast('Mouvement du ' + formatDateShort(date) + ' rangé dans ' + monthLabel(shownKey) + '.');
      else showToast(!online ? 'Gardé sur l’appareil · envoi au retour du réseau' : (movementId ? 'Mouvement modifié' : 'Mouvement ajouté'));
    }
  }

  var appEl = document.getElementById('app');
  appEl.addEventListener('click', onClick);
  appEl.addEventListener('submit', onSubmit);
  appEl.addEventListener('input', function (e) {
    e.target.classList.remove('field-error');
    if (e.target.dataset.field === 'mv-search') { movementSearchQuery = e.target.value; render(); return; }
    if (e.target.dataset.pickerSearch) filterPicker(e.target);
  });
  appEl.addEventListener('change', onChange);
  // Un état reçu du serveur pendant une saisie est affiché à la fermeture de la fenêtre.
  appEl.addEventListener('close', function (e) {
    if (!renderingNow && e.target.id === openSheet) openSheet = null;
    if (e.target.id === 'movement-modal') editingMovementId = null;
    if (renderDeferred) setTimeout(function () { if (renderDeferred && !document.querySelector('#app dialog[open]')) render(); }, 0);
  }, true);
  // 'toggle' ne bubble pas : on l'intercepte en phase de capture pour mémoriser
  // l'état ouvert/fermé des accordéons sans provoquer de re-rendu. Un seul accordéon
  // reste ouvert à la fois : en ouvrir un referme tous les autres directement dans le DOM.
  appEl.addEventListener('toggle', function (e) {
    var det = e.target;
    if (!det || det.tagName !== 'DETAILS' || !det.dataset.key) return;
    if (det.open) {
      Array.from(openAccordions).forEach(function (k) {
        if (k === det.dataset.key) return;
        openAccordions.delete(k);
        var other = appEl.querySelector('details[data-key="' + k + '"]');
        if (other && other !== det) other.open = false;
      });
      openAccordions.add(det.dataset.key);
    } else {
      openAccordions.delete(det.dataset.key);
    }
  }, true);

  render();
  boot();
})();
