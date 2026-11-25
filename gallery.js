// Post photo gallery: one large photo, previous/next, and a grid of thumbnails.
// Clicking a photo in the post body opens it in the gallery.
(function () {
  var gallery = document.querySelector(".gallery");
  if (!gallery) return;

  var thumbs = Array.prototype.slice.call(gallery.querySelectorAll(".gallery-thumb"));
  var link = gallery.querySelector(".gallery-full");
  var main = link.querySelector("img");
  var pos = gallery.querySelector(".gallery-pos");
  var title = main.alt.replace(/: photo .*$/, "");
  var index = 0;

  function show(i) {
    index = (i + thumbs.length) % thumbs.length;
    var src = thumbs[index].getAttribute("data-full");
    main.src = src;
    main.alt = title + ": photo " + (index + 1) + " of " + thumbs.length;
    link.href = src;
    pos.textContent = index + 1;
    thumbs.forEach(function (t, n) {
      if (n === index) t.setAttribute("aria-current", "true");
      else t.removeAttribute("aria-current");
    });
    thumbs[index].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  thumbs.forEach(function (t, n) {
    t.addEventListener("click", function () { show(n); });
  });
  gallery.querySelector(".gallery-prev").addEventListener("click", function () { show(index - 1); });
  gallery.querySelector(".gallery-next").addEventListener("click", function () { show(index + 1); });

  document.addEventListener("keydown", function (e) {
    if (e.target.closest && e.target.closest("input, textarea")) return;
    var r = gallery.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    if (e.key === "ArrowLeft") show(index - 1);
    if (e.key === "ArrowRight") show(index + 1);
  });

  // Swipe on the large photo.
  var startX = null;
  main.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; }, { passive: true });
  main.addEventListener("touchend", function (e) {
    if (startX === null) return;
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(dx < 0 ? index + 1 : index - 1);
    startX = null;
  });

  // Photos in the post body jump to the same photo in the gallery.
  document.querySelectorAll(".post > img").forEach(function (img) {
    var file = img.getAttribute("src");
    var n = thumbs.findIndex(function (t) { return t.getAttribute("data-full") === file; });
    if (n < 0) return;
    img.classList.add("in-gallery");
    img.addEventListener("click", function () {
      show(n);
      gallery.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();
