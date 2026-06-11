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
    remittance_first: { label: 'Money transfer first — call ahead', cls: 'warn' },
    invalid: { label: 'Invalid listing', cls: 'na' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Locate with two tiers: precise browser geolocation first; if denied,
  // unavailable, or slow (common on desktops), fall back to the Worker's
  // /api/whereami (Cloudflare edge IP location, city-level). onOk(lat, lng,
  // approx) — approx=true means network location, label it in the UI.
  function locate(onOk, onErr) {
    var settled = false;
    function ok(la, lo, approx) { if (!settled) { settled = true; onOk(la, lo, !!approx); } }
    function ipFallback() {
      fetch('/api/whereami').then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.lat != null) ok(d.lat, d.lng, true); else if (!settled) { settled = true; onErr(); }
      }).catch(function () { if (!settled) { settled = true; onErr(); } });
    }
    if (!('geolocation' in navigator)) { ipFallback(); return; }
    var fallbackTimer = setTimeout(ipFallback, 8500);
    navigator.geolocation.getCurrentPosition(function (pos) {
      clearTimeout(fallbackTimer);
      ok(pos.coords.latitude, pos.coords.longitude, false);
    }, function () {
      clearTimeout(fallbackTimer);
      ipFallback();
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
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
      locate(function (la, lo, approx) {
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
        out.innerHTML = '<h2>Nearest walk-in candidates' + (approx ? ' <span class="approx">~ approximate (network) location</span>' : '') + '</h2>' + rows +
          '<p class="count">Distances are straight-line' + (approx ? ', from your network location (city-level accuracy)' : '') + '. Statuses are honest: call before you go.</p>';
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

  // ---- Home: Google Map of all walk-in candidates ----
  // Lazy-loads the Maps JS API only when the map scrolls near the viewport
  // (protects quota). Default view: whole GTA with every pin. User location:
  // silent Cloudflare network fix first (no permission popup), precise GPS
  // only via the on-map button.
  var mapEl = document.getElementById('map');
  if (mapEl) {
    // Google calls this global on auth/billing failures — degrade gracefully
    // instead of showing a broken grey box.
    window.gm_authFailure = function () {
      mapEl.innerHTML = '<p class="map-loading">Map temporarily unavailable — use "Find shops near me" above or pick your area.</p>';
      var lg = document.querySelector('.map-legend');
      if (lg) lg.hidden = true;
    };
    var mapBooted = false;
    var bootMap = function () {
      if (mapBooted) return;
      mapBooted = true;
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(mapEl.dataset.key) + '&loading=async&callback=__initShopMap';
      s.async = true;
      document.head.appendChild(s);
    };

    window.__initShopMap = function () {
      var dataEl = document.getElementById('shops-data');
      var shops = [];
      try { shops = JSON.parse(dataEl.textContent).filter(function (s) { return s.lat != null; }); } catch (e) {}
      mapEl.innerHTML = '';
      var map = new google.maps.Map(mapEl, {
        center: { lat: 43.72, lng: -79.4 },
        zoom: 10,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'cooperative',
      });
      var bounds = new google.maps.LatLngBounds();
      var info = new google.maps.InfoWindow();

      shops.forEach(function (s) {
        var st = STATUS[s.status] || { label: s.status };
        var confirmed = s.status === 'walk_in_confirmed';
        var m = new google.maps.Marker({
          position: { lat: s.lat, lng: s.lng },
          map: map,
          title: s.name,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: confirmed ? '#14523f' : '#b98a2f',
            fillOpacity: 0.92,
            strokeColor: '#fbf9f1',
            strokeWeight: 1.5,
          },
        });
        m.addListener('click', function () {
          info.setContent('<div class="gm-card"><strong><a href="/shop/' + esc(s.slug) + '/">' + esc(s.name) + '</a></strong><br>' +
            esc(st.label) +
            (s.phone ? '<br><a href="' + telHref(s.phone) + '">' + esc(s.phone) + '</a>' : '') + '</div>');
          info.open({ map: map, anchor: m });
        });
        bounds.extend(m.getPosition());
      });
      if (!bounds.isEmpty()) map.fitBounds(bounds); // GTA-wide fallback view

      var userMarker = null;
      function placeUser(la, lo, approx) {
        var pos = { lat: la, lng: lo };
        if (!userMarker) {
          userMarker = new google.maps.Marker({
            position: pos, map: map, zIndex: 999,
            title: approx ? 'Your approximate (network) location' : 'Your location',
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#2c4a7c', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2.5 },
          });
        } else {
          userMarker.setPosition(pos);
        }
        map.setCenter(pos);
        map.setZoom(approx ? 12 : 13);
      }

      // Silent approximate fix — only if it lands inside the GTA.
      fetch('/api/whereami').then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.lat != null && d.lat > 43.2 && d.lat < 44.3 && d.lng > -80.3 && d.lng < -78.5) {
          placeUser(d.lat, d.lng, true);
        }
      }).catch(function () {});

      // Precise location only on explicit request.
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-locate-btn';
      btn.textContent = '◉ Precise location';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Locating…';
        locate(function (la, lo, approx) {
          placeUser(la, lo, approx);
          btn.textContent = approx ? '◉ Approximate location' : '◉ Location on';
          btn.disabled = false;
        }, function () {
          btn.textContent = 'Location unavailable';
          btn.disabled = false;
        });
      });
      map.controls[google.maps.ControlPosition.TOP_RIGHT].push(btn);
    };

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { bootMap(); io.disconnect(); } });
      }, { rootMargin: '400px' });
      io.observe(mapEl);
    } else {
      bootMap();
    }
  }

  // ---- Area pages: sort existing cards by distance ----
  var sortBtn = document.getElementById('sort-distance-btn');
  if (sortBtn) {
    sortBtn.addEventListener('click', function () {
      var orig = sortBtn.textContent;
      sortBtn.textContent = 'Locating…';
      sortBtn.disabled = true;
      locate(function (la, lo, approx) {
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
        sortBtn.textContent = approx ? 'Sorted by distance (approx.)' : 'Sorted by distance';
      }, function () {
        sortBtn.textContent = 'Location unavailable';
        setTimeout(function () { sortBtn.textContent = orig; sortBtn.disabled = false; }, 4000);
      });
    });
  }
})();
