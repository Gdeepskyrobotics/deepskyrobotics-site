// preview.js: mounts the scroll engine and reports which acts a visitor reaches (diagnostic; not a keep/revert input).
// story_act uses our own observer: the engine's sc:waypoint fires only in its worldflight mode.
(function () {
  if (window.ScrollCraft && typeof window.ScrollCraft.mount === 'function') window.ScrollCraft.mount(document.body);
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
