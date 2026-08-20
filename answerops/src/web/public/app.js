// Progressive enhancement only. The application works with JavaScript disabled;
// this file exists to make illegal states visibly illegal before you submit them.
document.addEventListener('DOMContentLoaded', () => {
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
});
