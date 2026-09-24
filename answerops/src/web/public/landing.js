/** The complete document is usable before this progressive enhancement runs. */
(() => {
  const menu = document.querySelector('.nav-toggle');
  const navigation = document.querySelector('#site-navigation');
  if (menu && navigation) {
    menu.hidden = false;
    document.querySelector('.lp-nav').classList.add('has-menu');
    const closeMenu = () => menu.setAttribute('aria-expanded', 'false');
    menu.addEventListener('click', () => {
      menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') !== 'true'));
    });
    navigation.addEventListener('click', (event) => {
      if (event.target.closest('a')) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        menu.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.lp-nav')) closeMenu();
    });
    window.matchMedia('(max-width: 900px)').addEventListener('change', closeMenu);
  }
  const source = new URLSearchParams(location.search).get('utm_source') || 'public_site';
  const eventSource = source.length <= 30 ? source : 'public_site';
  const emit = (event) => {
    if (navigator.doNotTrack === '1') return;
    fetch('/launch-event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: eventSource, event }), keepalive: true }).catch(() => {});
  };
  emit('landing_view');
  document.querySelector('[data-testid="cta-hero"]')?.addEventListener('click', () => emit('primary_cta'));
  const example = document.querySelector('[data-exhibit]');
  if (example && 'IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { emit('example_view'); seen.disconnect(); }
    }, { threshold: 0.5 });
    seen.observe(example);
  }

  const exhibit = document.querySelector('[data-exhibit]');
  if (exhibit) {
    const answer = exhibit.querySelector('[data-typed]');
    const replay = exhibit.querySelector('[data-replay]');
    const original = answer?.innerHTML ?? '';
    const stages = [...exhibit.querySelectorAll('.stage')];
    let generation = 0;
    function reveal(phase, count) {
      exhibit.dataset.phase = phase;
      stages.forEach((stage, index) => (stage.dataset.shown = String(index < count)));
    }
    function play() {
      const current = ++generation;
      answer.innerHTML = original;
      replay.disabled = true;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        reveal('done', stages.length);
        replay.disabled = false;
        return;
      }
      const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let total = 0;
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.replace(/\s+/g, ' ');
        nodes.push({ node: walker.currentNode, text, start: total });
        total += text.length;
        walker.currentNode.textContent = '';
      }
      const started = performance.now();
      reveal('typing', 0);
      function frame(now) {
        if (current !== generation) return;
        const elapsed = now - started;
        if (elapsed < 1500) {
          const characters = Math.floor((total * elapsed) / 1500);
          nodes.forEach(
            (item) => (item.node.textContent = item.text.slice(0, Math.max(0, characters - item.start))),
          );
        } else {
          answer.innerHTML = original;
          if (elapsed < 1750) reveal('typing', 0);
          else if (elapsed < 2400) reveal('flagged', 1);
          else if (elapsed < 3100) reveal('sources', 2);
          else if (elapsed < 3700) reveal('truth', 3);
          else {
            reveal('done', stages.length);
            replay.disabled = false;
            return;
          }
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
    replay?.addEventListener('click', play);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            play();
          }
        },
        { threshold: 0.35 },
      );
      observer.observe(exhibit);
    } else play();
  }
  const form = document.querySelector('[data-audit-form]');
  if (!form) return;
  const email = form.querySelector('#audit-email');
  const domain = form.querySelector('#audit-domain');
  const trap = form.querySelector('#audit-company_fax');
  const button = form.querySelector('[data-submit]');
  const status = form.querySelector('[data-outcome]');
  let pending = false;
  function validate() {
    const rules = [
      [
        email,
        /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim()),
        'Enter a work email so we can contact you about the audit.',
      ],
      [
        domain,
        /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(
          domain.value
            .trim()
            .replace(/^https?:\/\//i, '')
            .split('/')[0],
        ),
        'Enter the domain to audit, for example vanarchain.com',
      ],
    ];
    rules.forEach(([input, valid, message]) => {
      input.setAttribute('aria-invalid', String(!valid));
      form.querySelector(`[data-err-for="${input.id}"]`).textContent = valid ? '' : message;
    });
    return rules.every(([, valid]) => valid);
  }
  function failure(message) {
    status.dataset.kind = 'error';
    status.textContent = message + ' ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'retry';
    retry.textContent = 'Try again';
    retry.addEventListener('click', submit);
    status.append(retry);
  }
  async function submit(event) {
    event?.preventDefault();
    if (pending) return;
    if (!validate()) {
      form.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    if (!navigator.onLine) {
      failure('You appear to be offline, so nothing was sent.');
      return;
    }
    pending = true;
    button.dataset.state = 'loading';
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    try {
      const response = await fetch('/audit-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.value.trim(),
          domain: domain.value.trim(),
          source: eventSource,
          company_fax: trap ? trap.value : '',
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error('request failed');
      form.reset();
      status.dataset.kind = 'ok';
      if (result.duplicate) {
        status.textContent = `${result.domain} was audited in the last 7 days, so we have not started another audit. We have recorded your request.`;
        return;
      }
      status.textContent = result.queued
        ? `Received. We run a limited number of audits each day, so the audit of ${result.domain} is queued and will start automatically when a slot opens. `
        : `Running now. We are reading ${result.domain}, taking what it says about itself as the comparison, and sampling the surfaces. `;
      if (/^\/audit\/[a-f0-9]{32}$/.test(result.reportUrl)) {
        const link = document.createElement('a');
        link.href = result.reportUrl;
        link.dataset.testid = 'audit-report-url';
        link.textContent = result.reportUrl;
        if (result.queued) status.append('Keep this link to check its progress: ', link, '.');
        else status.append('Your report: ', link, '. It fills in as the sample completes.');
      } else
        status.append(
          'The request was accepted but no valid report link was returned. Keep this page open and contact the operator.',
        );
      status.append(' Nothing enters a truth registry until a person approves it.');
    } catch {
      failure('We could not confirm the result. Check your connection before retrying.');
    } finally {
      pending = false;
      delete button.dataset.state;
      button.removeAttribute('aria-busy');
      button.disabled = false;
    }
  }
  form.addEventListener('submit', submit);
  [email, domain].forEach((input) => {
    input.addEventListener('blur', () => {
      if (input.value.trim()) validate();
    });
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') validate();
    });
  });
})();
