// Progressive enhancement only. The application works with JavaScript disabled;
// this file exists to make illegal states visibly illegal before you submit them.
function wireTransitionGuards() {
  document.querySelectorAll('select[data-testid="transition-select"]').forEach((sel) => {
    const form = sel.closest('form');
    const button = form ? form.querySelector('button[type=submit]') : null;
    const sync = () => {
      const opt = sel.options[sel.selectedIndex];
      const illegal = opt && opt.dataset.illegal === '1';
      if (button) {
        button.disabled = Boolean(illegal);
        button.textContent = illegal ? 'Illegal transition' : 'Advance';
      }
    };
    sel.addEventListener('change', sync);
    sync();
  });
}

// A deferred script is supposed to run before DOMContentLoaded, and usually does. When it does
// not - a warm cache, a slow parse - listening for an event that has already fired leaves the
// guard unwired and an illegal transition looking legal. Check the state instead of trusting
// the ordering.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireTransitionGuards);
} else {
  wireTransitionGuards();
}
