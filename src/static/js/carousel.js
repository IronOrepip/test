// Product row: CSS scroll-snap does the work. This adds the buttons, arrow keys and progress bar.
// No autoplay. Smooth scrolling is switched off in CSS when reduced motion is requested.
for (const root of document.querySelectorAll('[data-carousel]')) {
  const track = root.querySelector('[data-carousel-track]');
  const bar = root.querySelector('[data-carousel-progress]');
  const prev = root.querySelector('[data-carousel-prev]');
  const next = root.querySelector('[data-carousel-next]');
  const step = () => Math.max(track.clientWidth * 0.8, 200);
  const update = () => {
    const max = track.scrollWidth - track.clientWidth;
    bar.style.width = `${Math.min(100, ((track.scrollLeft + track.clientWidth) / track.scrollWidth) * 100)}%`;
    prev.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft >= max - 1;
  };
  prev.addEventListener('click', () => track.scrollBy({ left: -step() }));
  next.addEventListener('click', () => track.scrollBy({ left: step() }));
  track.addEventListener('keydown', (e) => {
    if (e.target !== track) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); track.scrollBy({ left: step() }); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); track.scrollBy({ left: -step() }); }
  });
  track.addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}
