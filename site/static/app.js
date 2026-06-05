// Progressive enhancement only — the site is fully usable without JS.
// 1) Home: "Find shops near me" -> geolocate, rank all walk-in candidates by distance.
// 2) Area pages: "Sort by distance" -> reorder the existing cards, label distances.
(function () {
  'use strict';

  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function fmtKm(km) {
    return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km';
  }

  function telHref(phone) {
    return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
  }

  var STATUS = {
    walk_in_confirmed: { label: 'Walk-in confirmed', cls: 'ok' },
    walk_in_unverified: { label: 'Likely walk-in — call ahead', cls: 'warn' },
    remittance_first: { label: 'Money transfer first — call ahead', cls: 'warn' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function locate(onOk, onErr) {
    if (!('geolocation' in navigator)) { onErr(); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      onOk(pos.coords.latitude, pos.coords.longitude);
    }, onErr, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  // ---- Home: near-me ranking ----
  var nearBtn = document.getElementById('near-me-btn');
  if (nearBtn) {
    var dataEl = document.getElementById('shops-data');
    var out = document.getElementById('near-me-results');
    nearBtn.addEventListener('click', function () {
      var orig = nearBtn.textContent;
      nearBtn.textContent = 'Locating…';
      nearBtn.disabled = true;
      locate(function (la, lo) {
        var shops;
        try { shops = JSON.parse(dataEl.textContent); } catch (e) { shops = []; }
        shops = shops.filter(function (s) { return s.lat != null; });
        shops.forEach(function (s) { s.d = haversineKm(la, lo, s.lat, s.lng); });
        shops.sort(function (a, b) { return a.d - b.d; });
        var rows = shops.slice(0, 10).map(function (s) {
          var st = STATUS[s.status] || { label: s.status, cls: 'warn' };
          return '<div class="shop-card near-row">' +
            '<h3><a href="/shop/' + esc(s.slug) + '/">' + esc(s.name) + '</a>' +
            ' <span class="distance">' + fmtKm(s.d) + '</span></h3>' +
            '<p class="badges"><span class="badge ' + st.cls + '">' + st.label + '</span></p>' +
            '<p class="meta">' +
            (s.phone ? '<span class="k">tel</span> <a href="' + telHref(s.phone) + '">' + esc(s.phone) + '</a>' : '<span class="k">tel</span> not listed — see shop page') +
            '</p></div>';
        }).join('');
        out.innerHTML = '<h2>Nearest walk-in candidates</h2>' + rows +
          '<p class="count">Distances are straight-line. Statuses are honest: call before you go.</p>';
        out.hidden = false;
        nearBtn.textContent = orig;
        nearBtn.disabled = false;
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, function () {
        nearBtn.textContent = 'Location unavailable — pick your area below';
        nearBtn.disabled = false;
        setTimeout(function () { nearBtn.textContent = orig; nearBtn.disabled = false; }, 4000);
      });
    });
  }

  // ---- Area pages: sort existing cards by distance ----
  var sortBtn = document.getElementById('sort-distance-btn');
  if (sortBtn) {
    sortBtn.addEventListener('click', function () {
      var orig = sortBtn.textContent;
      sortBtn.textContent = 'Locating…';
      sortBtn.disabled = true;
      locate(function (la, lo) {
        var list = document.getElementById('shop-list');
        var cards = Array.prototype.slice.call(list.querySelectorAll('.shop-card[data-lat]'));
        cards.forEach(function (c) {
          var km = haversineKm(la, lo, parseFloat(c.dataset.lat), parseFloat(c.dataset.lng));
          c._km = km;
          var h3 = c.querySelector('h3');
          var d = c.querySelector('.distance');
          if (!d) { d = document.createElement('span'); d.className = 'distance'; h3.appendChild(d); }
          d.textContent = fmtKm(km);
        });
        cards.sort(function (a, b) { return a._km - b._km; });
        cards.forEach(function (c) { list.appendChild(c); });
        sortBtn.textContent = 'Sorted by distance';
      }, function () {
        sortBtn.textContent = 'Location unavailable';
        setTimeout(function () { sortBtn.textContent = orig; sortBtn.disabled = false; }, 4000);
      });
    });
  }
})();
