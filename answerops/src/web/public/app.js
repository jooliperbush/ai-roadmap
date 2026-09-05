/** Form guards are advisory; the server remains the authority for transitions. */
(() => {
  function update(select) {
    const submit = select.form?.querySelector('button[type="submit"]');
    if (!submit) return;
    const forbidden = select.selectedOptions[0]?.dataset.illegal === "1";
    submit.disabled = forbidden;
    submit.textContent = forbidden ? "Illegal transition" : "Advance";
  }
  const initialize = () => {
    document
      .querySelectorAll('[data-testid="transition-select"]')
      .forEach(update);
    document.addEventListener("change", (event) => {
      if (event.target.matches('[data-testid="transition-select"]'))
        update(event.target);
    });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
