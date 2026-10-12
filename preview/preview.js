// preview.js: mounts the scroll engine and reports which acts a visitor reaches (diagnostic; not a keep/revert input).
// story_act uses our own observer: the engine's sc:waypoint fires only in its worldflight mode.
(function () {
  // The engine mounts on the reader's first interaction, so the first screen never downloads a clip (first-screen
  // budgets). Until then the page stays in its no-JS state: posters, and every line of copy visible. sc-js is added
  // only when the engine really mounts, so a failed engine load also leaves the copy visible.
  var EVENTS = ['scroll', 'wheel', 'touchstart', 'keydown', 'pointerdown'];
  var started = false;
  function start() {
    if (started) return;
    started = true;
    EVENTS.forEach(function (t) { window.removeEventListener(t, start, { passive: true }); });
    if (!window.ScrollCraft || typeof window.ScrollCraft.mount !== 'function') return;
    document.documentElement.classList.add('sc-js');
    window.ScrollCraft.mount(document.body);
  }
  EVENTS.forEach(function (t) { window.addEventListener(t, start, { passive: true }); });

  if (typeof window.IntersectionObserver !== 'function') return;
  var seen = {};
  var io = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var act = e.target.getAttribute('data-act');
      if (!act || seen[act]) return;
      seen[act] = true;
      if (typeof window.gtag === 'function') window.gtag('event', 'story_act', { act: act });
    });
  }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
  Array.prototype.forEach.call(document.querySelectorAll('section[data-act]'), function (el) { io.observe(el); });
})();
