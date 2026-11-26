// Tablet panels: two full-screen Home Assistant cards for the Fire tablet.
//   custom:lcars-panel-card     - LCARS-style console
//   custom:terminal-panel-card  - green/amber phosphor terminal
// Both read the same config: title, nav, readouts, sections (see dashboards/*.json).
// Written without newer syntax (no ?. or ??) so older Fire OS WebViews cope.

var TP_VERSION = '1.0.0';

function tpFonts() {
  if (document.getElementById('tp-fonts')) return;
  var l = document.createElement('link');
  l.id = 'tp-fonts';
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Antonio:wght@400;600;700&family=VT323&display=swap';
  document.head.appendChild(l);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function tpHms(sec) { return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor(sec / 60) % 60) + ':' + pad2(sec % 60); }
function tpMmss(sec) {
  var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s);
}

// Greetings only play when you tap across from the other panel, never on a page
// load (the tablet reloads the page when its screen wakes).
// prefix: ignore moves within the same dashboard (e.g. LCARS main -> LCARS car page).
function tpJustSwitched(prefix) {
  if (Date.now() - (window.__tpNavAt || 0) >= 5000) return false;
  return !prefix || (window.__tpNavFrom || '').indexOf(prefix) !== 0;
}

function tpNavigate(path) {
  window.__tpNavAt = Date.now();
  window.__tpNavFrom = location.pathname;
  history.pushState(null, '', path);
  window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
}

// Leaflet (maps) is loaded from a CDN the first time the family page opens.
var TP_LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
var tpLeafletP = null;
function tpLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!tpLeafletP) {
    tpLeafletP = new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = TP_LEAFLET + '.js';
      s.onload = function () { ok(window.L); };
      s.onerror = function () { tpLeafletP = null; fail(new Error('leaflet')); };
      document.head.appendChild(s);
    });
  }
  return tpLeafletP;
}

function tpLoad(key, dflt) {
  try { var v = localStorage.getItem(key); return v == null ? dflt : v === '1'; } catch (e) { return dflt; }
}
function tpSave(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* no storage */ }
}

// ---- Energy model -----------------------------------------------------------
// day / hour: recorder statistics (id -> [{start, change, mean}]); states: id -> HA state.
// Electricity "today" = Home Mini live total when it reports, otherwise the typical hourly
// profile (last 14 days, without lumpy loads such as the car) plus what the lumpy plugs
// actually used today. Gas "today" = a straight-line fit of daily gas against outdoor temperature.
// devDays: window for the Devices breakdown (1, 7 or 30 days, default 7).
function tpEnergyModel(cfg, day, hour, states, now, devDays) {
  var num = function (id) { var s = id && states[id]; var v = s ? parseFloat(s.state) : NaN; return isNaN(v) ? null : v; };
  var ms = function (x) { return typeof x.start === 'number' ? x.start : Date.parse(x.start); };
  var dkey = function (t) { var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  var byDay = function (id, field) { var o = {}; (day[id] || []).forEach(function (x) { if (x[field] != null) o[dkey(ms(x))] = x[field]; }); return o; };
  var eK = byDay(cfg.elec.kwh, 'change'), eC = byDay(cfg.elec.cost, 'change'), gK = byDay(cfg.gas.kwh, 'change'),
    gC = byDay(cfg.gas.cost, 'change'), tM = byDay(cfg.outdoor, 'mean');
  var sum = function (o) { return Object.keys(o).reduce(function (a, k) { return a + o[k]; }, 0); };
  var rateE = num(cfg.elec.rate), rateG = num(cfg.gas.rate);
  if (rateE == null) rateE = sum(eK) ? sum(eC) / sum(eK) : 0.28;
  if (rateG == null) rateG = sum(gK) ? sum(gC) / sum(gK) : 0.07;
  var stE = num(cfg.elec.standing) || 0, stG = num(cfg.gas.standing) || 0;
  var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var todayKey = dkey(midnight);

  // Gas against outdoor temperature (complete days only).
  var pts = Object.keys(gK).filter(function (k) { return k !== todayKey && tM[k] != null; }).map(function (k) { return [tM[k], gK[k], k]; });
  var fitA = null, fitB = 0;
  if (pts.length >= 7) {
    var mx = 0, my = 0; pts.forEach(function (p) { mx += p[0]; my += p[1]; }); mx /= pts.length; my /= pts.length;
    var sxy = 0, sxx = 0; pts.forEach(function (p) { sxy += (p[0] - mx) * (p[1] - my); sxx += (p[0] - mx) * (p[0] - mx); });
    fitB = sxx ? sxy / sxx : 0; fitA = my - fitB * mx;
    if (fitB > 0) { fitA = my; fitB = 0; }
  } else if (pts.length) { fitA = pts.reduce(function (a, p) { return a + p[1]; }, 0) / pts.length; }
  var gasExpect = function (T) { return fitA == null ? null : Math.max(0, fitA + fitB * (T == null ? 10 : T)); };
  var recent = pts.slice(-7), act = 0, exp = 0;
  recent.forEach(function (p) { act += p[1]; exp += gasExpect(p[0]); });
  var gasVs = recent.length >= 3 && exp ? (act / exp - 1) * 100 : null;

  // Hourly series.
  var hmap = function (id, f) { var o = {}; (hour[id] || []).forEach(function (x) { var v = f(x); if (v != null) o[ms(x)] = v; }); return o; };
  var houseE = hmap(cfg.elec.kwh, function (x) { return x.change == null ? null : Math.max(0, x.change); });
  var houseG = hmap(cfg.gas.kwh, function (x) { return x.change == null ? null : Math.max(0, x.change); });
  var tempH = hmap(cfg.outdoor, function (x) { return x.mean; });
  var devs = (cfg.devices || []).map(function (d) {
    var cap = d.max_kw || 10;
    var ser = d.energy
      ? hmap(d.energy, function (x) { return x.change == null ? null : Math.min(cap, Math.max(0, x.change)); })
      : hmap(d.power, function (x) { return x.mean == null ? null : Math.min(cap, Math.max(0, x.mean * (d.kw ? 1 : 0.001))); });
    var p = num(d.power);
    return { name: d.name, color: d.color, lumpy: !!d.lumpy, ser: ser, nowW: p == null ? null : p * (d.kw ? 1000 : 1) };
  });
  var weekStart = now.getTime() - 7 * 864e5, typStart = now.getTime() - 14 * 864e5;
  devDays = devDays || 7;
  var devStart = now.getTime() - devDays * 864e5;

  var houseWeek = 0, houseHours = [];
  Object.keys(houseE).forEach(function (t) { if (+t >= weekStart) { houseWeek += houseE[t]; houseHours.push(+t); } });

  // Devices over the chosen window. The plugs are current; Octopus (house total, gas) runs a day
  // or more behind, so "Everything else" only counts hours that Octopus has reported.
  var houseDev = 0, houseDevHours = 0, houseLast = null;
  Object.keys(houseE).forEach(function (t) {
    if (+t < devStart) return;
    houseDev += houseE[t]; houseDevHours++;
    if (houseLast == null || +t > houseLast) houseLast = +t;
  });
  var metered = 0;
  var devices = devs.map(function (d) {
    var k = 0, peak = null, inHouse = 0;
    Object.keys(d.ser).forEach(function (t) {
      if (+t < devStart) return;
      k += d.ser[t];
      if (houseE[t] != null) inHouse += d.ser[t];
      if (!peak || d.ser[t] > peak.kwh) peak = { at: +t, kwh: d.ser[t] };
    });
    metered += inHouse;
    return { name: d.name, color: d.color, kwh: k, cost: k * rateE, peak: peak, nowW: d.nowW };
  });
  // Too little of the window reported (typical for the 24-hour view): don't show a misleading figure.
  var houseKnown = houseDevHours >= devDays * 12;
  devices.push({ name: 'Everything else', color: '#777', rest: true, unknown: !houseKnown,
    kwh: houseKnown ? Math.max(0, houseDev - metered) : null, cost: houseKnown ? Math.max(0, houseDev - metered) * rateE : null, nowW: null });
  devices.sort(function (a, b) { return (b.kwh || 0) - (a.kwh || 0); });
  var gasDev = 0, gasDevHours = 0, gasLast = null;
  Object.keys(houseG).forEach(function (t) {
    if (+t < devStart) return;
    gasDev += houseG[t]; gasDevHours++;
    if (gasLast == null || +t > gasLast) gasLast = +t;
  });
  var devTotal = 0; devices.forEach(function (d) { devTotal += d.kwh || 0; });

  // Spikes: whole-house hours well above the usual hour, split by metered device.
  var vals = houseHours.map(function (t) { return houseE[t]; }).sort(function (a, b) { return a - b; });
  var median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  var spikes = houseHours.filter(function (t) { return houseE[t] > median + 1; })
    .sort(function (a, b) { return houseE[b] - houseE[a]; }).slice(0, 5).map(function (t) {
      var parts = [], used = 0;
      devs.forEach(function (d) { var v = d.ser[t] || 0; used += v; if (v >= 0.2) parts.push([d.name, v]); });
      parts.sort(function (a, b) { return b[1] - a[1]; });
      if (houseE[t] - used >= 0.2) parts.push(['Other', houseE[t] - used]);
      return { at: t, kwh: houseE[t], cost: houseE[t] * rateE, parts: parts };
    });
  var gasSpikes = Object.keys(houseG).filter(function (t) { return +t >= weekStart; })
    .sort(function (a, b) { return houseG[b] - houseG[a]; }).slice(0, 3)
    .map(function (t) { return { at: +t, kwh: houseG[t], cost: houseG[t] * rateG }; });

  // Typical hour-of-day profiles (last 14 days), electricity without lumpy loads.
  var typE = [], typG = [], nE = [], nG = [];
  for (var h = 0; h < 24; h++) { typE[h] = 0; typG[h] = 0; nE[h] = 0; nG[h] = 0; }
  Object.keys(houseE).forEach(function (t) {
    if (+t < typStart) return;
    var v = houseE[t]; devs.forEach(function (d) { if (d.lumpy) v -= d.ser[t] || 0; });
    var hh = new Date(+t).getHours(); typE[hh] += Math.max(0, v); nE[hh]++;
  });
  Object.keys(houseG).forEach(function (t) { if (+t >= typStart) { var hh = new Date(+t).getHours(); typG[hh] += houseG[t]; nG[hh]++; } });
  var totE = 0, doneE = 0, totG = 0, doneG = 0, hNow = now.getHours(), frac = now.getMinutes() / 60;
  for (h = 0; h < 24; h++) {
    typE[h] = nE[h] ? typE[h] / nE[h] : 0; typG[h] = nG[h] ? typG[h] / nG[h] : 0;
    totE += typE[h]; totG += typG[h];
    var part = h < hNow ? 1 : h === hNow ? frac : 0;
    doneE += typE[h] * part; doneG += typG[h] * part;
  }
  var lumpyToday = 0;
  devs.forEach(function (d) { if (d.lumpy) Object.keys(d.ser).forEach(function (t) { if (+t >= midnight) lumpyToday += d.ser[t]; }); });
  var restE = totE - doneE;
  var liveEK = num(cfg.elec.live_kwh), liveEC = num(cfg.elec.live_cost), liveGK = num(cfg.gas.live_kwh), liveGC = num(cfg.gas.live_cost);
  var elecKwh = liveEK != null ? liveEK + restE : doneE + lumpyToday + restE;
  var elecCost = liveEK != null && liveEC != null ? liveEC + restE * rateE : elecKwh * rateE;
  var tToday = [], tempNow = num(cfg.outdoor);
  Object.keys(tempH).forEach(function (t) { if (+t >= midnight) tToday.push(tempH[t]); });
  var Tday = tToday.length ? tToday.reduce(function (a, b) { return a + b; }, 0) / tToday.length : tempNow;
  var predG = gasExpect(Tday);
  var gasKwh = liveGK != null && predG != null ? liveGK + predG * (totG ? 1 - doneG / totG : 1 - (hNow + frac) / 24) : predG;
  var gasCost = liveGK != null && liveGC != null && gasKwh != null ? liveGC + (gasKwh - liveGK) * rateG : gasKwh == null ? null : gasKwh * rateG;
  var standing = stE + stG;
  var total = elecCost + (gasCost || 0) + standing;

  // Daily bars (30 days, the last one is today's estimate).
  var daily = [];
  for (var i = 29; i >= 0; i--) {
    var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), k = dkey(d0.getTime());
    if (i === 0) daily.push({ date: d0, e: elecCost + stE, g: (gasCost || 0) + stG, today: true });
    else daily.push({ date: d0, e: eC[k] == null ? null : eC[k] + stE, g: gC[k] == null ? null : gC[k] + stG });
  }
  var known = daily.filter(function (d) { return !d.today && d.e != null; });
  var last7 = known.slice(-7), week = last7.reduce(function (a, d) { return a + d.e + (d.g || 0); }, 0);
  var avgDay = last7.length ? week / last7.length : total;
  var monthProj = 0, dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  for (var dd = 1; dd <= dim; dd++) {
    var dk = dkey(new Date(now.getFullYear(), now.getMonth(), dd).getTime());
    if (dd === now.getDate()) monthProj += total;
    else if (eC[dk] != null) monthProj += eC[dk] + stE + (gC[dk] == null ? avgDay - (eC[dk] + stE) : gC[dk] + stG);
    else monthProj += avgDay;
  }
  var demand = num(cfg.elec.demand), meteredNow = null;
  devs.forEach(function (d) { if (d.nowW != null) meteredNow = (meteredNow || 0) + d.nowW; });

  return {
    today: { live: liveEK != null || liveGK != null, elecKwh: elecKwh, elecCost: elecCost, gasKwh: gasKwh, gasCost: gasCost, standing: standing, total: total },
    daily: daily, week: last7.length ? week : null, monthProj: monthProj, gasVs: gasVs,
    devices: devices, devDays: devDays, devTotal: devTotal, houseWeek: houseWeek,
    houseLast: houseLast, houseBehind: houseLast == null || now.getTime() - houseLast > 3 * 36e5,
    gasDev: gasDevHours >= devDays * 12 ? gasDev : null, gasDevCost: gasDevHours >= devDays * 12 ? gasDev * rateG : null, gasLast: gasLast,
    spikes: spikes, gasSpikes: gasSpikes, nowW: demand != null ? demand : meteredNow, nowLive: demand != null,
    tempNow: tempNow, fit: { a: fitA, b: fitB, n: pts.length }, rateE: rateE, rateG: rateG,
  };
}

// ---- Month forecast ------------------------------------------------------------
// Per device: kWh so far this calendar month, plus its recent daily average (last 14 days, or since
// its plug started reporting) for the rest of the month. House electricity and gas work the same way
// from Octopus hourly data, which runs a day or two behind; "Everything else" = house - plugs.
function tpForecastModel(cfg, day, hour, states, now) {
  var num = function (id) { var s = id && states[id]; var v = s ? parseFloat(s.state) : NaN; return isNaN(v) ? null : v; };
  var ms = function (x) { return typeof x.start === 'number' ? x.start : Date.parse(x.start); };
  var HR = 36e5, DY = 864e5, nowT = now.getTime();
  var mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  var mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  var dim = Math.round((mEnd - mStart) / DY);
  var hmap = function (id, f) { var o = {}; (hour[id] || []).forEach(function (x) { var v = f(x); if (v != null) o[ms(x)] = v; }); return o; };
  var chg = function (cap) { return function (x) { return x.change == null ? null : Math.min(cap, Math.max(0, x.change)); }; };
  // so far (from the month start), last reported hour, recent kWh per day.
  var stat = function (ser, lookDays) {
    var keys = Object.keys(ser).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) return { soFar: 0, last: null, first: null, perDay: 0 };
    // Daily rate from the hours that actually reported (a plug that was offline isn't counted as idle).
    var last = keys[keys.length - 1], from = last + HR - lookDays * DY, soFar = 0, recent = 0, hrs = 0;
    keys.forEach(function (t) { if (t >= mStart) soFar += ser[t]; if (t >= from) { recent += ser[t]; hrs++; } });
    return { soFar: soFar, last: last, first: keys[0], perDay: hrs >= 6 ? recent / hrs * 24 : 0 };
  };
  // Days of the month still to come after the series' last reported hour.
  var left = function (last) { var t = last == null ? Math.max(mStart, nowT) : Math.max(mStart, last + HR); return Math.max(0, (mEnd - t) / DY); };

  var rateE = num(cfg.elec.rate), rateG = num(cfg.gas.rate);
  if (rateE == null) rateE = 0.28;
  if (rateG == null) rateG = 0.07;
  var stE = num(cfg.elec.standing) || 0, stG = num(cfg.gas.standing) || 0;

  var houseE = hmap(cfg.elec.kwh, chg(1e9)), houseG = hmap(cfg.gas.kwh, chg(1e9));
  var hE = stat(houseE, 14), hG = stat(houseG, 14);
  var devices = [], plugsInHouse = 0, plugsAfter = 0, plugsProj = 0;
  (cfg.devices || []).forEach(function (d) {
    var cap = d.max_kw || 10;
    var ser = d.energy ? hmap(d.energy, chg(cap))
      : hmap(d.power, function (x) { return x.mean == null ? null : Math.min(cap, Math.max(0, x.mean * (d.kw ? 1 : 0.001))); });
    var s = stat(ser, 14);
    Object.keys(ser).forEach(function (t) {
      if (+t < mStart) return;
      if (houseE[t] != null) plugsInHouse += ser[t];
      else if (hE.last == null || +t > hE.last) plugsAfter += ser[t];   // used since Octopus last reported
    });
    var proj = s.soFar + s.perDay * left(s.last);
    plugsProj += proj;
    devices.push({ name: d.name, color: d.color, soFar: s.soFar, proj: proj, perDay: s.perDay, cost: s.soFar * rateE, projCost: proj * rateE,
      since: s.first != null && s.first > mStart + DY && s.first > nowT - 14 * DY ? s.first : null });   // plug only recently reporting
  });
  var houseProj = hE.soFar + hE.perDay * left(hE.last);
  var restSoFar = Math.max(0, hE.soFar - plugsInHouse), restProj = Math.max(restSoFar, houseProj - plugsProj);
  devices.push({ name: 'Everything else', color: '#777', rest: true, soFar: restSoFar, proj: restProj, perDay: null,
    cost: restSoFar * rateE, projCost: restProj * rateE, asOf: hE.last == null ? null : hE.last + HR });
  devices.sort(function (a, b) { return b.projCost - a.projCost; });

  var gasProj = hG.soFar + hG.perDay * left(hG.last);
  var elapsed = Math.min(dim, Math.max(0, (nowT - mStart) / DY));
  var standing = (stE + stG) * dim, standingSoFar = (stE + stG) * Math.ceil(elapsed);
  var elecProjCost = Math.max(houseProj, plugsProj) * rateE, gasProjCost = gasProj * rateG;
  return {
    month: now.getMonth(), year: now.getFullYear(), dim: dim, daysLeft: (mEnd - nowT) / DY, elapsed: elapsed,
    devices: devices, rateE: rateE, rateG: rateG,
    gas: { soFar: hG.soFar, proj: gasProj, cost: hG.soFar * rateG, projCost: gasProjCost, perDay: hG.perDay, asOf: hG.last == null ? null : hG.last + HR },
    houseAsOf: hE.last == null ? null : hE.last + HR,
    standing: standing, standingSoFar: standingSoFar, elecProjCost: elecProjCost,
    total: elecProjCost + gasProjCost + standing,
    // Known spend so far: Octopus electricity + plug use since then + Octopus gas + standing charges.
    soFar: (hE.soFar + plugsAfter) * rateE + hG.soFar * rateG + standingSoFar,
  };
}

// ---- Sound: everything is synthesised with Web Audio, no sound files ------
var tpAudio = {
  ctx: null,
  unlock: function () {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!this.ctx) { try { this.ctx = new C(); } catch (e) { return null; } }
    if (this.ctx.state === 'suspended' && this.ctx.resume) { try { this.ctx.resume(); } catch (e) { /* needs a tap */ } }
    return this.ctx;
  },
  ready: function () { return this.ctx && this.ctx.state === 'running' ? this.ctx : null; },
  // notes: [[freq, start, duration, endFreq?], ...] in seconds
  seq: function (notes, type, vol) {
    var c = this.unlock();
    if (!c) return;
    var v = vol || 0.18;
    var t0 = c.currentTime + 0.01;
    notes.forEach(function (n) {
      var o = c.createOscillator(), g = c.createGain();
      var s = t0 + n[1], e = s + n[2];
      o.type = type || 'sine';
      o.frequency.setValueAtTime(n[0], s);
      if (n[3]) o.frequency.exponentialRampToValueAtTime(n[3], e);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(v, s + 0.006);
      g.gain.setValueAtTime(v, Math.max(s + 0.007, e - 0.015));
      g.gain.exponentialRampToValueAtTime(0.0001, e);
      o.connect(g); g.connect(c.destination);
      o.start(s); o.stop(e + 0.02);
    });
  },
  click: function (vol, freq) {
    var c = this.ready();
    if (!c) return;
    if (!this._nb) {
      var len = Math.floor(c.sampleRate * 0.03);
      var b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      this._nb = b;
    }
    var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this._nb;
    f.type = 'bandpass'; f.frequency.value = freq || 2400; f.Q.value = 1.4;
    g.gain.value = vol || 0.35;
    s.connect(f); f.connect(g); g.connect(c.destination);
    s.start();
  },
};

// ---- Computer voice: HA text-to-speech run through an intercom filter -----
var tpVoice = {
  cache: {},
  queue: [],
  busy: false,
  say: function (hass, text, cfg) {
    if (!text || !hass) return;
    this.queue.push({ hass: hass, text: text, cfg: cfg || {} });
    if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 3);
    this._next();
  },
  preload: function (hass, text, cfg) { if (hass && text) this._load(hass, text, cfg || {}).catch(function () {}); },
  pend: {},
  _load: function (hass, text, cfg) {
    var self = this;
    if (this.cache[text]) return Promise.resolve(this.cache[text]);
    if (this.pend[text]) return this.pend[text];
    var p = this._fetch(hass, text, cfg);
    this.pend[text] = p;
    var clear = function () { delete self.pend[text]; };
    p.then(clear, clear);
    return p;
  },
  _fetch: function (hass, text, cfg) {
    var self = this;
    var c = tpAudio.unlock();
    if (!c) return Promise.reject(new Error('no audio'));
    var decode = function (buf) { return new Promise(function (ok, err) { c.decodeAudioData(buf, ok, err); }); };
    if (cfg.clip) { // text is an audio URL (e.g. a data: URL built by deploy.mjs)
      return fetch(text).then(function (res) { return res.arrayBuffer(); }).then(decode)
        .then(function (b) { self.cache[text] = b; return b; });
    }
    return hass.callApi('POST', 'tts_get_url', {
      engine_id: cfg.engine || 'tts.google_translate_en_com',
      message: text,
      language: cfg.language || 'en',
      options: cfg.options || { tld: 'co.uk' },
    }).then(function (r) { return fetch(r.path || r.url); })
      .then(function (res) { return res.arrayBuffer(); })
      .then(function (buf) { return new Promise(function (ok, err) { c.decodeAudioData(buf, ok, err); }); })
      .then(function (b) { self.cache[text] = b; return b; });
  },
  _next: function () {
    var self = this;
    if (this.busy || !this.queue.length) return;
    if (!tpAudio.ready()) { this.queue = []; return; }
    this.busy = true;
    var item = this.queue.shift();
    this._load(item.hass, item.text, item.cfg)
      .then(function (b) { return self._play(b, item.cfg); })
      .catch(function () {})
      .then(function () { self.busy = false; setTimeout(function () { self._next(); }, 200); });
  },
  _play: function (buf, cfg) {
    var c = tpAudio.ctx;
    return new Promise(function (resolve) {
      if (cfg.chime !== false) tpAudio.seq([[1568, 0, 0.09], [1175, 0.12, 0.16]], 'sine', 0.09); // attention chime
      var rate = cfg.rate || 0.92;
      var s = c.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = rate; // a touch slower and deeper
      var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
      var pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2600; pk.gain.value = 5; pk.Q.value = 0.9;
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
      var comp = c.createDynamicsCompressor();
      var dry = c.createGain(); dry.gain.value = 0.95;
      var dl = c.createDelay(); dl.delayTime.value = 0.08;
      var fb = c.createGain(); fb.gain.value = 0.25;
      var wet = c.createGain(); wet.gain.value = 0.28;
      if (cfg.raw) s.connect(c.destination);
      else s.connect(hp);
      hp.connect(pk); pk.connect(lp); lp.connect(comp);
      comp.connect(dry); dry.connect(c.destination);
      comp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(c.destination);
      var done = false;
      var finish = function () { if (!done) { done = true; setTimeout(resolve, 250); } };
      s.onended = finish;
      setTimeout(finish, (buf.duration / rate) * 1000 + 1500);
      s.start(c.currentTime + 0.32);
    });
  },
};

class TabletPanelBase extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._sig = '';
    this._prev = {};
    this._cmd = {};
    this._log = [];
    this._audioOn = tpLoad('tp-audio-' + this._kind(), true);
    var self = this;
    this.shadowRoot.addEventListener('click', function (e) { self._onClick(e); });
  }

  setConfig(config) {
    if (!config || !config.sections) throw new Error('sections are required');
    // HA hands cards a frozen config, so work on a copy.
    config = JSON.parse(JSON.stringify(config));
    this._config = config;
    this._items = [];
    var self = this;
    config.sections.forEach(function (sec, si) {
      (sec.items || []).forEach(function (it, ii) {
        it._key = si + '-' + ii;
        it._sec = sec.title;
        self._items.push(it);
      });
    });
    this._sig = '';
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() { return 12; }

  connectedCallback() {
    tpFonts();
    var self = this;
    this._timer = setInterval(function () { self._tick(); }, 1000);
    this._tick();
  }

  disconnectedCallback() { clearInterval(this._timer); }

  // ---- state helpers -------------------------------------------------
  _st(id) { return id && this._hass ? this._hass.states[id] : undefined; }

  _watched() {
    var ids = [];
    (this._config.readouts || []).forEach(function (r) { ids.push(r.entity); });
    this._items.forEach(function (it) { if (it.entity) ids.push(it.entity); if (it.timer) ids.push(it.timer); });
    ids = ids.concat(this._carIds(), this._serverIds ? this._serverIds() : [], this._energyIds ? this._energyIds() : []);
    if (this._config.page === 'family' && this._config.family) {
      (this._config.family.people || []).forEach(function (p) {
        ids.push(p.person, 'sensor.' + p.prefix + '_distance', 'sensor.' + p.prefix + '_direction_of_travel', p.battery, p.alert, p.trip);
      });
      (this._config.family.vehicles || []).forEach(function (v) { ids.push(v.tracker); });
    }
    return ids;
  }

  // ---- car (FordPass) --------------------------------------------------
  // config.car.prefix is the FordPass entity prefix, e.g. fordpass_<vin>.
  _carId(domain, key) { return domain + '.' + this._config.car.prefix + '_' + key; }
  _carSt(domain, key) { return this._config.car ? this._st(this._carId(domain, key)) : undefined; }
  _carIds() {
    if (!this._config.car) return [];
    var self = this;
    return [['sensor', 'soc'], ['sensor', 'elveh'], ['sensor', 'elvehcharging'], ['sensor', 'elvehplug'], ['switch', 'elvehcharge'],
      ['select', 'elvehtargetcharge'], ['sensor', 'remotestartstatus'], ['sensor', 'remotestartcountdown'], ['switch', 'ignition'],
      ['switch', 'rccdefrostfront'], ['switch', 'rccdefrostrear'], ['switch', 'departuretimes'], ['sensor', 'departureschedules'],
      ['lock', 'doorlock'], ['sensor', 'doorstatus'], ['sensor', 'windowposition'], ['sensor', 'alarm'], ['sensor', 'tirepressure'],
      ['sensor', 'battery'], ['sensor', 'odometer'], ['sensor', 'cabintemperature'], ['sensor', 'outsidetemp'],
      ['device_tracker', 'tracker'], ['sensor', 'lastrefresh'], ['sensor', 'messages'], ['sensor', 'ignitionstatus']]
      .map(function (p) { return self._carId(p[0], p[1]); });
  }

  _isOn(it) {
    var s = this._st(it.entity);
    if (!s) return false;
    if (it.type === 'vacuum') return s.state === 'cleaning' || s.state === 'returning';
    if (it.type === 'timer') return s.state === 'active' || s.state === 'paused';
    if (it.type === 'script' && it.timer) { var tm = this._st(it.timer); return !!tm && tm.state === 'active'; }
    return s.state === 'on';
  }

  _pct(it) {
    var s = this._st(it.entity);
    if (!s || s.state !== 'on' || s.attributes.brightness == null) return null;
    return Math.round(s.attributes.brightness / 2.55);
  }

  _stateText(it) {
    var s = this._st(it.entity);
    switch (it.type) {
      case 'light': {
        if (!s) return 'NO SIGNAL';
        if (s.state !== 'on') return 'OFF';
        var p = this._pct(it);
        return p == null ? 'ON' : 'ON ' + p + '%';
      }
      case 'toggle': return s ? s.state.toUpperCase() : 'NO SIGNAL';
      case 'script': {
        // Script that runs a timer (e.g. a boost): show when it ends.
        if (it.timer) {
          var tm = this._st(it.timer);
          if (tm && tm.state === 'active' && tm.attributes.finishes_at) return 'UNTIL ' + this._hhmm(new Date(tm.attributes.finishes_at));
          return it.idle_text || 'READY';
        }
        return s && s.state === 'on' ? 'RUNNING' : 'READY';
      }
      case 'scene': return 'ENGAGE';
      case 'vacuum': {
        if (!s) return 'NO SIGNAL';
        var b = s.attributes.battery != null ? s.attributes.battery : s.attributes.battery_level;
        return s.state.toUpperCase() + (b != null ? ' ' + b + '%' : '');
      }
    }
    return s ? s.state.toUpperCase() : '';
  }

  _readout(r) {
    var s = this._st(r.entity);
    if (!s) return { text: '--', num: null };
    var v = r.attr ? s.attributes[r.attr] : s.state;
    var n = parseFloat(v);
    if (isNaN(n)) return { text: String(v).toUpperCase(), num: null };
    var d = r.decimals != null ? r.decimals : 1;
    return { text: n.toFixed(d) + (r.unit || ''), num: n };
  }

  _update() {
    if (!this._hass || !this._config) return;
    var self = this;
    var sig = this._watched().map(function (id) {
      var s = self._st(id);
      if (!s) return id + ':-';
      var a = s.attributes;
      return id + ':' + s.state + ':' + (a.brightness || '') + ':' + (a.current_temperature || '') + ':' + (a.battery || '') +
        ':' + (a.finishes_at || '') + ':' + (a.remaining || '') + (id.indexOf('fordpass') >= 0 || id.indexOf('person.') === 0 ? ':' + s.last_updated : '');
    }).join('|');
    if (sig === this._sig) return;
    var first = this._sig === '';
    this._sig = sig;
    // Log state changes (not on the first render).
    this._items.forEach(function (it) {
      if (!it.entity || it.type === 'scene') return;
      var txt = self._stateText(it);
      if (!first && self._prev[it._key] !== undefined && self._prev[it._key] !== txt) {
        // Was this change asked for from this screen in the last 10 s?
        var c = self._cmd[it._key];
        var op = c && Date.now() - c.t < 10000 ? c.op : null;
        if (c) delete self._cmd[it._key];
        self._note(it.label + ' >> ' + txt, true);
        self._onChange(it, txt, op);
      }
      self._prev[it._key] = txt;
    });
    this._render();
    this._tick();
    this._renderLog();
  }

  // ---- actions ---------------------------------------------------------
  _call(domain, service, data, label) {
    var self = this;
    this._note('EXEC ' + label, false);
    this._hass.callService(domain, service, data).catch(function (err) {
      self._note('ERROR ' + label + ': ' + (err && err.message ? err.message : err), false);
      self._sfx('error');
    });
  }

  _run(it, op) {
    this._cmd[it._key] = { t: Date.now(), op: op };
    this._sfx('press', it, op);
    var id = it.entity;
    var label = String(it.label).toUpperCase();
    switch (it.type) {
      case 'light':
        if (op === 'up') return this._call('light', 'turn_on', { entity_id: id, brightness_step_pct: 20 }, label + ' +20%');
        if (op === 'down') return this._call('light', 'turn_on', { entity_id: id, brightness_step_pct: -20 }, label + ' -20%');
        return this._call('light', 'toggle', { entity_id: id }, label + ' TOGGLE');
      case 'toggle':
        return this._call('homeassistant', 'toggle', { entity_id: id }, label + ' TOGGLE');
      case 'scene':
        return this._call('scene', 'turn_on', { entity_id: it.entities || id }, label);
      case 'script':
        return this._call('script', 'turn_on', { entity_id: id }, label);
      case 'vacuum':
        if (op === 'dock') return this._call('vacuum', 'return_to_base', { entity_id: id }, label + ' DOCK');
        if (op === 'locate') return this._call('vacuum', 'locate', { entity_id: id }, label + ' LOCATE');
        return this._call('vacuum', this._isOn(it) ? 'pause' : 'start', { entity_id: id }, label + (this._isOn(it) ? ' PAUSE' : ' START'));
      case 'timer': {
        var ts = this._st(id), state = ts ? ts.state : 'idle';
        if (op === 'cancel') return this._call('timer', 'cancel', { entity_id: id }, label + ' CANCEL');
        if (op === 'up' || op === 'down') {
          if (state === 'active') { // nudge the running timer by a minute
            var left = Math.max(10, this._timerLeft(it) + (op === 'up' ? 60 : -60));
            return this._call('timer', 'start', { entity_id: id, duration: tpHms(left) }, label + ' ' + tpMmss(left));
          }
          var m = this._timerMins(it);
          var step = op === 'up' ? (m >= 10 ? 5 : 1) : (m > 10 ? 5 : 1);
          this._setTimerMins(Math.max(1, Math.min(180, m + (op === 'up' ? step : -step))));
          return;
        }
        if (state === 'active') return this._call('timer', 'pause', { entity_id: id }, label + ' HOLD');
        if (state === 'paused') return this._call('timer', 'start', { entity_id: id }, label + ' RESUME');
        var mins = this._timerMins(it);
        return this._call('timer', 'start', { entity_id: id, duration: tpHms(mins * 60) }, label + ' ' + mins + ' MIN');
      }
    }
  }

  // ---- timer helpers ---------------------------------------------------
  _timerMins(it) {
    if (this._tmin == null) {
      var v = NaN;
      try { v = parseInt(localStorage.getItem('tp-timer-min'), 10); } catch (e) { /* no storage */ }
      this._tmin = v > 0 ? v : (it.minutes || 10);
    }
    return this._tmin;
  }
  _setTimerMins(m) {
    this._tmin = m;
    try { localStorage.setItem('tp-timer-min', String(m)); } catch (e) { /* no storage */ }
    this._tick();
  }
  // Seconds left on a running or paused timer.
  _timerLeft(it) {
    var s = this._st(it.entity);
    if (!s) return 0;
    if (s.state === 'active' && s.attributes.finishes_at) return Math.max(0, Math.round((Date.parse(s.attributes.finishes_at) - Date.now()) / 1000));
    var r = String(s.attributes.remaining || '0:00:00').split(':').map(Number);
    return r.length === 3 ? r[0] * 3600 + r[1] * 60 + r[2] : 0;
  }

  _onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-k],[data-nav],[data-ui]') : null;
    if (!el) return;
    tpAudio.unlock(); // browsers only allow sound after a tap
    if (el.hasAttribute('data-nav')) {
      var n = (this._config.nav || [])[+el.getAttribute('data-nav')];
      if (n) {
        this._sfx('nav');
        setTimeout(function () { tpNavigate(n.path); }, 180);
      }
      return;
    }
    if (el.hasAttribute('data-ui')) { this._ui(el.getAttribute('data-ui')); return; }
    var key = el.getAttribute('data-k');
    var it = this._items.filter(function (x) { return x._key === key; })[0];
    if (it) this._run(it, el.getAttribute('data-op') || 'main');
  }

  _ui() {}
  _kind() { return 'base'; }
  _sfx() {}
  _onChange() {}

  _toggleAudio() {
    this._audioOn = !this._audioOn;
    tpSave('tp-audio-' + this._kind(), this._audioOn);
    if (!this._audioOn) tpVoice.queue = [];
    var b = this.shadowRoot.getElementById('audio');
    if (b) b.textContent = this._audioLabel();
    return this._audioOn;
  }

  _navActive(n) {
    var p = n.path.split('?')[0];
    return location.pathname === p || location.pathname.indexOf(p + '/') === 0;
  }

  // ---- log + clock -----------------------------------------------------
  _note(text, fromState) {
    var d = new Date();
    this._log.push({ t: pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()), text: text, s: fromState, shown: 9 });
    if (this._log.length > 40) this._log.shift();
    this._renderLog();
  }

  _tick() {
    var root = this.shadowRoot;
    var c = root.getElementById('clock');
    if (!c) return;
    var d = new Date();
    c.textContent = this._clockText(d);
    var dt = root.getElementById('date');
    if (dt) dt.textContent = this._dateText(d);
    this._onTick();
  }
  _onTick() {}

  _clockText(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
  _dateText(d) {
    var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return days[d.getDay()] + ' ' + pad2(d.getDate()) + ' ' + mon[d.getMonth()] + ' ' + d.getFullYear();
  }
  _renderLog() {}
}

// =========================================================================
// LCARS-style console
// =========================================================================
var LC = ['#ff9c00', '#cc99cc', '#9c9cff', '#ffcc66', '#ff9966', '#99ccff', '#cc6666', '#ffaa90'];

var LCARS_CSS = `
:host { display:block; }
* { box-sizing:border-box; }
.lc { height:100vh; background:#000; color:#ff9c00; padding:10px 14px 10px 10px; display:flex; flex-direction:column;
  font-family:Antonio, 'Arial Narrow', 'Roboto Condensed', sans-serif; text-transform:uppercase; letter-spacing:.04em;
  --sw:150px; --bar:20px; --g:5px; overflow:hidden; -webkit-tap-highlight-color:transparent; user-select:none; }
button { font:inherit; color:#000; border:0; cursor:pointer; text-transform:uppercase; letter-spacing:.05em; }
button:active { filter:brightness(1.35); }
.row { display:flex; }
.top, .bot { display:flex; flex:none; }
.elbow { width:var(--sw); flex:none; position:relative; color:#000; font-weight:600; }
.top .elbow { height:96px; border-top-left-radius:64px; display:flex; align-items:flex-end; justify-content:flex-end; padding:0 10px 4px 0; font-size:15px; }
.top .elbow::after { content:''; position:absolute; left:100%; top:var(--bar); width:28px; height:28px;
  background:radial-gradient(circle at 100% 100%, transparent 27.5px, var(--c) 28px); }
.bot .elbow { height:64px; border-bottom-left-radius:48px; display:flex; align-items:flex-start; justify-content:flex-end; padding:4px 10px 0 0; font-size:15px; }
.bot .elbow::after { content:''; position:absolute; left:100%; bottom:var(--bar); width:28px; height:28px;
  background:radial-gradient(circle at 100% 0%, transparent 27.5px, var(--c) 28px); }
.cap { flex:1; display:flex; flex-direction:column; min-width:0; }
.segs { display:flex; gap:var(--g); height:var(--bar); flex:none; }
.segs > div { height:100%; }
.bot .cap { justify-content:flex-end; }
.head { flex:1; display:flex; align-items:center; justify-content:space-between; padding:0 6px 0 40px; min-height:0; }
.title { font-size:52px; font-weight:700; color:#ff9c00; line-height:1; }
.clockbox { display:flex; flex-direction:column; align-items:flex-start; line-height:1; }
#clock { font-size:40px; color:#ffcc66; font-variant-numeric:tabular-nums; }
#date { font-size:16px; color:#cc99cc; margin-top:4px; }
.status { flex:1; padding:0 6px 6px 40px; display:flex; align-items:flex-end; font-size:16px; color:#99ccff; overflow:hidden; white-space:nowrap; }
.mid { flex:1; display:flex; min-height:0; margin:var(--g) 0; }
.side { width:var(--sw); flex:none; display:flex; flex-direction:column; gap:var(--g); }
.side > * { border-radius:0; }
.nav { height:60px; display:flex; align-items:flex-end; justify-content:flex-end; padding:0 10px 4px 0; font-size:18px; font-weight:600; }
.nav.active { outline:3px solid #fff; outline-offset:-3px; }
.fill { flex:1; display:flex; align-items:flex-end; justify-content:flex-end; padding:0 10px 4px 0; color:#000; font-size:14px; }
.main { flex:1; min-width:0; overflow:auto; padding:4px 0 4px 40px; display:grid; grid-template-columns: 1.25fr 1fr; gap:14px 26px; align-content:start; }
.sec { min-width:0; }
.sh { display:flex; align-items:center; gap:8px; height:26px; margin-bottom:8px; }
.sh .pill { width:26px; height:26px; border-radius:13px 0 0 13px; flex:none; }
.sh .t { font-size:22px; font-weight:600; flex:none; }
.sh .ln { flex:1; height:26px; border-radius:0 13px 13px 0; }
.btns { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:6px; }
.b { height:58px; border-radius:29px; display:flex; flex-direction:column; align-items:flex-end; justify-content:flex-end; padding:0 20px 6px 12px; text-align:right; line-height:1.05; }
.b .l { font-size:18px; font-weight:600; }
.b .s { font-size:13px; opacity:.8; }
.b.off { filter:brightness(.5) saturate(.8); }
.wide { grid-column:1 / -1; display:flex; gap:6px; }
.wide .b { flex:1; }
.wide .sq { width:64px; flex:none; border-radius:0; align-items:center; justify-content:center; padding:0; font-size:26px; font-weight:700; }
.wide .sq.r { border-radius:0 29px 29px 0; }
.wide .b.main { border-radius:29px 0 0 29px; }
.ro { display:grid; grid-template-columns:auto 1fr auto; gap:5px 10px; align-items:center; font-size:19px; }
.ro .k { width:14px; height:22px; }
.ro .v { color:#ffcc66; font-variant-numeric:tabular-nums; text-align:right; }
.ro .n { color:#ff9c00; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mid { position:relative; }
.tmr { font-variant-numeric:tabular-nums; }
.wide .sq.x { width:auto; padding:0 18px; font-size:16px; }
@keyframes redal { 50% { background:#e00000; color:#fff; } }
.lc.red .elbow, .lc.red .segs > div, .lc.red .side > *, .b.fin { animation:redal .7s steps(1) infinite; }
.lc.red .title { color:#ff2020; }
.rep { position:absolute; top:0; right:0; bottom:0; left:calc(var(--sw) + 40px); background:#000; z-index:3; display:flex; flex-direction:column; padding:4px 0; }
.rep .rl { flex:1; min-height:0; overflow:hidden; display:grid; grid-template-columns:auto 1fr; gap:6px 16px; align-content:start; font-size:20px; }
.rep .c { font-weight:600; white-space:nowrap; }
.rep .v { color:#ffcc66; }
.rep .ft { display:flex; justify-content:flex-end; }
.rep .ft .b { width:160px; flex:none; color:#000; }
.cbar { display:flex; gap:3px; height:22px; margin:4px 0 6px; }
.cbar i { flex:1; background:#262626; }
.cbar i.f { background:var(--cf); }
.cbar i.f.chg:last-of-type { animation:blinkf 1.2s steps(1) infinite; }
@keyframes blinkf { 50% { background:#262626; } }
.kv { display:grid; grid-template-columns:auto 1fr; gap:3px 12px; font-size:18px; }
.kv .k { color:#cc99cc; white-space:nowrap; }
.kv .v { color:#ffcc66; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kv .v.warn { color:#ff5050; }
.big { font-size:44px; line-height:1; color:#ffcc66; font-variant-numeric:tabular-nums; }
.chips { display:flex; gap:5px; flex-wrap:wrap; margin-top:6px; }
.chips .b { height:36px; border-radius:18px; flex:1; min-width:0; padding:0 12px 4px 8px; }
.chips .b .l { font-size:15px; }
.dep { display:flex; align-items:center; gap:8px; }
.dep .b { width:46px; flex:none; height:40px; border-radius:0; align-items:center; justify-content:center; padding:0; font-size:15px; }
.dep .b:first-child { border-radius:20px 0 0 20px; } .dep .b:last-child { border-radius:0 20px 20px 0; }
.carpg { grid-template-columns:1fr 1fr; }
.kv .v.hi { color:#99ff99; }
.kv .v.dim, .bars .v.dim { color:#888; }
.bars { display:grid; grid-template-columns:auto 1fr auto; gap:5px 10px; align-items:center; font-size:18px; margin:4px 0 6px; }
.bars .k { color:#cc99cc; white-space:nowrap; } .bars .v { color:#ffcc66; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.mbar { display:block; height:14px; background:#262626; position:relative; }
.mbar i { position:absolute; top:0; bottom:0; left:0; }
.fc .mbar { display:flex; } .fc .mbar i { position:static; display:block; height:100%; }
.bars .v .dim { color:#888; } .bars .k em { color:#ffcc66; font-style:normal; }
.ctr { display:grid; grid-template-columns:1fr auto auto; gap:2px 14px; font-size:17px; }
.ctr .cn { color:#ff9c00; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.ctr .cv { color:#ffcc66; text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.ctr .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:1px; }
.entop { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:4px; }
.ensrc { color:#cc99cc; font-size:15px; letter-spacing:.05em; } .ensrc.hi { color:#99ff99; }
.echart { position:relative; display:flex; align-items:flex-end; gap:3px; height:150px; padding-bottom:18px; margin:4px 0 2px; border-bottom:2px solid #333; }
.echart .emax { position:absolute; top:-2px; left:0; font-size:13px; color:#888; }
.echart .ec { position:relative; flex:1; height:100%; display:flex; flex-direction:column-reverse; }
.echart .ec i { display:block; width:100%; }
.echart .ec.est i { opacity:.45; outline:1px dashed #ffcc66; }
.echart .ec.none { background:repeating-linear-gradient(0deg, #1a1a1a 0 2px, transparent 2px 6px); }
.echart .ec b { position:absolute; bottom:-18px; left:50%; transform:translateX(-50%); font:400 12px Antonio, 'Arial Narrow', sans-serif; color:#888; }
.elegend { display:flex; gap:14px; font-size:13px; color:#ccc; margin:2px 0 6px; letter-spacing:.05em; }
.elegend i { display:inline-block; width:10px; height:10px; margin-right:5px; } .elegend .dim { color:#777; margin-left:auto; }
.spk { display:grid; grid-template-columns:auto auto 1fr; gap:3px 12px; font-size:17px; margin-bottom:6px; }
.spk .sw { color:#cc99cc; white-space:nowrap; } .spk .sv { color:#ffcc66; white-space:nowrap; text-align:right; font-variant-numeric:tabular-nums; }
.spk .sd { color:#99ccff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
@media (max-height: 680px) {
  .echart { height:96px; padding-bottom:14px; } .echart .ec b { bottom:-14px; font-size:10px; } .elegend { font-size:11px; margin:0 0 3px; }
  .spk { font-size:13px; gap:1px 8px; } .ensrc { font-size:12px; }
  .bars { font-size:14px; gap:3px 8px; margin:2px 0 4px; } .mbar { height:10px; }
  .ctr { font-size:14px; gap:1px 10px; } .ctr .dot { width:7px; height:7px; margin-right:5px; }
}
.main.fam { grid-template-columns:1.7fr 1fr; align-content:stretch; }
.main.fam .mapcol { display:flex; flex-direction:column; min-height:0; }
.main.fam .mapcol .sec { flex:1; display:flex; flex-direction:column; min-height:0; }
.famside { display:flex; flex-direction:column; gap:14px; min-width:0; }
.mapslot { position:relative; flex:1; min-height:180px; background:#0d0d14; border-bottom-left-radius:28px; overflow:hidden; }
.mapbox { position:absolute; top:0; right:0; bottom:0; left:0; background:#0d0d14; }
.nomap { position:absolute; top:45%; width:100%; text-align:center; color:#cc6666; font-size:22px; }
.tp-pin { background:none; border:0; }
.tp-pin span { position:absolute; left:12px; top:-11px; padding:1px 8px 2px; border-radius:10px; color:#000; white-space:nowrap;
  font:600 14px Antonio, 'Arial Narrow', sans-serif; letter-spacing:.05em; text-transform:uppercase; }
.tp-pin span.zn { left:-30px; top:-30px; background:none; font-size:12px; }
.tp-pin i { position:absolute; display:block; border-radius:50%; }
.tp-pin i.pd { width:18px; height:18px; left:-9px; top:-9px; border:2px solid #000; box-sizing:border-box; box-shadow:0 0 0 2px rgba(255,255,255,.35); }
.tp-pin i.vd { width:16px; height:16px; left:-8px; top:-8px; border-radius:4px; border:2px solid #000; box-sizing:border-box; box-shadow:0 0 0 2px rgba(255,255,255,.35); }
.tp-pin i.zd { width:30px; height:30px; left:-15px; top:-15px; border:2px solid; background:rgba(255,204,102,.12); box-sizing:border-box; }
.leaflet-container { font-family:Antonio, 'Arial Narrow', sans-serif; background:#0d0d14; }
.leaflet-tile-pane { filter:invert(1) hue-rotate(200deg) brightness(.8) contrast(.95) saturate(.45); }
.leaflet-control-attribution { background:rgba(0,0,0,.6) !important; color:#777 !important; font-size:9px !important; }
.leaflet-control-attribution a { color:#99ccff !important; }
@media (max-height: 680px) {
  .kv { font-size:14px; gap:1px 10px; } .big { font-size:32px; } .cbar { height:12px; margin:0 0 4px; }
  .chips { gap:4px; margin-top:4px; } .chips .b { height:30px; border-radius:15px; } .chips .b .l { font-size:13px; }
  .dep .b { height:32px; width:38px; font-size:13px; }
  .rep { left:calc(var(--sw) + 28px); } .rep .rl { font-size:15px; gap:3px 12px; }
  .wide .sq.x { padding:0 12px; font-size:13px; }
  .lc { --sw:120px; --bar:16px; padding:6px 10px 6px 6px; }
  .top .elbow { height:72px; border-top-left-radius:50px; font-size:12px; }
  .bot .elbow { height:46px; border-bottom-left-radius:36px; font-size:12px; }
  .title { font-size:36px; } #clock { font-size:28px; } #date { font-size:13px; margin-top:2px; }
  .head, .status { padding-left:28px; } .status { font-size:13px; padding-bottom:3px; }
  .nav { height:44px; font-size:15px; }
  .main { padding-left:28px; gap:8px 18px; }
  .main > div { gap:8px !important; }
  .sh { height:20px; margin-bottom:5px; } .sh .pill { width:20px; height:20px; } .sh .ln { height:20px; } .sh .t { font-size:17px; }
  .btns { gap:5px; grid-template-columns:repeat(auto-fill, minmax(100px, 1fr)); }
  .b { height:44px; border-radius:22px; padding:0 16px 4px 10px; } .b .l { font-size:15px; } .b .s { font-size:11px; }
  .wide .b.main { border-radius:22px 0 0 22px; } .wide .sq { width:50px; font-size:22px; } .wide .sq.r { border-radius:0 22px 22px 0; }
  .ro { font-size:15px; gap:2px 8px; } .ro .k { width:10px; height:15px; }
}
@media (max-width: 700px) { .main { grid-template-columns:1fr; } }
`;

// Original LCARS-flavoured chirps (synthesised, not samples).
var LCARS_SFX = {
  tap: [[1320, 0, 0.045], [1760, 0.055, 0.06]],
  step: [[1760, 0, 0.04]],
  stepDown: [[1175, 0, 0.04]],
  scene: [[1047, 0, 0.045], [1319, 0.05, 0.045], [1568, 0.1, 0.045], [2093, 0.15, 0.09]],
  script: [[988, 0, 0.06], [1480, 0.08, 0.06], [1976, 0.16, 0.1]],
  nav: [[620, 0, 0.13, 1500], [1760, 0.15, 0.05], [2349, 0.21, 0.06]],
  on: [[880, 0, 0.05], [1175, 0.06, 0.05], [1568, 0.12, 0.08]],
  off: [[1568, 0, 0.05], [1175, 0.06, 0.05], [880, 0.12, 0.08]],
  toggle: [[2093, 0, 0.035], [1568, 0.045, 0.035]],
  // Rising alert whoops, used when there's no "battlestations" clip.
  klaxon: [0, 1, 2, 3].map(function (i) { return [380, i * 0.75, 0.6, 1150]; }),
  // Timer done: three groups of three pips.
  alarm: [0, 1, 2].reduce(function (a, g) {
    return a.concat([0, 1, 2].map(function (i) { return [1760, g * 0.9 + i * 0.16, 0.1]; }));
  }, []),
};

var LCARS_CLIP = { clip: true, raw: true, chime: false, rate: 1 };

class LcarsPanelCard extends TabletPanelBase {
  _kind() { return 'lcars'; }
  _audioLabel() { return 'AUDIO ' + (this._audioOn ? 'ON' : 'OFF'); }

  _sfx(kind, it, op) {
    if (kind === 'press' && it.alert) { // red alert on the panel straight away
      this._redAt = Date.now();
      var lc = this.shadowRoot.querySelector('.lc');
      if (lc) lc.classList.add('red');
    }
    if (!this._audioOn) return;
    if (kind === 'error') return tpAudio.seq([[233, 0, 0.16], [196, 0.2, 0.24]], 'square', 0.07);
    if (kind === 'nav') return tpAudio.seq(LCARS_SFX.nav, 'sine', 0.16);
    if (kind !== 'press') return;
    if (it.sound) { // e.g. battlestations: its own clip, no captain
      if (!this._clip(it.sound)) tpAudio.seq(LCARS_SFX.klaxon, 'sawtooth', 0.07);
      return;
    }
    if (op === 'up') return tpAudio.seq(LCARS_SFX.step, 'triangle', 0.2);
    if (op === 'down') return tpAudio.seq(LCARS_SFX.stepDown, 'triangle', 0.2);
    if (op === 'cancel') return tpAudio.seq(LCARS_SFX.off, 'sine', 0.15);
    var captain = op === 'main' && this._maybeCaptain();
    if (captain) this._capAt[it._key] = Date.now();
    if (it.type === 'script' && !captain) this._clip('working');
    if (it.type === 'scene') return tpAudio.seq(LCARS_SFX.scene, 'sine', 0.16);
    if (it.type === 'script') return tpAudio.seq(LCARS_SFX.script, 'sine', 0.16);
    tpAudio.seq(LCARS_SFX.tap, 'triangle', 0.2);
  }

  // Plays one of the clips mapped to an event (sound_map in panel-config.json).
  _clip(event, chance) {
    var list = (this._config.sounds || {})[event];
    if (!list || !list.length || !this._audioOn || !tpAudio.ready()) return false;
    if (chance != null && Math.random() >= chance) return false;
    tpVoice.say(this._hass, list[Math.floor(Math.random() * list.length)], LCARS_CLIP);
    return true;
  }

  // Now and then the captain confirms the order: your clips if you have them,
  // otherwise HA text-to-speech, slowed down.
  _captainCfg() {
    var c = this._config.captain || {};
    var chance = c.chance != null ? c.chance : 0.25;
    var clips = (this._config.sounds || {}).captain;
    if (clips && clips.length) return { chance: chance, lines: clips, voice: LCARS_CLIP };
    return {
      chance: chance,
      lines: c.lines || ['Engage.', 'Make it so.'],
      voice: { rate: c.rate || 0.78, chime: false, engine: c.engine, language: c.language, options: c.options },
    };
  }

  _maybeCaptain() {
    var cap = this._captainCfg();
    if (Math.random() >= cap.chance || !tpAudio.ready()) return false;
    var line = cap.lines[Math.floor(Math.random() * cap.lines.length)];
    tpVoice.say(this._hass, line, cap.voice);
    return true;
  }

  _onChange(it, txt, op) {
    var was = this._prev[it._key] || '';
    if (it.type === 'timer' && was === 'ACTIVE' && txt === 'IDLE' && op !== 'cancel') {
      var end = (this._tEnd || {})[it._key];
      if (end && end - Date.now() < 4000) { // ran out, rather than cancelled
        this._tFin = Date.now();
        this._note(String(it.label).toUpperCase() + ' COMPLETE', true);
        if (this._audioOn) tpAudio.seq(LCARS_SFX.alarm, 'square', 0.08);
      }
      return;
    }
    if (!this._audioOn) return;
    if (it.type === 'vacuum' && was.indexOf('CLEANING') === 0 && txt.indexOf('CLEANING') !== 0) this._clip('done');
    if (op !== 'main') return;
    var on = this._isOn(it);
    tpAudio.seq(on ? LCARS_SFX.on : LCARS_SFX.off, 'sine', 0.15);
    // Don't stack "affirmative" on top of a captain line for the same command.
    var cap = this._capAt[it._key];
    delete this._capAt[it._key];
    if (cap && Date.now() - cap < 10000) return;
    var chance = this._config.confirm_chance != null ? this._config.confirm_chance : 0.35;
    if (it.type === 'light' || it.type === 'toggle') this._clip('confirm', chance);
  }

  _ui(what) {
    if (what.indexOf('car:') === 0) { this._carAction(what.split(':')[1], what.split(':')[2]); return; }
    if (what.indexOf('en:days:') === 0) {
      var nd = +what.split(':')[2];
      if ([1, 7, 30].indexOf(nd) < 0 || nd === this._enDays()) return;
      this._enDaysV = nd;
      try { localStorage.setItem('tp-en-days', String(nd)); } catch (e) { /* no storage */ }
      if (this._audioOn) tpAudio.seq(LCARS_SFX.tap, 'triangle', 0.2);
      this._render();
      return;
    }
    if (what.indexOf('fam:') === 0) {
      var fp = this._famPeople()[+what.split(':')[2]];
      if (!fp) return;
      if (what.indexOf('fam:find:') === 0) {
        var ps = this._st(fp.person);
        if (this._audioOn) tpAudio.seq(LCARS_SFX.tap, 'triangle', 0.2);
        if (this._map && ps && ps.attributes.latitude != null) {
          this._mapTouched = Date.now();
          this._map.setView([ps.attributes.latitude, ps.attributes.longitude], 15);
        }
        return;
      }
      if (this._audioOn) tpAudio.seq(LCARS_SFX.toggle, 'sine', 0.16);
      this._call('input_boolean', 'toggle', { entity_id: fp.alert }, String(fp.name).toUpperCase() + ' HOME ALERT');
      return;
    }
    if (what === 'status') {
      this._clip('status') || tpAudio.seq(LCARS_SFX.tap, 'triangle', 0.2);
      this._statusReport();
      return;
    }
    if (what === 'closerep') {
      clearTimeout(this._repT);
      this._report = null;
      this._renderReport();
      tpAudio.seq(LCARS_SFX.toggle, 'sine', 0.16);
      return;
    }
    if (what !== 'audio') return;
    if (this._toggleAudio()) tpAudio.seq(LCARS_SFX.toggle, 'sine', 0.16);
  }

  _render() {
    var c = this._config;
    var self = this;
    if (!this._preloaded) {
      this._preloaded = true;
      this._capAt = {};
      // Greeting: only when switching here from the terminal, not on wake/reload.
      tpAudio.unlock();
      if (tpJustSwitched('/tablet-lcars')) setTimeout(function () { self._clip('open'); }, 400);
      setTimeout(function () {
        var cap = self._captainCfg();
        cap.lines.forEach(function (l) { tpVoice.preload(self._hass, l, cap.voice); });
        var s = self._config.sounds || {};
        Object.keys(s).forEach(function (k) { s[k].forEach(function (u) { tpVoice.preload(self._hass, u, LCARS_CLIP); }); });
      }, 1500);
    }
    // Family page: after the first build only the side panel and map markers change,
    // so the map isn't torn down on every location update.
    if (c.page === 'family' && this.shadowRoot.getElementById('famside')) {
      this.shadowRoot.getElementById('famside').innerHTML = this._famSide();
      this._famMarkers(false);
      return;
    }
    var col = function (i) { return LC[i % LC.length]; };
    var segs = function (arr) {
      return '<div class="segs">' + arr.map(function (s) {
        return '<div style="background:' + s[0] + ';' + (s[1] ? 'flex:' + s[1] : 'width:' + s[2] + 'px') + '"></div>';
      }).join('') + '</div>';
    };

    var shown = 0;
    var nav = (c.nav || []).map(function (n, i) {
      if (n.only && n.only !== 'lcars') return '';
      shown++;
      return '<button class="nav' + (self._navActive(n) ? ' active' : '') + '" data-nav="' + i + '" style="background:' + col(i + 1) + '">' +
        '<span>' + pad2(shown) + ' ' + esc(n.label) + '</span></button>';
    }).join('');

    var secHtml = function (sec, si) {
      var colour = sec.color || col(si * 2);
      var body = '';
      if (sec.html != null) {
        body = sec.html;
      } else if (sec.car) {
        body = self._carSummary(colour);
      } else if (sec.readouts) {
        body = '<div class="ro">' + (c.readouts || []).map(function (r, ri) {
          var v = self._readout(r);
          return '<span class="k" style="background:' + col(ri + 1) + '"></span><span class="n">' + esc(r.label) + '</span><span class="v">' + esc(v.text) + '</span>';
        }).join('') + '</div>';
      } else {
        body = '<div class="btns">' + (sec.items || []).map(function (it, ii) {
          var on = self._isOn(it) || it.type === 'scene' || (it.type === 'script' && !it.timer);
          var bg = it.color || (it.type === 'scene' ? col(ii + si + 3) : colour);
          var cls = 'b' + (on ? '' : ' off');
          var inner = '<span class="l">' + esc(it.label) + '</span><span class="s">' + esc(self._stateText(it)) + '</span>';
          if (it.type === 'light') {
            return '<div class="wide"><button class="' + cls + ' main" data-k="' + it._key + '" style="background:' + bg + '">' + inner + '</button>' +
              '<button class="b sq" data-k="' + it._key + '" data-op="down" style="background:' + col(si + 2) + '">&minus;</button>' +
              '<button class="b sq r" data-k="' + it._key + '" data-op="up" style="background:' + col(si + 3) + '">+</button></div>';
          }
          if (it.type === 'timer') {
            var fin = self._tFin && Date.now() - self._tFin < 15000 ? ' fin' : '';
            var tt = self._timerText(it);
            return '<div class="wide"><button class="b main' + fin + '" id="tmb-' + it._key + '" data-k="' + it._key + '" style="background:' + bg + '">' +
              '<span class="l tmr" id="tml-' + it._key + '">' + esc(tt[0]) + '</span><span class="s" id="tms-' + it._key + '">' + esc(tt[1]) + '</span></button>' +
              '<button class="b sq" data-k="' + it._key + '" data-op="down" style="background:' + col(si + 2) + '">&minus;</button>' +
              '<button class="b sq" data-k="' + it._key + '" data-op="up" style="background:' + col(si + 3) + '">+</button>' +
              '<button class="b sq x r" data-k="' + it._key + '" data-op="cancel" style="background:' + LC[6] + '">CANCEL</button></div>';
          }
          if (it.type === 'vacuum') {
            return '<div class="wide"><button class="' + cls + ' main" data-k="' + it._key + '" style="background:' + bg + '">' + inner + '</button>' +
              '<button class="b sq" data-k="' + it._key + '" data-op="dock" style="background:' + col(si + 2) + ';font-size:15px">DOCK</button>' +
              '<button class="b sq r" data-k="' + it._key + '" data-op="locate" style="background:' + col(si + 3) + ';font-size:15px">FIND</button></div>';
          }
          return '<button class="' + cls + '" data-k="' + it._key + '" style="background:' + bg + (it.span ? ';grid-column:span ' + it.span : '') + '">' + inner + '</button>';
        }).join('') + '</div>';
      }
      return '<div class="sec" style="' + (sec.span ? 'grid-column:1/-1' : '') + '"><div class="sh"><span class="pill" style="background:' + colour + '"></span>' +
        '<span class="t" style="color:' + colour + '">' + esc(sec.title) + '</span><span class="ln" style="background:' + colour + '"></span></div>' + body + '</div>';
    };

    var left = [], right = [];
    var mainHtml = null;
    if (c.page === 'family') {
      mainHtml = '<div class="main fam"><div class="mapcol">' +
        secHtml({ title: 'Locator', color: LC[1], html: '<div class="mapslot" id="mapslot"></div>' }, 0) + '</div>' +
        '<div id="famside" class="famside">' + this._famSide() + '</div></div>';
    } else if (c.page === 'server') {
      this._serverPage().forEach(function (sec, si) { (sec.column === 2 ? right : left).push(secHtml(sec, si + 1)); });
    } else if (c.page === 'energy') {
      this._energyPage().forEach(function (sec, si) { (sec.column === 2 ? right : left).push(secHtml(sec, si + 1)); });
    } else if (c.page === 'forecast') {
      this._forecastPage().forEach(function (sec, si) { (sec.column === 2 ? right : left).push(secHtml(sec, si + 1)); });
    } else if (c.page === 'car') {
      var cp = this._carPage();
      cp.forEach(function (sec, si) { (sec.column === 2 ? right : left).push(secHtml(sec, si + 1)); });
    } else {
      c.sections.forEach(function (sec, si) {
        if (sec.only && sec.only !== 'lcars') return;
        (sec.column === 2 ? right : left).push(secHtml(sec, si));
      });
    }

    // Remember when running timers end, so a finish can be told apart from a cancel.
    this._tEnd = {};
    this._items.forEach(function (it) {
      var s = it.type === 'timer' && self._st(it.entity);
      if (s && s.state === 'active' && s.attributes.finishes_at) self._tEnd[it._key] = Date.parse(s.attributes.finishes_at);
    });
    var red = (this._redAt && Date.now() - this._redAt < 3000) ||
      this._items.some(function (it) { return it.alert && self._isOn(it); });

    if (mainHtml == null) {
      mainHtml = '<div class="main"><div style="display:flex;flex-direction:column;gap:14px">' + left.join('') +
        '</div><div style="display:flex;flex-direction:column;gap:14px">' + right.join('') + '</div></div>';
    }
    this.shadowRoot.innerHTML = (c.page === 'family' ? '<link rel="stylesheet" href="' + TP_LEAFLET + '.css">' : '') +
      '<style>' + LCARS_CSS + '</style>' +
      '<div class="lc' + (red ? ' red' : '') + '">' +
      '<div class="top"><div class="elbow" style="--c:' + LC[0] + ';background:' + LC[0] + '">' + esc(c.code || '47-0114') + '</div>' +
      '<div class="cap">' + segs([[LC[0], 3], [LC[1], 0, 90], [LC[3], 1], [LC[2], 0, 40]]) +
      '<div class="head"><div class="clockbox"><span id="clock"></span><span id="date"></span></div><span class="title" data-ui="status">' + esc(c.title || 'Home Ops') + '</span></div></div></div>' +
      '<div class="mid"><div class="side">' + nav + '<button class="fill" id="audio" data-ui="audio" style="background:' + LC[2] + '">' + this._audioLabel() + '</button>' +
      '<div class="nav" style="background:' + LC[6] + ';height:36px"></div></div>' +
      mainHtml +
      '<div id="repwrap">' + this._reportHtml() + '</div></div>' +
      '<div class="bot"><div class="elbow" style="--c:' + LC[1] + ';background:' + LC[1] + '">' + esc(c.code2 || 'OPS') + '</div>' +
      '<div class="cap"><div class="status" id="status"></div>' + segs([[LC[1], 2], [LC[4], 0, 120], [LC[5], 1], [LC[0], 0, 60]]) + '</div></div>' +
      '</div>';
    if (c.page === 'family') this._famMap();
  }

  // ---- server (Glances) ----------------------------------------------------
  // config.server: { prefix, glances, name, disks: [{label, key}], temps: [{label, key}] }
  _srvSt(key) { return this._st(this._config.server.prefix + key); }
  _srvNum(key) { var s = this._srvSt(key); var n = s ? parseFloat(s.state) : NaN; return isNaN(n) ? null : n; }
  _serverIds() {
    var c = this._config.server, self = this;
    if (!c || this._config.page !== 'server') return [];
    var keys = ['cpu_usage', 'cpu_load', 'memory_usage', 'memory_use', 'memory_free', 'uptime', 'containers_active', 'eth0_rx', 'eth0_tx'];
    (c.disks || []).forEach(function (d) { keys.push(d.key + '_disk_usage', d.key + '_disk_used', d.key + '_disk_size'); });
    (c.temps || []).forEach(function (t) { keys.push(t.key); });
    return keys.map(function (k) { return self._config.server.prefix + k; });
  }

  _gib(g) { return g == null ? '--' : g >= 1024 ? (g / 1024).toFixed(2) + ' TB' : g >= 100 ? Math.round(g) + ' GB' : g.toFixed(1) + ' GB'; }

  _mbar(pct) {
    var p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
    var colour = p >= 90 ? '#ff5050' : p >= 75 ? '#ffcc66' : '#99ccff';
    return '<span class="mbar"><i style="width:' + p + '%;background:' + colour + '"></i></span>';
  }

  // Container list comes straight from the Glances API (HA only has counts).
  _fetchContainers() {
    var c = this._config.server, self = this;
    if (!c || !c.glances || this._ctrBusy) return;
    this._ctrBusy = true;
    fetch(c.glances.replace(/\/$/, '') + '/api/4/containers')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (list) { self._ctr = { list: list, at: Date.now() }; })
      .catch(function () { self._ctr = { list: (self._ctr || {}).list || null, at: Date.now(), err: true }; })
      .then(function () { self._ctrBusy = false; if (self._config.page === 'server') self._render(); });
  }

  _serverPage() {
    var self = this, c = this._config.server;
    var row = function (label, pct, text) {
      return '<span class="k">' + esc(label) + '</span>' + self._mbar(pct) + '<span class="v">' + esc(text) + '</span>';
    };
    var up = this._srvSt('uptime'), upTxt = '--';
    if (up && up.state && !isNaN(Date.parse(up.state))) {
      var mins = Math.floor((Date.now() - Date.parse(up.state)) / 60000);
      upTxt = mins >= 1440 ? Math.floor(mins / 1440) + ' DAYS ' + Math.floor((mins % 1440) / 60) + ' HRS' : Math.floor(mins / 60) + ' HRS ' + (mins % 60) + ' MIN';
    }
    var cpu = this._srvNum('cpu_usage'), mem = this._srvNum('memory_usage'), memUse = this._srvNum('memory_use');
    var load = this._srvNum('cpu_load');
    var core = '<div class="kv"><span class="k">Host</span><span class="v">' + esc((c.name || 'server').toUpperCase()) + '</span>' +
      '<span class="k">Uptime</span><span class="v">' + esc(upTxt) + '</span></div>' +
      '<div class="bars">' +
      row('CPU', cpu, cpu == null ? '--' : cpu.toFixed(0) + '%' + (load != null ? '  LOAD ' + load.toFixed(2) : '')) +
      row('Memory', mem, mem == null ? '--' : mem.toFixed(0) + '%' + (memUse != null ? '  ' + this._gib(memUse / 1024) : '')) +
      '</div>' +
      '<div class="kv">' + (c.temps || []).map(function (t) {
        var v = self._srvNum(t.key);
        return '<span class="k">' + esc(t.label) + ' temp</span><span class="v' + (v != null && v >= 80 ? ' warn' : '') + '">' + (v == null ? '--' : Math.round(v) + '°C') + '</span>';
      }).join('') + '</div>';

    var arrUsed = 0, arrSize = 0;
    var storage = '<div class="bars">' + (c.disks || []).map(function (d) {
      var pct = self._srvNum(d.key + '_disk_usage'), used = self._srvNum(d.key + '_disk_used'), size = self._srvNum(d.key + '_disk_size');
      if (d.array && used != null && size != null) { arrUsed += used; arrSize += size; }
      return row(d.label, pct, used == null ? '--' : self._gib(used) + ' / ' + self._gib(size));
    }).join('') + '</div>' +
      (arrSize ? '<div class="kv"><span class="k">Array free</span><span class="v">' + this._gib(arrSize - arrUsed) + ' of ' + this._gib(arrSize) + '</span></div>' : '');

    var rx = this._srvNum('eth0_rx'), tx = this._srvNum('eth0_tx');
    var net = '<div class="kv"><span class="k">Down / up</span><span class="v">' +
      (rx == null ? '--' : rx.toFixed(1)) + ' / ' + (tx == null ? '--' : tx.toFixed(1)) + ' MBIT/S</span></div>';

    var ctr = this._ctr, list = ctr && ctr.list;
    var cbody;
    if (!list) {
      var n = this._srvNum('containers_active');
      cbody = '<div class="kv"><span class="k">Running</span><span class="v">' + (n == null ? '--' : n) + '</span>' +
        '<span class="k">Detail</span><span class="v' + (ctr && ctr.err ? ' warn' : '') + '">' + (ctr && ctr.err ? 'GLANCES UNREACHABLE' : 'SCANNING...') + '</span></div>';
    } else {
      list = list.slice().sort(function (a, b) { return ((b.cpu || {}).total || 0) - ((a.cpu || {}).total || 0); });
      cbody = '<div class="ctr">' + list.map(function (x) {
        var okState = ['running', 'healthy'].indexOf(String(x.status)) >= 0;
        var memMb = x.memory && x.memory.usage != null ? x.memory.usage / 1048576 : null;
        return '<span class="cn"><i class="dot" style="background:' + (okState ? '#99ff99' : '#ff5050') + '"></i>' + esc(x.name) + '</span>' +
          '<span class="cv">' + (x.cpu && x.cpu.total != null ? x.cpu.total.toFixed(1) + '%' : '--') + '</span>' +
          '<span class="cv">' + (memMb == null ? '--' : memMb >= 1024 ? (memMb / 1024).toFixed(1) + ' GB' : Math.round(memMb) + ' MB') + '</span>';
      }).join('') + '</div>' + (ctr.err ? '<div class="kv"><span class="k">Note</span><span class="v warn">LIST MAY BE STALE</span></div>' : '');
    }
    var running = list ? list.filter(function (x) { return ['running', 'healthy'].indexOf(String(x.status)) >= 0; }).length : null;
    return [
      { title: 'Core systems', html: core, color: LC[0] },
      { title: 'Storage', html: storage, color: LC[3] },
      { title: 'Containers' + (list ? ' ' + running + '/' + list.length : ''), html: cbody, color: LC[5], column: 2 },
      { title: 'Network', html: net, color: LC[1], column: 2 },
    ];
  }

  // ---- energy (Octopus + metered plugs) -----------------------------------
  // config.energy: { elec:{kwh,cost,rate,standing,live_kwh,live_cost,demand}, gas:{...}, outdoor,
  //   devices:[{name, energy|power, kw, max_kw, color}] }. Octopus history arrives a day or two late,
  //   so "today" is the Home Mini live total when it reports, otherwise a model (see tpEnergyModel).
  _energyIds() {
    var e = this._config.energy;
    if (!e || !this._enPage()) return [];
    var ids = [e.outdoor];
    ['elec', 'gas'].forEach(function (f) { var x = e[f] || {}; ids.push(x.rate, x.standing, x.live_kwh, x.live_cost, x.demand); });
    (e.devices || []).forEach(function (d) { ids.push(d.power, d.energy); });
    return ids.filter(Boolean);
  }

  // Pages that need the energy history (the energy page and the month forecast).
  _enPage() { var p = this._config && this._config.page; return p === 'energy' || p === 'forecast'; }

  // Devices window in days (1, 7 or 30), remembered per tablet.
  _enDays() {
    if (!this._enDaysV) {
      var v = 7;
      try { v = +localStorage.getItem('tp-en-days') || 7; } catch (e) { /* no storage */ }
      this._enDaysV = [1, 7, 30].indexOf(v) >= 0 ? v : 7;
    }
    return this._enDaysV;
  }

  _fetchEnergy() {
    var e = this._config.energy, self = this;
    if (!e || this._enBusy || !this._hass || !this._hass.callWS) return;
    this._enBusy = true;
    var now = Date.now();
    var dayIds = [e.elec.kwh, e.elec.cost, e.gas.kwh, e.gas.cost, e.outdoor];
    var hourIds = [e.elec.kwh, e.gas.kwh, e.outdoor].concat((e.devices || []).map(function (d) { return d.energy || d.power; }));
    var q = function (ids, period, days) {
      return self._hass.callWS({ type: 'recorder/statistics_during_period', start_time: new Date(now - days * 864e5).toISOString(),
        statistic_ids: ids, period: period, types: ['change', 'mean'] });
    };
    Promise.all([q(dayIds, 'day', 62), q(hourIds, 'hour', 31)])
      .then(function (r) { self._en = { day: r[0] || {}, hour: r[1] || {}, at: Date.now() }; })
      .catch(function () { self._en = { day: (self._en || {}).day || {}, hour: (self._en || {}).hour || {}, at: Date.now(), err: true }; })
      .then(function () { self._enBusy = false; if (self._enPage()) self._render(); });
  }

  _energyPage() {
    var e = this._config.energy, self = this;
    if (!this._en) {
      return [{ title: 'Energy', color: LC[0], html: '<div class="kv"><span class="k">Status</span><span class="v">LOADING HISTORY...</span></div>' }];
    }
    var states = {};
    this._energyIds().forEach(function (id) { if (self._st(id)) states[id] = self._st(id); });
    var m = tpEnergyModel(e, this._en.day, this._en.hour, states, new Date(), this._enDays());
    var gbp = function (v) { return v == null || isNaN(v) ? '--' : '£' + v.toFixed(2); };
    var kwh = function (v) { return v == null ? '--' : (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' KWH'; };
    var kv = function (rows) {
      return '<div class="kv">' + rows.map(function (r) {
        return '<span class="k">' + esc(r[0]) + '</span><span class="v' + (r[2] ? ' ' + r[2] : '') + '">' + esc(r[1]) + '</span>';
      }).join('') + '</div>';
    };
    var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var when = function (ms) { var d = new Date(ms); return days[d.getDay()] + ' ' + d.getDate() + ' ' + pad2(d.getHours()) + ':00'; };
    var EC = '#99ccff', GC = '#ff9c00';

    // Today
    var t = m.today;
    var today = '<div class="entop"><span class="big">' + gbp(t.total) + '</span><span class="ensrc' + (t.live ? ' hi' : '') + '">' +
      (t.live ? 'LIVE + FORECAST' : 'ESTIMATE · NO LIVE FEED') + '</span></div>' +
      kv([['Electricity', kwh(t.elecKwh) + '  ' + gbp(t.elecCost)],
        ['Gas', kwh(t.gasKwh) + '  ' + gbp(t.gasCost)],
        ['Standing charges', gbp(t.standing)],
        [m.nowLive ? 'Using now' : 'Plugs using now', m.nowW == null ? '--' : m.nowW >= 1000 ? (m.nowW / 1000).toFixed(2) + ' KW' : Math.round(m.nowW) + ' W'],
        ['Outside', m.tempNow == null ? '--' : m.tempNow.toFixed(1) + '°C']]);

    // Daily cost chart
    var mx = 0;
    m.daily.forEach(function (d) { mx = Math.max(mx, (d.e || 0) + (d.g || 0)); });
    mx = Math.max(mx, t.total || 0) || 1;
    var bars = m.daily.map(function (d, i) {
      var hE = d.e == null ? 0 : d.e / mx * 100, hG = d.g == null ? 0 : d.g / mx * 100;
      var lab = (d.date.getDate() === 1 || i % 5 === 0) ? '<b>' + d.date.getDate() + '</b>' : '';
      return '<span class="ec' + (d.today ? ' est' : '') + (d.e == null && d.g == null ? ' none' : '') + '">' +
        '<i style="height:' + hG + '%;background:' + GC + '"></i><i style="height:' + hE + '%;background:' + EC + '"></i>' + lab + '</span>';
    }).join('');
    var chart = '<div class="echart"><span class="emax">' + gbp(mx) + '</span>' + bars + '</div>' +
      '<div class="elegend"><span><i style="background:' + EC + '"></i>ELECTRIC</span><span><i style="background:' + GC + '"></i>GAS</span><span class="dim">LAST BAR = TODAY EST.</span></div>' +
      kv([['Last 7 days', gbp(m.week)], ['This month (proj.)', gbp(m.monthProj)],
        ['Gas vs weather (7 days)', m.gasVs == null ? '--' : (m.gasVs > 0 ? '+' : '') + Math.round(m.gasVs) + '%', m.gasVs == null ? '' : m.gasVs > 5 ? 'warn' : m.gasVs < -5 ? 'hi' : '']]);

    // Devices, over 1, 7 or 30 days (chips switch it; the choice is remembered on this tablet).
    var span = m.devDays === 1 ? 'Last 24 hours' : 'Last ' + m.devDays + ' days';
    var dchips = '<div class="chips">' + [1, 7, 30].map(function (n) {
      return '<button class="b' + (n === m.devDays ? '' : ' off') + '" data-ui="en:days:' + n + '" style="background:' + LC[1] + '">' +
        '<span class="l">' + n + (n === 1 ? ' day' : ' days') + '</span></button>';
    }).join('') + '</div>';
    var dev = dchips + '<div class="bars">' + m.devices.map(function (d) {
      var pct = m.devTotal && d.kwh != null ? d.kwh / m.devTotal * 100 : 0;
      var val = d.unknown ? 'AWAITING OCTOPUS' : kwh(d.kwh) + ' ' + gbp(d.cost);
      return '<span class="k">' + esc(d.name) + '</span>' +
        '<span class="mbar"><i style="width:' + Math.min(100, pct) + '%;background:' + (d.color || EC) + '"></i></span>' +
        '<span class="v' + (d.unknown ? ' dim' : '') + '">' + val + (d.nowW != null && d.nowW >= 5 ? ' · ' + (d.nowW >= 1000 ? (d.nowW / 1000).toFixed(1) + 'KW' : Math.round(d.nowW) + 'W') : '') + '</span>';
    }).join('') + '</div>';
    var drows = [['Gas heating + hot water', m.gasDev == null ? 'AWAITING OCTOPUS' : kwh(m.gasDev) + ' ' + gbp(m.gasDevCost), m.gasDev == null ? 'dim' : '']];
    if (m.houseBehind && m.houseLast != null) drows.push(['House total up to', when(m.houseLast + 36e5), 'dim']);
    dev += kv(drows);

    // Spikes
    var spikes = m.spikes.length ? '<div class="spk">' + m.spikes.map(function (s) {
      return '<span class="sw">' + esc(when(s.at)) + '</span><span class="sv">' + esc(s.kwh.toFixed(1)) + ' KWH ' + gbp(s.cost) + '</span>' +
        '<span class="sd">' + esc(s.parts.map(function (p) { return p[0].toUpperCase() + ' ' + p[1].toFixed(1); }).join(' · ')) + '</span>';
    }).join('') + '</div>' : kv([['Spikes', 'NONE FOUND']]);
    var gasSp = m.gasSpikes.length ? kv(m.gasSpikes.map(function (s) { return ['Gas ' + when(s.at), s.kwh.toFixed(1) + ' KWH ' + gbp(s.cost)]; })) : '';

    return [
      { title: 'Today', html: today, color: LC[3] },
      { title: 'Daily cost · 30 days', html: chart, color: LC[5] },
      { title: 'Devices · ' + span.replace('Last ', '').toLowerCase(), html: dev, color: LC[1], column: 2 },
      { title: 'Spikes · 7 days', html: spikes + gasSp + (this._en.err ? kv([['Note', 'HISTORY MAY BE STALE', 'warn']]) : ''), color: LC[6], column: 2 },
    ];
  }

  // ---- month forecast (page: forecast; same history as the energy page) -------
  _forecastPage() {
    var e = this._config.energy, self = this;
    if (!this._en) {
      return [{ title: 'Forecast', color: LC[0], html: '<div class="kv"><span class="k">Status</span><span class="v">LOADING HISTORY...</span></div>' }];
    }
    var states = {};
    this._energyIds().forEach(function (id) { if (self._st(id)) states[id] = self._st(id); });
    var now = new Date();
    var f = tpForecastModel(e, this._en.day, this._en.hour, states, now);
    var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var gbp = function (v) { return v == null || isNaN(v) ? '--' : '£' + (v >= 100 ? Math.round(v) : v.toFixed(2)); };
    var kwh = function (v) { return v == null ? '--' : (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' KWH'; };
    var when = function (ms) { var d = new Date(ms); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + pad2(d.getHours()) + ':00'; };
    var kv = function (rows) {
      return '<div class="kv">' + rows.map(function (r) {
        return '<span class="k">' + esc(r[0]) + '</span><span class="v' + (r[2] ? ' ' + r[2] : '') + '">' + esc(r[1]) + '</span>';
      }).join('') + '</div>';
    };
    var endLabel = f.dim + ' ' + MON[f.month];

    // Summary
    var sum = '<div class="entop"><span class="big">' + gbp(f.total) + '</span><span class="ensrc">PROJECTED TO ' + endLabel + '</span></div>' +
      kv([['Spent so far', gbp(f.soFar)],
        ['Days left', f.daysLeft.toFixed(1) + ' OF ' + f.dim],
        ['Electricity (proj.)', gbp(f.elecProjCost)],
        ['Gas (proj.)', gbp(f.gas.projCost)],
        ['Standing charges', gbp(f.standing)],
        ['Unit rates', '£' + f.rateE.toFixed(3) + ' ELEC · £' + f.rateG.toFixed(3) + ' GAS', 'dim']]);
    var notes = [];
    if (f.houseAsOf) notes.push(['Octopus electricity to', when(f.houseAsOf), 'dim']);
    if (f.gas.asOf) notes.push(['Octopus gas to', when(f.gas.asOf), 'dim']);
    if (this._en.err) notes.push(['Note', 'HISTORY MAY BE STALE', 'warn']);
    sum += kv(notes);

    // Devices: solid = spent so far, faded = still to come; value = so far -> projected.
    var rows = f.devices.concat([{ name: 'Gas heating + hot water', color: '#ff9c00', soFar: f.gas.soFar, proj: f.gas.proj, cost: f.gas.cost, projCost: f.gas.projCost }]);
    rows.sort(function (a, b) { return b.projCost - a.projCost; });
    var mx = 0; rows.forEach(function (r) { mx = Math.max(mx, r.projCost); });
    var dev = '<div class="bars fc">' + rows.map(function (r) {
      var a = mx ? r.cost / mx * 100 : 0, b = mx ? Math.max(0, r.projCost - r.cost) / mx * 100 : 0;
      return '<span class="k">' + esc(r.name) + (r.since ? ' <em>*</em>' : '') + '</span>' +
        '<span class="mbar"><i style="width:' + Math.min(100, a) + '%;background:' + (r.color || '#99ccff') + '"></i>' +
        '<i style="width:' + Math.min(100 - a, b) + '%;background:' + (r.color || '#99ccff') + ';opacity:.35"></i></span>' +
        '<span class="v"><span class="dim">' + gbp(r.cost) + ' → </span>' + gbp(r.projCost) + '</span>';
    }).join('') + '</div>';
    var since = f.devices.filter(function (r) { return r.since; });
    var foot = [['Bars', 'SOLID = SO FAR · FADED = TO COME', 'dim']];
    if (since.length) foot.push(['* Reporting since', since.map(function (r) { var d = new Date(r.since); return d.getDate() + ' ' + MON[d.getMonth()]; })[0] + (since.length > 1 ? ' (AND OTHERS)' : ''), 'dim']);
    dev += kv(foot);

    // Daily rate behind each projection.
    var rate = kv(rows.filter(function (r) { return r.perDay != null || r.name.indexOf('Gas') === 0; }).slice(0, 8).map(function (r) {
      var pd = r.perDay != null ? r.perDay : f.gas.perDay, rr = r.name.indexOf('Gas') === 0 ? f.rateG : f.rateE;
      return [r.name, kwh(pd) + ' · ' + gbp(pd * rr) + ' / DAY'];
    }));

    return [
      { title: 'Month · ' + MON[f.month] + ' ' + f.year, html: sum, color: LC[3] },
      { title: 'Recent daily use', html: rate, color: LC[5] },
      { title: 'Devices · projected to ' + endLabel.toLowerCase(), html: dev, color: LC[1], column: 2 },
    ];
  }

  // ---- family locator ----------------------------------------------------
  _famPeople() { return (this._config.family && this._config.family.people) || []; }

  _famSide() {
    var self = this;
    var dirs = { towards: 'HEADING HOME', away_from: 'MOVING AWAY', stationary: 'STATIONARY', arrived: 'ARRIVED' };
    return this._famPeople().map(function (p, i) {
      var ps = self._st(p.person);
      var dist = self._st('sensor.' + p.prefix + '_distance'), dir = self._st('sensor.' + p.prefix + '_direction_of_travel');
      var bat = self._st(p.battery), alert = self._st(p.alert), trip = self._st(p.trip);
      var place = !ps ? 'NO SIGNAL' : ps.state === 'home' ? 'HOME' : ps.state === 'not_home' ? 'AWAY'
        : (self._st('zone.' + ps.state) ? self._st('zone.' + ps.state).attributes.friendly_name : ps.state).toUpperCase();
      var m = dist ? parseFloat(dist.state) : NaN;
      var km = isNaN(m) ? '--' : (dist.attributes.unit_of_measurement === 'km' ? m : m / 1000);
      var kmTxt = km === '--' ? '--' : km < 0.1 ? 'AT HOME' : (km < 10 ? km.toFixed(1) : Math.round(km)) + ' KM';
      var dt = dir ? (dirs[dir.state] || (ps && ps.state === 'home' ? 'AT HOME' : '--')) : '--';
      var fix = ps && ps.last_updated ? new Date(ps.last_updated) : null;
      var ago = fix ? Math.round((Date.now() - fix) / 60000) : null;
      var tk = trip ? parseFloat(trip.state) : 0;
      var rows = [['Location', place], ['Distance', kmTxt], ['Travel', dt, dt === 'HEADING HOME'],
        ['Furthest trip', tk > 0 ? (tk < 10 ? tk.toFixed(1) : Math.round(tk)) + ' KM' : '--'],
        ['Phone', bat ? Math.round(parseFloat(bat.state)) + '%' : '--', bat && parseFloat(bat.state) < 15],
        ['Last fix', ago == null ? '--' : ago < 1 ? 'NOW' : ago < 60 ? ago + ' MIN AGO' : self._hhmm(fix)]];
      var on = alert && alert.state === 'on';
      return '<div class="sec"><div class="sh"><span class="pill" style="background:' + p.color + '"></span>' +
        '<span class="t" style="color:' + p.color + '">' + esc(p.name) + '</span><span class="ln" style="background:' + p.color + '"></span></div>' +
        '<div class="kv">' + rows.map(function (r) {
          return '<span class="k">' + esc(r[0]) + '</span><span class="v' + (r[2] ? ' hi' : '') + '">' + esc(r[1]) + '</span>';
        }).join('') + '</div>' +
        '<div class="chips"><button class="b" data-ui="fam:find:' + i + '" style="background:' + p.color + '"><span class="l">Find</span></button>' +
        '<button class="b' + (on ? '' : ' off') + '" data-ui="fam:alert:' + i + '" style="background:' + LC[3] + '"><span class="l">Home alert ' + (on ? 'on' : 'off') + '</span></button></div></div>';
    }).join('');
  }

  // The Leaflet map lives in one element that is kept across renders.
  _famMap() {
    var self = this, slot = this.shadowRoot.getElementById('mapslot');
    if (!slot) return;
    if (!this._mapBox) { this._mapBox = document.createElement('div'); this._mapBox.className = 'mapbox'; }
    slot.appendChild(this._mapBox);
    tpLeaflet().then(function (L) {
      if (!self._map) {
        self._map = L.map(self._mapBox, { zoomControl: false });
        // Standard OpenStreetMap tiles, darkened with a CSS filter (see .leaflet-tile-pane).
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(self._map);
        self._layers = L.layerGroup().addTo(self._map);
        self._map.on('dragstart', function () { self._mapTouched = Date.now(); });
      }
      // Leaflet forces position:relative if the box was off-screen when the map was made,
      // which collapses it to zero height. Pin it back.
      self._mapBox.style.position = 'absolute';
      setTimeout(function () { self._map.invalidateSize(); self._famMarkers(true); }, 60);
    }).catch(function () { slot.innerHTML = '<div class="nomap">MAP OFFLINE</div>'; });
  }

  _famMarkers(fit, only) {
    var L = window.L, map = this._map, self = this;
    if (!L || !map || !this._layers) return;
    this._layers.clearLayers();
    // Everything is drawn as HTML markers: the SVG layer Leaflet uses for circles
    // ends up offset on the Fire tablet's WebView.
    var pin = function (ll, html) {
      L.marker(ll, { interactive: false, icon: L.divIcon({ className: 'tp-pin', html: html, iconSize: [0, 0] }) }).addTo(self._layers);
    };
    var pts = [], home = this._st('zone.home');
    Object.keys(this._hass.states).forEach(function (id) {
      if (id.indexOf('zone.') !== 0) return;
      var z = self._hass.states[id].attributes;
      if (z.latitude == null || z.passive) return;
      var colour = id === 'zone.home' ? '#ffcc66' : '#cc99cc';
      pin([z.latitude, z.longitude], '<i class="zd" style="border-color:' + colour + '"></i><span class="zn" style="color:' + colour + '">' + esc(z.friendly_name || id) + '</span>');
    });
    this._famPeople().forEach(function (p, i) {
      var s = self._st(p.person), a = s ? s.attributes : null;
      if (!a || a.latitude == null) return;
      var ll = [a.latitude, a.longitude];
      pin(ll, '<i class="pd" style="background:' + p.color + '"></i><span style="background:' + p.color + ';top:' + (-11 + i * 24) + 'px">' + esc(p.name) + '</span>');
      if (only == null || only === i) pts.push(ll);
    });
    // Vehicles: square markers, labels stacked below the people's.
    var np = this._famPeople().length;
    ((this._config.family && this._config.family.vehicles) || []).forEach(function (v, k) {
      var s = self._st(v.tracker), a = s ? s.attributes : null;
      if (!a || a.latitude == null) return;
      var ll = [a.latitude, a.longitude];
      pin(ll, '<i class="vd" style="background:' + v.color + '"></i><span style="background:' + v.color + ';top:' + (-11 + (np + k) * 24) + 'px">' + esc(v.name) + '</span>');
      if (only == null) pts.push(ll);
    });
    var userMoved = this._mapTouched && Date.now() - this._mapTouched < 120000;
    if (!fit && userMoved) return;
    if (home && home.attributes.latitude != null && only == null) pts.push([home.attributes.latitude, home.attributes.longitude]);
    if (!pts.length) return;
    var b = L.latLngBounds(pts);
    if (pts.length === 1 || b.getNorthEast().distanceTo(b.getSouthWest()) < 600) map.setView(b.getCenter(), 15);
    else map.fitBounds(b, { padding: [36, 36], maxZoom: 15 });
  }

  _renderLog() {
    var s = this.shadowRoot.getElementById('status');
    if (!s) return;
    var last = this._log[this._log.length - 1];
    s.textContent = last ? last.t + '  ' + last.text : 'ALL SYSTEMS NOMINAL';
  }

  // ---- timer display ---------------------------------------------------
  // [big text, small text] for the timer button.
  _timerText(it) {
    var s = this._st(it.entity), state = s ? s.state : 'idle';
    if (state === 'active') return [tpMmss(this._timerLeft(it)), 'TAP TO HOLD'];
    if (state === 'paused') return ['HOLD ' + tpMmss(this._timerLeft(it)), 'TAP TO RESUME'];
    return [this._timerMins(it) + ' MIN', 'TAP TO START'];
  }

  _onTick() {
    var root = this.shadowRoot, self = this;
    if (this._config && this._config.page === 'server' && (!this._ctr || Date.now() - this._ctr.at > 15000)) this._fetchContainers();
    if (this._config && this._enPage() && this._hass && (!this._en || Date.now() - this._en.at > 600000)) this._fetchEnergy();
    if (this._config && this._config.page === 'car' && this._hass && (!this._cc || Date.now() - this._cc.at > 600000)) this._fetchCarCost();
    // Map made while hidden: resize and refit once it is actually on screen.
    if (this._map && this._mapBox) {
      this._mapBox.style.position = 'absolute';
      var ms = this._map.getSize();
      if (this._mapBox.clientWidth && (ms.x !== this._mapBox.clientWidth || ms.y !== this._mapBox.clientHeight)) {
        this._map.invalidateSize();
        this._famMarkers(true);
      }
    }
    (this._items || []).forEach(function (it) {
      if (it.type !== 'timer') return;
      var t = self._timerText(it);
      var l = root.getElementById('tml-' + it._key), s = root.getElementById('tms-' + it._key);
      if (l) l.textContent = t[0];
      if (s) s.textContent = t[1];
      var b = root.getElementById('tmb-' + it._key);
      if (b && b.classList.contains('fin') && !(self._tFin && Date.now() - self._tFin < 15000)) b.classList.remove('fin');
    });
    var lc = root.querySelector('.lc');
    if (lc && lc.classList.contains('red') && !(this._redAt && Date.now() - this._redAt < 3000) &&
      !this._items.some(function (it) { return it.alert && self._isOn(it); })) lc.classList.remove('red');
  }

  // ---- status report ---------------------------------------------------
  // Collects alerts, updates, low batteries, open doors and offline devices
  // from HA, shows them over the controls and reads them out.
  _statusReport() {
    var self = this, h = this._hass;
    this._report = { lines: [['SCANNING', 'Interrogating home systems...', LC[5]]] };
    this._renderReport();
    var ws = function (type) { return h.callWS({ type: type }).catch(function () { return null; }); };
    var admin = h.user && h.user.is_admin;
    Promise.all([ws('persistent_notification/get'), admin ? ws('repairs/list_issues') : Promise.resolve(null)]).then(function (res) {
      var r = self._gatherStatus(res[0], res[1]);
      self._report = { lines: r.lines };
      self._renderReport();
      if (self._audioOn && tpAudio.ready()) {
        var v = { rate: 1, chime: false };
        tpVoice.preload(h, r.speech, v);
        tpVoice.say(h, r.speech, v);
      }
      clearTimeout(self._repT);
      self._repT = setTimeout(function () { self._report = null; self._renderReport(); }, 60000);
    });
  }

  _gatherStatus(notes, repairs) {
    var st = this._hass.states, reg = this._hass.entities || {};
    var cfg = this._config.status || {};
    var ex = cfg.exclude || [];
    var below = cfg.battery_below != null ? cfg.battery_below : 25;
    var name = function (s) { return String(s.attributes.friendly_name || s.entity_id); };
    var alerts = [], updates = [], batt = [], open = [], offline = [];
    Object.keys(st).sort().forEach(function (id) {
      if (ex.indexOf(id) >= 0) return;
      var s = st[id], dc = s.attributes.device_class, dom = id.split('.')[0];
      if (dom === 'binary_sensor' && s.state === 'on') {
        if (['problem', 'smoke', 'moisture', 'gas', 'safety', 'carbon_monoxide', 'tamper'].indexOf(dc) >= 0)
          alerts.push(name(s) + (dc === 'problem' ? '' : ' triggered'));
        else if (['door', 'window', 'garage_door', 'opening'].indexOf(dc) >= 0) open.push(name(s));
      } else if (dom === 'update' && s.state === 'on') {
        updates.push(name(s).replace(/\s+(firmware\s+)?update$/i, ''));
      } else if (dom === 'sensor' && dc === 'battery' && !isNaN(parseFloat(s.state)) && parseFloat(s.state) < below) {
        batt.push(name(s).replace(/\s+battery(\s+level)?$/i, '') + ' at ' + Math.round(parseFloat(s.state)) + ' percent');
      } else if ((dom === 'light' || dom === 'switch') && s.state === 'unavailable') {
        var e = reg[id];
        if (!e || (!e.entity_category && !e.hidden)) offline.push(name(s));
      }
    });
    // Car: windows open, unlocked while parked at home, low tyres.
    if (this._config.car) {
      var cw = this._carSt('sensor', 'windowposition'), cl = this._carSt('lock', 'doorlock');
      var ct = this._carSt('device_tracker', 'tracker'), cg = this._carSt('sensor', 'ignitionstatus');
      var ctp = this._carSt('sensor', 'tirepressure');
      if (cw && ['Closed', 'unknown', 'unavailable'].indexOf(cw.state) < 0) alerts.push('car windows open');
      if (cl && cl.state === 'unlocked' && ct && ct.state === 'home' && (!cg || cg.state === 'OFF')) alerts.push('car unlocked');
      if (ctp && ctp.state && ctp.state !== 'NORMAL' && ['unknown', 'unavailable'].indexOf(ctp.state) < 0) alerts.push('car tyre pressure low');
    }
    var issues = ((repairs || {}).issues || []).filter(function (i) { return !i.ignored && !i.dismissed_version; });
    var nl = (notes || []).map(function (n) { return n.title || String(n.message || '').slice(0, 60); });

    var join = function (a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; };
    var some = function (a, n) { return a.length > n ? a.slice(0, n).concat([(a.length - n) + ' more']) : a; };
    var lines = [], say = ['Status report.'];
    var add = function (cat, items, colour, spoken) {
      if (!items.length) return;
      lines.push([cat, items.join(' / '), colour]);
      say.push(spoken);
    };
    add('ALERT', alerts, '#ff4040', 'Alert: ' + join(some(alerts, 4)) + '.');
    add('NOTICES', nl, LC[3], nl.length + (nl.length === 1 ? ' notification: ' : ' notifications: ') + join(some(nl, 3)) + '.');
    add('REPAIRS', issues.map(function (i) { return (i.domain + ': ' + i.issue_id).replace(/_/g, ' '); }), LC[4],
      issues.length + (issues.length === 1 ? ' repair issue requires attention.' : ' repair issues require attention.'));
    add('UPDATES', updates, LC[5], (updates.length === 1 ? 'One update pending: ' : updates.length + ' updates pending: ') + join(some(updates, 4)) + '.');
    add('POWER', batt, LC[0], 'Low battery: ' + join(some(batt, 4)) + '.');
    add('OPEN', open, LC[1], 'Open: ' + join(some(open, 4)) + '.');
    add('OFFLINE', offline, LC[2], offline.length + (offline.length === 1 ? ' device offline: ' : ' devices offline: ') + join(some(offline, 4)) + '.');
    if (!lines.length) { lines.push(['STATUS', 'All systems nominal', LC[5]]); say.push('All systems nominal.'); }
    else say.push('End of report.');
    return { lines: lines, speech: say.join(' ') };
  }

  _reportHtml() {
    if (!this._report) return '';
    return '<div class="rep" data-ui="closerep"><div class="sh"><span class="pill" style="background:' + LC[5] + '"></span>' +
      '<span class="t" style="color:' + LC[5] + '">Status report</span><span class="ln" style="background:' + LC[5] + '"></span></div>' +
      '<div class="rl">' + this._report.lines.map(function (l) {
        return '<span class="c" style="color:' + l[2] + '">' + esc(l[0]) + '</span><span class="v">' + esc(l[1]) + '</span>';
      }).join('') + '</div>' +
      '<div class="ft"><span class="b" style="background:' + LC[5] + '"><span class="l">Close</span></span></div></div>';
  }

  _renderReport() {
    var w = this.shadowRoot.getElementById('repwrap');
    if (w) w.innerHTML = this._reportHtml();
  }

  // ---- car -------------------------------------------------------------
  _carInfo() {
    var soc = this._carSt('sensor', 'soc'), ch = this._carSt('sensor', 'elvehcharging'), ev = this._carSt('sensor', 'elveh');
    var a = ch ? ch.attributes : {};
    var pct = soc ? parseFloat(soc.state) : NaN;
    var range = soc && soc.attributes.batteryRange != null ? soc.attributes.batteryRange : (ev ? parseFloat(ev.state) : NaN);
    var status = ch ? String(ch.state) : 'UNKNOWN';
    var plugSt = this._carSt('sensor', 'elvehplug');
    var plug = a.plugStatus || (plugSt ? plugSt.state : '');
    var charging = status === 'IN_PROGRESS';
    var end = a.estimatedEndTime ? new Date(a.estimatedEndTime) : null;
    var text = charging ? 'CHARGING' + (a.chargingkW != null ? ' ' + Number(a.chargingkW).toFixed(1) + ' KW' : '')
      : plug === 'CONNECTED' ? 'PLUGGED IN, ' + status.replace(/_/g, ' ') : 'NOT PLUGGED IN';
    var rs = this._carSt('sensor', 'remotestartstatus'), ign = this._carSt('switch', 'ignition');
    var climate = (ign && ign.state === 'on') || (rs && rs.state !== 'Inactive' && rs.state !== 'unknown' && rs.state !== 'unavailable');
    return { pct: pct, range: range, charging: charging, plug: plug, status: status, text: text, end: end, a: a,
      max: ev ? ev.attributes.maximumBatteryRange : null, climate: climate, rs: rs };
  }

  _hhmm(d) { return d && !isNaN(d) ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '--:--'; }

  _cbar(pct, charging) {
    var n = isNaN(pct) ? 0 : Math.max(0, Math.min(10, Math.round(pct / 10)));
    var colour = pct < 20 ? '#ff5050' : pct < 40 ? '#ffcc66' : '#99ccff';
    var h = '<div class="cbar" style="--cf:' + colour + '">';
    for (var i = 0; i < 10; i++) h += '<i class="' + (i < n ? 'f' + (charging ? ' chg' : '') : '') + '"></i>';
    return h + '</div>';
  }

  _nextDeparture() {
    var s = this._carSt('sensor', 'departureschedules');
    if (!s || !s.state || s.state === 'unknown' || s.state === 'unavailable') return null;
    var d = new Date(s.state);
    return isNaN(d) ? null : d;
  }

  // Main screen: one row with charge, plus defrost and departure.
  _carSummary(colour) {
    var i = this._carInfo();
    var next = this._nextDeparture();
    var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var sub = i.text + (i.charging && i.end ? ', DONE ' + this._hhmm(i.end) : '');
    return this._cbar(i.pct, i.charging) +
      '<div class="wide"><button class="b main" data-ui="car:open" style="background:' + colour + '">' +
      '<span class="l">' + (isNaN(i.pct) ? '--' : Math.round(i.pct)) + '% &middot; ' + (isNaN(i.range) ? '--' : Math.round(i.range)) + ' KM</span>' +
      '<span class="s">' + esc(sub) + '</span></button>' +
      '<button class="b sq x" data-ui="car:' + (i.climate ? 'stop' : 'defrost') + '" style="background:' + (i.climate ? '#cc3333' : LC[5]) + '">' + (i.climate ? 'STOP' : 'DEFROST') + '</button>' +
      '<button class="b sq x r" data-ui="car:open" style="background:' + LC[3] + '">' + (next ? days[next.getDay()] + ' ' + this._hhmm(next) : 'DEPART') + '</button></div>';
  }

  _dep() {
    if (!this._depSt) {
      var d = null;
      try { d = JSON.parse(localStorage.getItem('tp-car-dep')); } catch (e) { /* none */ }
      this._depSt = d && d.days ? d : { h: 7, m: 30, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], pre: 'medium' };
    }
    return this._depSt;
  }
  _saveDep() { try { localStorage.setItem('tp-car-dep', JSON.stringify(this._depSt)); } catch (e) { /* no storage */ } }

  // Car page: four sections, two per column.
  _carPage() {
    var self = this, i = this._carInfo(), a = i.a;
    var st = function (d, k) { return self._carSt(d, k); };
    var val = function (d, k) { var s = st(d, k); return s ? s.state : '--'; };
    var kv = function (rows) {
      return '<div class="kv">' + rows.map(function (r) {
        return '<span class="k">' + esc(r[0]) + '</span><span class="v' + (r[2] ? ' warn' : '') + '">' + esc(r[1]) + '</span>';
      }).join('') + '</div>';
    };
    var chip = function (label, ui, bg, dim) {
      return '<button class="b' + (dim ? ' off' : '') + '" data-ui="' + ui + '" style="background:' + bg + '"><span class="l">' + esc(label) + '</span></button>';
    };

    // Power
    var tgt = st('select', 'elvehtargetcharge'), tv = tgt ? tgt.state : '';
    var chg = st('switch', 'elvehcharge');
    var power = '<div style="display:flex;align-items:baseline;justify-content:space-between"><span class="big">' +
      (isNaN(i.pct) ? '--' : Math.round(i.pct)) + '%</span><span style="color:#ffcc66;font-size:20px">' +
      (isNaN(i.range) ? '--' : Math.round(i.range)) + ' KM' + (i.max ? ' / ' + Math.round(i.max) + ' MAX' : '') + '</span></div>' +
      this._cbar(i.pct, i.charging) +
      kv([['Status', i.text],
        ['Supply', a.chargingVoltage != null ? Math.round(a.chargingVoltage) + ' V, ' + Number(a.chargingAmperage || 0).toFixed(1) + ' A' : '--'],
        ['Done by', i.charging && i.end ? this._hhmm(i.end) : '--'],
        ['Battery temp', a.batteryTemperature != null ? a.batteryTemperature + '°C' : '--']]) +
      '<div class="chips">' + ['80', '90', '100'].map(function (v) { return chip(v + '%', 'car:target:' + v, LC[0], tv !== v); }).join('') +
      (chg ? chip(chg.state === 'on' ? 'Pause' : 'Resume', 'car:charge:' + (chg.state === 'on' ? 'off' : 'on'), LC[4]) : '') + '</div>';

    // Climate
    var cd = st('sensor', 'remotestartcountdown');
    var climate = kv([['Cabin', val('sensor', 'cabintemperature') + '°C'], ['Outside', val('sensor', 'outsidetemp') + '°C'],
      ['Remote start', i.climate ? 'ACTIVE' + (cd && parseFloat(cd.state) > 0 ? ', ' + Math.round(parseFloat(cd.state)) + ' MIN' : '') : 'OFF']]) +
      '<div class="chips">' + (i.climate ? chip('Stop climate', 'car:stop', '#cc3333') : chip('Defrost front + rear', 'car:defrost', LC[5])) + '</div>';

    // Departure editor
    var d = this._dep();
    var dn = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    var dl = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    var auto = st('switch', 'departuretimes');
    var next = this._nextDeparture();
    var sched = (st('sensor', 'departureschedules') || { attributes: {} }).attributes.schedule;
    var schedTxt = sched && Object.keys(sched).length ? JSON.stringify(sched).replace(/["{}\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) : 'NONE SET';
    var g = function (ui, label, bg) { return '<button class="b" data-ui="' + ui + '" style="background:' + bg + '">' + label + '</button>'; };
    var depart = '<div class="dep"><span class="dep">' + g('car:h:-1', 'H&minus;', LC[1]) + g('car:h:1', 'H+', LC[1]) + '</span>' +
      '<span class="big" style="flex:1;text-align:center">' + pad2(d.h) + ':' + pad2(d.m) + '</span>' +
      '<span class="dep">' + g('car:m:-5', 'M&minus;', LC[2]) + g('car:m:5', 'M+', LC[2]) + '</span></div>' +
      '<div class="chips">' + dn.map(function (n, k) { return chip(dl[k], 'car:day:' + n, LC[3], d.days.indexOf(n) < 0); }).join('') + '</div>' +
      '<div class="chips">' + [['off', 'No heat'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']].map(function (p) {
        return chip(p[1], 'car:pre:' + p[0], LC[4], d.pre !== p[0]);
      }).join('') + '</div>' +
      '<div class="chips">' + chip('Set', 'car:set', LC[0]) + chip('Clear days', 'car:clear', '#cc6666') +
      (auto ? chip('Schedule ' + (auto.state === 'on' ? 'on' : 'off'), 'car:auto:' + (auto.state === 'on' ? 'off' : 'on'), LC[5], auto.state !== 'on') : '') + '</div>' +
      kv([['Next', next ? ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][next.getDay()] + ' ' + this._hhmm(next) : 'NONE'], ['Saved', schedTxt]]);

    // Status
    var lock = st('lock', 'doorlock');
    var tp = st('sensor', 'tirepressure'), ta = tp ? tp.attributes : {};
    var tyre = function (k) { return String(ta[k] || '--').replace(' psi', ''); };
    var tyreBad = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'].some(function (k) { return ta[k + '_state'] && ta[k + '_state'] !== 'NORMAL'; });
    var b12 = st('sensor', 'battery');
    var loc = st('device_tracker', 'tracker');
    var upd = st('sensor', 'lastrefresh');
    var status = kv([
      ['Locks', lock ? lock.state.toUpperCase() : '--', lock && lock.state !== 'locked'],
      ['Doors / windows', val('sensor', 'doorstatus').toUpperCase() + ' / ' + val('sensor', 'windowposition').toUpperCase()],
      ['Tyres psi', tyre('frontLeft') + ' ' + tyre('frontRight') + ' / ' + tyre('rearLeft') + ' ' + tyre('rearRight'), tyreBad],
      ['12V battery', b12 ? b12.state + '%' + (b12.attributes.batteryVoltage ? ', ' + b12.attributes.batteryVoltage + ' V' : '') : '--'],
      ['Odometer', val('sensor', 'odometer') + ' KM'],
      ['Location', loc ? loc.state.toUpperCase().replace(/_/g, ' ') : '--'],
      ['Updated', upd && upd.state ? this._hhmm(new Date(upd.state)) : '--']]) +
      (lock && lock.state !== 'locked' ? '<div class="chips">' + chip('Lock car', 'car:lock', LC[6]) + '</div>' : '');

    // Home charging cost since the last pay day.
    var cc = this._carCost(), costHtml = '';
    if (cc) {
      var mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      var dd = function (dt) { return dt.getDate() + ' ' + mon[dt.getMonth()]; };
      costHtml = kv([['Since ' + dd(cc.from), cc.cost == null ? '--' : '£' + cc.cost.toFixed(2) + ' · ' + Math.round(cc.kwh) + ' KWH'],
          ['Average per day', cc.cost == null ? '--' : '£' + (cc.cost / cc.days).toFixed(2)],
          ['Projected to ' + dd(cc.end), cc.cost == null ? '--' : '£' + (cc.cost / cc.days * cc.total).toFixed(2)]]);
    }

    return [
      { title: 'Power', html: power, color: LC[0] },
      { title: 'Climate', html: climate, color: LC[5] },
    ].concat(cc ? [{ title: 'Charging cost', html: costHtml, color: LC[4] }] : []).concat([
      { title: 'Departure', html: depart, color: LC[3], column: 2 },
      { title: 'Status', html: status, color: LC[1], column: 2 },
    ]);
  }

  // Pay period: from the most recent config.car.pay_day (default 27th) at midnight.
  _payPeriod() {
    var pd = this._config.car.pay_day || 27, n = new Date();
    var from = new Date(n.getFullYear(), n.getMonth() - (n.getDate() >= pd ? 0 : 1), pd);
    var next = new Date(from.getFullYear(), from.getMonth() + 1, pd);
    return { from: from, next: next };
  }

  // Charger energy (hourly mean power) x that day's Octopus unit rate, or the current rate.
  _fetchCarCost() {
    var c = this._config.car, e = this._config.energy, self = this;
    if (!c || !c.charger || this._ccBusy || !this._hass || !this._hass.callWS) return;
    this._ccBusy = true;
    var p = this._payPeriod();
    var ids = [c.charger.power].concat(e ? [e.elec.kwh, e.elec.cost] : []);
    var q = function (period) {
      return self._hass.callWS({ type: 'recorder/statistics_during_period', start_time: p.from.toISOString(), statistic_ids: ids, period: period, types: ['change', 'mean'] });
    };
    Promise.all([q('hour'), q('day')])
      .then(function (r) { self._cc = { hour: r[0] || {}, day: r[1] || {}, from: p.from.getTime(), at: Date.now() }; })
      .catch(function () { self._cc = { hour: {}, day: {}, from: p.from.getTime(), at: Date.now(), err: true }; })
      .then(function () { self._ccBusy = false; if (self._config.page === 'car') self._render(); });
  }

  _carCost() {
    var c = this._config.car, e = this._config.energy;
    if (!c || !c.charger) return null;
    var p = this._payPeriod(), now = Date.now();
    var res = { from: p.from, end: new Date(p.next.getTime() - 864e5), days: Math.max(1, (now - p.from) / 864e5),
      total: Math.round((p.next - p.from) / 864e5), kwh: null, cost: null };
    if (!this._cc || this._cc.from !== p.from.getTime()) return res;
    var ms = function (x) { return typeof x.start === 'number' ? x.start : Date.parse(x.start); };
    var dk = function (t) { var d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
    var rate = {};
    if (e) {
      var k = {}; (this._cc.day[e.elec.kwh] || []).forEach(function (x) { k[dk(ms(x))] = x.change; });
      (this._cc.day[e.elec.cost] || []).forEach(function (x) { var kk = k[dk(ms(x))]; if (kk > 1 && x.change != null) rate[dk(ms(x))] = x.change / kk; });
    }
    var rs = e && this._st(e.elec.rate), cur = rs ? parseFloat(rs.state) : NaN;
    if (isNaN(cur)) cur = 0.28;
    var mult = c.charger.kw ? 1 : 0.001, max = c.charger.max_kw || 7.5, kwh = 0, cost = 0;
    (this._cc.hour[c.charger.power] || []).forEach(function (x) {
      if (x.mean == null) return;
      var v = Math.min(max, Math.max(0, x.mean * mult));
      kwh += v; cost += v * (rate[dk(ms(x))] || cur);
    });
    res.kwh = kwh; res.cost = cost;
    return res;
  }

  _carAction(act, arg) {
    var self = this, d = this._dep();
    var beep = function (n) { if (self._audioOn) tpAudio.seq(n || LCARS_SFX.tap, 'triangle', 0.2); };
    var id = function (dom, k) { return self._carId(dom, k); };
    switch (act) {
      case 'open':
        if (this._audioOn) tpAudio.seq(LCARS_SFX.nav, 'sine', 0.16);
        setTimeout(function () { tpNavigate((self._config.car && self._config.car.path) || '/tablet-lcars/car'); }, 180);
        return;
      case 'defrost':
        if (this._audioOn) { tpAudio.seq(LCARS_SFX.script, 'sine', 0.16); this._maybeCaptain(); }
        return this._call('script', 'turn_on', { entity_id: 'script.car_defrost' }, 'CAR DEFROST');
      case 'stop':
        beep(LCARS_SFX.off);
        return this._call('switch', 'turn_off', { entity_id: id('switch', 'ignition') }, 'CAR CLIMATE OFF');
      case 'target':
        beep();
        return this._call('select', 'select_option', { entity_id: id('select', 'elvehtargetcharge'), option: arg }, 'CHARGE LIMIT ' + arg + '%');
      case 'charge':
        beep();
        return this._call('switch', 'turn_' + arg, { entity_id: id('switch', 'elvehcharge') }, arg === 'on' ? 'CHARGING RESUME' : 'CHARGING PAUSE');
      case 'lock':
        beep(LCARS_SFX.on);
        return this._call('lock', 'lock', { entity_id: id('lock', 'doorlock') }, 'CAR LOCK');
      case 'auto':
        beep();
        return this._call('switch', 'turn_' + arg, { entity_id: id('switch', 'departuretimes') }, 'DEPARTURE SCHEDULE ' + arg.toUpperCase());
      case 'h': d.h = (d.h + Number(arg) + 24) % 24; break;
      case 'm': d.m = (d.m + Number(arg) + 60) % 60; break;
      case 'day': {
        var k = d.days.indexOf(arg);
        if (k >= 0) d.days.splice(k, 1); else d.days.push(arg);
        break;
      }
      case 'pre': d.pre = arg; break;
      case 'set':
      case 'clear': {
        if (!d.days.length) { this._note('SELECT AT LEAST ONE DAY', false); this._sfx('error'); return; }
        var order = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        var days = order.filter(function (x) { return d.days.indexOf(x) >= 0; });
        var short = days.map(function (x) { return x.slice(0, 3).toUpperCase(); }).join(' ');
        if (act === 'clear') {
          beep(LCARS_SFX.off);
          return this._call('fordpass', 'delete_departure_schedule_by_days', { schedule_days: days }, 'DEPARTURES CLEARED ' + short);
        }
        if (this._audioOn) { tpAudio.seq(LCARS_SFX.scene, 'sine', 0.16); this._clip('confirm', 1); }
        this._call('fordpass', 'update_departure_schedule',
          { hour: d.h, minute: d.m, precondition_temperature: d.pre, schedule_days: days },
          'DEPART ' + pad2(d.h) + ':' + pad2(d.m) + ' ' + short);
        var auto = this._carSt('switch', 'departuretimes');
        if (auto && auto.state !== 'on') this._call('switch', 'turn_on', { entity_id: id('switch', 'departuretimes') }, 'DEPARTURE SCHEDULE ON');
        return;
      }
      default: return;
    }
    // Editor changes are local until SET.
    this._saveDep();
    beep(act === 'h' || act === 'm' ? (Number(arg) > 0 ? LCARS_SFX.step : LCARS_SFX.stepDown) : LCARS_SFX.toggle);
    this._render();
    this._tick();
    this._renderLog();
  }
}

// =========================================================================
// Phosphor terminal
// =========================================================================
var TERM_CSS = `
:host { display:block; }
* { box-sizing:border-box; }
.tm { --p:#3dff7a; --d:rgba(61,255,122,.35); --bg:#020b05; height:100vh; background:var(--bg); color:var(--p);
  font-family:VT323, 'Share Tech Mono', 'Courier New', monospace; font-size:24px; line-height:1.12; padding:16px 20px;
  display:flex; flex-direction:column; gap:12px; position:relative; overflow:hidden; text-transform:uppercase;
  text-shadow:0 0 4px var(--d), 0 0 1px var(--p); -webkit-tap-highlight-color:transparent; user-select:none; }
.tm.amber { --p:#ffb43d; --d:rgba(255,180,61,.35); --bg:#0d0700; }
.scan { position:absolute; inset:0; pointer-events:none; z-index:5;
  background:repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0px, rgba(0,0,0,.28) 1px, transparent 1px, transparent 3px),
             radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,.55) 100%); }
button { font:inherit; color:inherit; background:transparent; border:0; padding:0; cursor:pointer; text-transform:inherit; text-shadow:inherit; text-align:left; }
.box { border:2px solid var(--p); box-shadow:0 0 6px var(--d), inset 0 0 6px var(--d); padding:10px 14px; position:relative; min-height:0; }
.box > h2 { font-size:1em; font-weight:400; margin:0; position:absolute; top:-.62em; left:14px; background:var(--bg); padding:0 8px; }
header { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid var(--p); padding-bottom:6px; flex:none; }
header .big { font-size:40px; letter-spacing:.12em; }
header .r { text-align:right; }
#clock { font-size:40px; }
.grid { flex:none; max-height:72%; display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap:20px; min-height:0; }
.col { display:flex; flex-direction:column; gap:20px; min-height:0; min-width:0; }
.ln, .cmd, .cmd span { min-width:0; }
.cmd > span:first-child, .cmd > span:last-child { flex:none; }
.ro { display:grid; grid-template-columns:1fr auto auto; gap:2px 14px; margin-top:6px; }
.ro .bar { letter-spacing:-.02em; opacity:.85; }
.ctl { display:flex; flex-direction:column; gap:4px; margin-top:6px; }
.ctl .h { opacity:.7; margin-top:6px; }
.ln { display:flex; align-items:center; gap:10px; }
.cmd { flex:1; display:flex; justify-content:space-between; padding:3px 8px; border:1px solid transparent; white-space:nowrap; overflow:hidden; }
.cmd:active, .sm:active { background:var(--p); color:var(--bg); text-shadow:none; }
.cmd.on { background:var(--p); color:var(--bg); text-shadow:none; box-shadow:0 0 8px var(--d); }
.cmd .dots { flex:1; overflow:hidden; opacity:.5; padding:0 6px; }
.sm { padding:3px 10px; border:1px solid var(--p); }
.chips { display:flex; flex-wrap:wrap; gap:8px; }
.chips .sm { flex:1; text-align:center; }
.log { flex:1; min-height:4.6em; overflow:hidden; display:flex; flex-direction:column; justify-content:flex-end; }
.log .e { opacity:.85; white-space:nowrap; overflow:hidden; }
.log .e.s { opacity:.6; }
.cur { animation:blink 1.06s steps(1) infinite; }
@keyframes blink { 50% { opacity:0; } }
footer { display:flex; gap:12px; flex:none; flex-wrap:wrap; }
footer .sm.active { background:var(--p); color:var(--bg); text-shadow:none; }
footer .sp { flex:1; }
@media (max-height: 680px) {
  .tm { font-size:18px; padding:10px 14px; gap:10px; } header .big, #clock { font-size:28px; }
  .grid, .col { gap:14px; } .box { padding:7px 10px; } .cmd, .sm { padding:2px 6px; } .ctl { gap:3px; }
}
@media (max-width: 700px) { .grid { grid-template-columns:1fr; overflow:auto; } }
`;

class TerminalPanelCard extends TabletPanelBase {
  constructor() {
    super();
    var amber = false;
    try { amber = localStorage.getItem('tp-term-amber') === '1'; } catch (e) { /* no storage */ }
    this._amber = amber;
  }

  _kind() { return 'term'; }
  _audioLabel() { return 'AUDIO: ' + (this._audioOn ? 'ON' : 'OFF'); }

  connectedCallback() {
    super.connectedCallback();
    if (!window.__tpBooted) {
      window.__tpBooted = true;
      var self = this;
      var lines = ['BOOT SEQUENCE INITIATED', 'MEMORY CHECK ......... OK', 'LINK TO HOME CORE .... ESTABLISHED',
        'SENSOR ARRAY ......... ONLINE', 'AWAITING INSTRUCTION'];
      lines.forEach(function (l, i) { setTimeout(function () { self._note(l, true); }, 300 + i * 750); });
      // Spoken only when switching here from LCARS, not on wake/reload.
      if (tpJustSwitched()) setTimeout(function () {
        tpAudio.unlock();
        self._say(self._config && self._config.boot_say || 'Interface online. Awaiting instruction.');
      }, 300 + lines.length * 750);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._typer) { clearInterval(this._typer); this._typer = null; }
  }

  _say(text) {
    if (this._audioOn && tpAudio.ready()) tpVoice.say(this._hass, text, (this._config || {}).voice);
  }

  _preloadVoice() {
    var self = this;
    var phrases = [this._config.boot_say || 'Interface online. Awaiting instruction.', 'Unable to comply.'];
    this._items.forEach(function (it) {
      if (it.type === 'light') phrases.push(it.label + ' lighting on.', it.label + ' lighting off.');
      else if (it.type === 'toggle') phrases.push(it.label + ' activated.', it.label + ' deactivated.');
      else if (it.type === 'vacuum') phrases.push('Cleaning unit returning to dock.', 'Locating cleaning unit.', 'Cleaning cycle paused.', 'Cleaning cycle initiated.');
      else phrases.push(self._phrase(it, 'main'));
    });
    var cfg = this._config.voice || {};
    // One at a time so the tablet and HA aren't flooded.
    phrases.reduce(function (p, text) {
      return p.then(function () { return tpVoice._load(self._hass, text, cfg).catch(function () {}); });
    }, Promise.resolve());
  }

  _phrase(it, op) {
    var label = it.label;
    var on = this._isOn(it);
    switch (it.type) {
      case 'light': return label + ' lighting ' + (on ? 'on.' : 'off.');
      case 'toggle': return label + (on ? ' activated.' : ' deactivated.');
      case 'scene': return it.say || label + ' lighting profile applied.';
      case 'script': return it.say || it._sec + ': ' + label + '. Confirmed.';
      case 'vacuum':
        if (op === 'dock') return 'Cleaning unit returning to dock.';
        if (op === 'locate') return 'Locating cleaning unit.';
        return on ? 'Cleaning cycle paused.' : 'Cleaning cycle initiated.';
    }
    return label + '.';
  }

  _sfx(kind, it, op) {
    if (!this._audioOn) return;
    if (kind === 'nav') { tpAudio.click(0.45, 2200); setTimeout(function () { tpAudio.click(0.45, 2800); }, 70); return; }
    if (kind === 'error') { tpAudio.seq([[110, 0, 0.35]], 'square', 0.06); this._say('Unable to comply.'); return; }
    if (kind !== 'press') return;
    tpAudio.click(0.5, 2600);
    // Lights and toggles speak once HA confirms the change (see _onChange).
    if (it.type === 'scene' || it.type === 'script' || it.type === 'vacuum') this._say(this._phrase(it, op));
  }

  _onChange(it, txt, op) {
    if (op === 'main' && (it.type === 'light' || it.type === 'toggle')) this._say(this._phrase(it, op));
  }

  _note(text, fromState) {
    var prev = this._log[this._log.length - 1];
    if (prev) prev.shown = 1e9; // finish typing the previous line at once
    super._note(text, fromState);
  }

  _type() {
    if (this._typer) return;
    var self = this;
    this._typer = setInterval(function () {
      var last = self._log[self._log.length - 1];
      var full = last ? last.t + ' ' + last.text : '';
      if (!last || last.shown >= full.length) { clearInterval(self._typer); self._typer = null; return; }
      last.shown += 1;
      var el = self.shadowRoot.getElementById('typ');
      if (el) el.textContent = full.slice(0, last.shown);
      if (self._audioOn && last.shown % 2 === 0) tpAudio.click(0.12, 1700 + Math.random() * 900);
    }, 22);
  }

  _ui(what) {
    if (what === 'audio') {
      if (this._toggleAudio()) tpAudio.click(0.5, 2600);
      return;
    }
    if (what === 'phosphor') {
      if (this._audioOn) tpAudio.click(0.5, 2600);
      this._amber = !this._amber;
      try { localStorage.setItem('tp-term-amber', this._amber ? '1' : '0'); } catch (e) { /* no storage */ }
      var root = this.shadowRoot.querySelector('.tm');
      if (root) root.classList.toggle('amber', this._amber);
      var b = this.shadowRoot.getElementById('ph');
      if (b) b.textContent = 'PHOSPHOR: ' + (this._amber ? 'AMBER' : 'GREEN');
    }
  }

  _bar(n, lo, hi, w) {
    if (n == null) return '';
    var f = Math.max(0, Math.min(w, Math.round((n - lo) / (hi - lo) * w)));
    return '[' + new Array(f + 1).join('█') + new Array(w - f + 1).join('·') + ']';
  }

  _render() {
    var c = this._config;
    var self = this;
    if (!this._preloaded) {
      this._preloaded = true;
      setTimeout(function () { self._preloadVoice(); }, 4000);
    }
    var ro = (c.readouts || []).map(function (r) {
      var v = self._readout(r);
      var lo = r.min != null ? r.min : 10, hi = r.max != null ? r.max : 25;
      return '<span>' + esc(r.label) + '</span><span>' + esc(v.text) + '</span><span class="bar">' + self._bar(v.num, lo, hi, 10) + '</span>';
    }).join('');

    var ctl = function (sec) {
      var simple = [], chips = [];
      (sec.items || []).forEach(function (it) {
        var k = it._key;
        if (it.type === 'scene' || it.type === 'script') {
          chips.push('<button class="sm" data-k="' + k + '">' + esc(it.label) + '</button>');
          return;
        }
        var on = self._isOn(it);
        var main = '<button class="cmd' + (on ? ' on' : '') + '" data-k="' + k + '"><span>&gt; ' + esc(it.label) + '</span><span class="dots">' +
          '................................................' + '</span><span>' + esc(self._stateText(it)) + '</span></button>';
        var extra = '';
        if (it.type === 'light') extra = '<button class="sm" data-k="' + k + '" data-op="down">-</button><button class="sm" data-k="' + k + '" data-op="up">+</button>';
        if (it.type === 'vacuum') extra = '<button class="sm" data-k="' + k + '" data-op="dock">DOCK</button><button class="sm" data-k="' + k + '" data-op="locate">FIND</button>';
        simple.push('<div class="ln">' + main + extra + '</div>');
      });
      return simple.join('') + (chips.length ? '<div class="chips">' + chips.join('') + '</div>' : '');
    };

    var mine = function (s) { return !s.readouts && (!s.only || s.only === 'term'); };
    var boxes = c.sections.filter(mine).map(function (sec) {
      return '<div class="box"><h2>' + esc(sec.title) + '</h2><div class="ctl">' + ctl(sec) + '</div></div>';
    });
    var left = ['<div class="box"><h2>Environment</h2><div class="ro">' + ro + '</div></div>'];
    var right = [];
    c.sections.filter(mine).forEach(function (sec, i) { (sec.term_column === 1 ? left : right).push(boxes[i]); });

    var fk = 0;
    var nav = (c.nav || []).map(function (n, i) {
      if (n.only && n.only !== 'term') return '';
      fk++;
      return '<button class="sm' + (self._navActive(n) ? ' active' : '') + '" data-nav="' + i + '">F' + fk + ' ' + esc(n.label) + '</button>';
    }).join('');

    this.shadowRoot.innerHTML = '<style>' + TERM_CSS + '</style>' +
      '<div class="tm' + (this._amber ? ' amber' : '') + '"><div class="scan"></div>' +
      '<header><div><div class="big">' + esc(c.title || 'Home Systems Interface') + '</div><div>' + esc(c.subtitle || 'Node 0114 // Link nominal') + '</div></div>' +
      '<div class="r"><div id="clock"></div><div id="date"></div></div></header>' +
      '<div class="grid"><div class="col">' + left.join('') + '</div><div class="col">' + right.join('') + '</div></div>' +
      '<div class="box log" id="log"></div>' +
      '<footer>' + nav + '<span class="sp"></span><button class="sm" id="audio" data-ui="audio">' + this._audioLabel() + '</button><button class="sm" id="ph" data-ui="phosphor">PHOSPHOR: ' + (this._amber ? 'AMBER' : 'GREEN') + '</button></footer>' +
      '</div>';
  }

  _renderLog() {
    var el = this.shadowRoot.getElementById('log');
    if (!el) return;
    var last = this._log[this._log.length - 1];
    var lines = this._log.slice(-12).map(function (e) {
      var full = e.t + ' ' + e.text;
      return '<div class="e' + (e.s ? ' s' : '') + '"' + (e === last ? ' id="typ"' : '') + '>' + esc(full.slice(0, e.shown)) + '</div>';
    });
    lines.push('<div>&gt; <span class="cur">█</span></div>');
    el.innerHTML = lines.join('');
    if (last && last.shown < last.t.length + 1 + last.text.length) this._type();
  }
}

if (!customElements.get('lcars-panel-card')) customElements.define('lcars-panel-card', LcarsPanelCard);
if (!customElements.get('terminal-panel-card')) customElements.define('terminal-panel-card', TerminalPanelCard);
window.customCards = window.customCards || [];
window.customCards.push(
  { type: 'lcars-panel-card', name: 'LCARS panel', description: 'Full-screen LCARS-style tablet console' },
  { type: 'terminal-panel-card', name: 'Terminal panel', description: 'Full-screen phosphor terminal for the tablet' }
);
console.info('tablet-panels ' + TP_VERSION + ' loaded');
