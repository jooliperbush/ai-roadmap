/* Miscited public page.
   Two behaviours only: the exhibit sequencer, and the audit-request form.
   Both degrade to a complete, readable final state when JavaScript or motion is unavailable. */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------- the exhibit
  // Phases: idle -> typing -> flagged -> sources -> truth -> done.
  // The stages are already in the markup; this only reveals them in order, so a
  // reader with no JavaScript sees the whole worked example at once.
  var exhibit = document.querySelector('[data-exhibit]');

  if (exhibit) {
    var answerEl = exhibit.querySelector('[data-typed]');
    var cursorEl = exhibit.querySelector('.cursor');
    var replayBtn = exhibit.querySelector('[data-replay]');
    var stages = Array.prototype.slice.call(exhibit.querySelectorAll('.stage'));
    var full = answerEl ? answerEl.innerHTML : '';
    var timers = [];
    var running = false;

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    }

    function at(ms, fn) {
      timers.push(setTimeout(fn, ms));
    }

    function showStages(on) {
      stages.forEach(function (s) {
        s.setAttribute('data-shown', on ? 'true' : 'false');
      });
    }

    function settle() {
      running = false;
      exhibit.setAttribute('data-phase', 'done');
      if (answerEl) answerEl.innerHTML = full;
      showStages(true);
      if (replayBtn) replayBtn.disabled = false;
    }

    // Reveals the answer without destroying its markup: the flagged claim is a real element,
    // so the text nodes are emptied and refilled against a wall-clock progress value. One rAF
    // loop rather than a chain of timers, so a throttled background tab catches up on return
    // instead of stalling halfway through a sentence.
    var TYPE_MS = 1500;
    var frame = null;

    function type(done) {
      if (!answerEl) return done();
      answerEl.innerHTML = full;

      var walker = document.createTreeWalker(answerEl, NodeFilter.SHOW_TEXT, null);
      var nodes = [];
      var node;
      var total = 0;
      while ((node = walker.nextNode())) {
        // Source indentation would otherwise burn a third of the reveal on invisible
        // whitespace; HTML collapses it anyway, so collapse it before counting.
        var text = node.nodeValue.replace(/\s+/g, ' ');
        nodes.push({ node: node, text: text, from: total });
        total += text.length;
      }
      if (!total) return done();

      var started = null;

      function paint(now) {
        if (started === null) started = now;
        var progress = Math.min(1, (now - started) / TYPE_MS);
        var revealed = Math.round(progress * total);
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var want = Math.max(0, Math.min(n.text.length, revealed - n.from));
          if (n.node.nodeValue.length !== want) n.node.nodeValue = n.text.slice(0, want);
        }
        if (progress < 1) {
          frame = requestAnimationFrame(paint);
        } else {
          frame = null;
          done();
        }
      }
      frame = requestAnimationFrame(paint);
    }

    function run() {
      if (running) return;
      running = true;
      clearTimers();
      if (replayBtn) replayBtn.disabled = true;

      if (reduced) {
        settle();
        return;
      }

      showStages(false);
      exhibit.setAttribute('data-phase', 'typing');

      type(function () {
        at(220, function () {
          exhibit.setAttribute('data-phase', 'flagged');
          if (stages[0]) stages[0].setAttribute('data-shown', 'true');
        });
        at(900, function () {
          exhibit.setAttribute('data-phase', 'sources');
          if (stages[1]) stages[1].setAttribute('data-shown', 'true');
        });
        at(1600, function () {
          exhibit.setAttribute('data-phase', 'truth');
          if (stages[2]) stages[2].setAttribute('data-shown', 'true');
        });
        at(2200, settle);
      });
    }

    if (replayBtn) replayBtn.addEventListener('click', run);

    // Start once, when the exhibit is actually on screen.
    if ('IntersectionObserver' in window && !reduced) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              io.disconnect();
              run();
            }
          });
        },
        { threshold: 0.35 },
      );
      io.observe(exhibit);
    } else {
      settle();
    }
  }

  // -------------------------------------------------------- the audit request
  var form = document.querySelector('[data-audit-form]');

  if (form) {
    var emailEl = form.querySelector('#audit-email');
    var domainEl = form.querySelector('#audit-domain');
    var submitEl = form.querySelector('[data-submit]');
    var outcomeEl = form.querySelector('[data-outcome]');

    function setError(input, message) {
      var slot = form.querySelector('[data-err-for="' + input.id + '"]');
      if (slot) slot.textContent = message || '';
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      return !message;
    }

    function validEmail(v) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
    }

    function validDomain(v) {
      return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
    }

    function validate() {
      var a = setError(emailEl, validEmail(emailEl.value) ? '' : 'Enter a work email we can send the audit to.');
      var b = setError(domainEl, validDomain(domainEl.value) ? '' : 'Enter the domain to audit, for example vanarchain.com');
      return a && b;
    }

    [emailEl, domainEl].forEach(function (el) {
      el.addEventListener('blur', function () {
        if (el.value.trim()) validate();
      });
      el.addEventListener('input', function () {
        if (el.getAttribute('aria-invalid') === 'true') validate();
      });
    });

    function outcome(kind, html) {
      outcomeEl.setAttribute('data-kind', kind);
      outcomeEl.innerHTML = html;
      var retry = outcomeEl.querySelector('.retry');
      if (retry) retry.addEventListener('click', submit);
    }

    function submit(ev) {
      if (ev) ev.preventDefault();
      outcomeEl.removeAttribute('data-kind');
      if (!validate()) {
        var firstBad = form.querySelector('[aria-invalid="true"]');
        if (firstBad) firstBad.focus();
        return;
      }

      if (!navigator.onLine) {
        outcome(
          'error',
          'You appear to be offline, so nothing was sent. <button type="button" class="retry">Try again</button>',
        );
        return;
      }

      submitEl.setAttribute('data-state', 'loading');
      submitEl.setAttribute('aria-busy', 'true');

      fetch('/audit-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailEl.value.trim(), domain: domainEl.value.trim() }),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            return { ok: res.ok, body: body };
          });
        })
        .then(function (r) {
          if (!r.ok) throw new Error(r.body && r.body.error ? r.body.error : 'request failed');
          form.reset();
          outcome(
            'ok',
            '<b>Request logged.</b> We seed a truth registry for ' +
              '<span class="mono">' +
              String(r.body.domain).replace(/[<>&]/g, '') +
              '</span>' +
              ', sample the four surfaces, and send back every defect we can evidence. No sampling starts until you approve the facts.',
          );
        })
        .catch(function () {
          outcome(
            'error',
            'That did not reach us, so treat it as unsent. <button type="button" class="retry">Try again</button>',
          );
        })
        .finally(function () {
          submitEl.removeAttribute('data-state');
          submitEl.removeAttribute('aria-busy');
        });
    }

    form.addEventListener('submit', submit);
  }
})();
