document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('.btn, .nav-cta');

  buttons.forEach(btn => {
    // We don't need 'initialized' class logic anymore since we spawn elements on demand

    btn.addEventListener('mouseenter', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;

      let angle = Math.atan2(y, x) * (180 / Math.PI);
      angle = angle + 90;

      // Create trail element
      const trail = document.createElement('div');
      trail.className = 'hover-trail';
      trail.style.setProperty('--angle', `${angle}deg`);

      // Remove any existing active trails (trigger their exit) immediately?
      // Or let them coexist?
      // If we hover OFF then Hover ON quickly, the OLD trail is 'exiting'.
      // If we hover ON, we add a NEW trail.
      // So overlapping is fine.

      // However, if we hover within the button (move cursor), we shouldn't spam trails?
      // mouseenter only fires once when entering.

      btn.appendChild(trail);
    });

    btn.addEventListener('mouseleave', () => {
      // Find all trails that are not yet exiting
      const trails = btn.querySelectorAll('.hover-trail:not(.exiting)');
      trails.forEach(trail => {
        trail.classList.add('exiting');

        // Remove after animation completes
        trail.addEventListener('animationend', () => {
          trail.remove();
        });
      });
    });
  });

  // Feature Cards Magnetic Effect
  const cards = document.querySelectorAll('.feature-card');

  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const deltaX = x - centerX;
      const deltaY = y - centerY;

      // "Center biased towards this place a bit" -> slightly move towards mouse
      // "Enlarge a little bit" -> scale(1.02)
      const moveX = deltaX / 15; // Subtle movement
      const moveY = deltaY / 15;

      card.style.transform = `translate(${moveX}px, ${moveY}px) scale(1.02)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'translate(0, 0) scale(1)';
    });
  });
});
