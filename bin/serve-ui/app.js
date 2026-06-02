// MMD serve UI — v0.3.a-2 Dream Catcher multi-step flow.
// Vanilla JS, no framework, no inline script (CSP `script-src 'self'`).
//
// Flow: dream textarea → 3 profile buttons (Enfant / Curieux / Pro) → LEVEL
// chooser (Autonome / Équilibré / Guidé) → [one question at a time] × (0|1|2) →
// scope card (Recommencer / ✏️ Modifier / C'est parti !) → existing SSE progress
// view. /answer is state-driven: each POST returns {next} ∈ level|question|scope
// and the UI renders whatever `next` says. Autonome skips the question step.
// The SSE/progress/result engine below is unchanged from v0.2.5.

(function () {
  'use strict';

  // Step elements
  var form = document.getElementById('dream-form');
  var input = document.getElementById('dream-input');
  var submitBtn = document.getElementById('submit-btn');
  var monitorToggle = document.getElementById('monitor-toggle'); // v0.5.c opt-in
  var contextGauge = document.getElementById('context-gauge');   // v0.5.c gauge
  var stepProfile = document.getElementById('step-profile');
  var profileButtons = document.querySelectorAll('.profile-btn');
  var stepLevel = document.getElementById('step-level');
  var levelButtons = document.querySelectorAll('.level-btn');
  var stepQuestion = document.getElementById('step-question');
  var questionText = document.getElementById('question-text');
  var questionForm = document.getElementById('question-form');
  var questionInput = document.getElementById('question-input');
  var stepSynth = document.getElementById('step-synth');
  var stepScope = document.getElementById('step-scope');
  var scopeNote = document.getElementById('scope-note');
  var scopeText = document.getElementById('scope-text');
  var scopeRestart = document.getElementById('scope-restart');
  var scopeGo = document.getElementById('scope-go');
  var scopeEdit = document.getElementById('scope-edit');
  var scopeEditText = document.getElementById('scope-edit-text');
  var scopeEditToggle = document.getElementById('scope-edit-toggle');
  var scopeEditSave = document.getElementById('scope-edit-save');
  var scopeEditCancel = document.getElementById('scope-edit-cancel');

  // Progress + result elements (existing)
  var progressSection = document.getElementById('progress');
  var progressBar = document.getElementById('progress-bar');
  var phaseLine = document.getElementById('phase-line');
  var heartbeat = document.getElementById('heartbeat');
  var logOutput = document.getElementById('log-output');
  var resultSection = document.getElementById('result');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');
  var resultDebug = document.getElementById('result-debug');
  var openAppLink = document.getElementById('open-app');
  var newDreamBtn = document.getElementById('new-dream');
  var retryBtn = document.getElementById('retry');

  // Dream Catcher session state (client side).
  var sessionId = null;
  // v0.5.c — the "Monitor context" choice is made on the dream form but only
  // takes effect at launch (confirm), so capture it at submit and carry it.
  var monitorChosen = false;
  // v0.5.c — context-gauge poll handle (best-effort; null when not polling).
  var gaugePollTimer = null;

  // SSE / progress state
  var logBuffer = [];
  var lastPercent = 0;
  var lastEventAt = 0;
  var userScrolledLog = false;
  var es = null;
  var heartbeatTimer = null;

  logOutput.addEventListener('scroll', function () {
    var atBottom = logOutput.scrollHeight - logOutput.scrollTop - logOutput.clientHeight < 8;
    userScrolledLog = !atBottom;
  });

  // Ctrl+Enter / Cmd+Enter submits the dream.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!submitBtn.disabled) form.requestSubmit();
    }
  });

  // Esc closes the SSE connection client-side; subprocess continues.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && es) {
      es.close();
      es = null;
      appendLog('[client] connexion fermée / connection closed', 'stderr');
    }
  });

  /* ─────────────── Step 1: dream → start session ─────────────── */

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var dream = input.value.trim();
    if (dream.length === 0) return;
    // Capture the opt-in monitor choice now; it is threaded at confirm (launch).
    monitorChosen = !!(monitorToggle && monitorToggle.checked);
    startCatch(dream);
  });

  function startCatch(dream) {
    input.disabled = true;
    submitBtn.disabled = true;
    fetch('/api/catch/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dream: dream }),
    })
      .then(readJson)
      .then(function (r) {
        if (!r.ok) { showSubmissionError(r); return; }
        sessionId = r.body.sessionId;
        showStep('profile');
      })
      .catch(function (err) {
        showFailure('Quelque chose n\'a pas marché. / Something didn\'t work.', err.message || 'network error');
      });
  }

  /* ─────────────── Step 2: profile → level ─────────────── */

  // F4 — disable a button group during an in-flight POST so a fast double-click
  // can't fire two /api/catch/answer requests (the second would hit the server's
  // 409 synthesize_in_progress guard and surface a spurious error). Re-enabled
  // when the next step renders, or on error/reset via reenableCatchButtons().
  function setButtonsDisabled(buttons, disabled) {
    buttons.forEach(function (b) { b.disabled = disabled; });
  }
  function reenableCatchButtons() {
    setButtonsDisabled(profileButtons, false);
    setButtonsDisabled(levelButtons, false);
    questionInput.disabled = false;
    if (questionForm.querySelector('button')) questionForm.querySelector('button').disabled = false;
  }

  profileButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!sessionId || btn.disabled) return;
      // Profile answer is a fast transition (no synthesize) → expect {next:'level'}.
      setButtonsDisabled(profileButtons, true);
      postAnswer(btn.getAttribute('data-profile'), null);
    });
  });

  /* ─────────────── Step 2b: level → question | scope ─────────────── */

  levelButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!sessionId || btn.disabled) return;
      // Level may synthesize (Autonome) or ask a question (guided) → show synth.
      setButtonsDisabled(levelButtons, true);
      postAnswer(btn.getAttribute('data-level'), 'synth');
    });
  });

  /* ─────────────── Step 2c: clarifying answer → question | scope ─────────────── */

  questionForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!sessionId) return;
    var answer = questionInput.value.trim();
    if (answer.length === 0) return;
    questionInput.value = '';
    // F4 — disable the clarifying-answer input/button during the in-flight POST.
    questionInput.disabled = true;
    var qSubmit = questionForm.querySelector('button');
    if (qSubmit) qSubmit.disabled = true;
    postAnswer(answer, 'synth');
  });

  // Shared state-driven answer POST. `busyStep` is the step to show while the
  // request is in flight (null = no transition; profile keeps the level hidden
  // until the response arrives). The response {next} drives the next render.
  function postAnswer(answer, busyStep) {
    if (busyStep) showStep(busyStep);
    fetch('/api/catch/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, answer: answer }),
    })
      .then(readJson)
      .then(function (r) {
        if (!r.ok) { reenableCatchButtons(); showSubmissionError(r); return; }
        renderNext(r.body);
      })
      .catch(function (err) {
        reenableCatchButtons();
        showFailure('Quelque chose n\'a pas marché. / Something didn\'t work.', err.message || 'network error');
      });
  }

  // Branch on the server's {next}: level | question | scope. Each branch lands on
  // a fresh step, so re-enable the answer buttons (F4) for the next interaction.
  function renderNext(body) {
    reenableCatchButtons();
    if (body.next === 'level') {
      showStep('level');
    } else if (body.next === 'question') {
      questionText.textContent = body.question || '';
      showStep('question');
      questionInput.focus();
    } else { // 'scope'
      renderScope(body);
    }
  }

  /* ─────────────── Step 3: scope card → confirm ─────────────── */

  function renderScope(body) {
    scopeText.textContent = body.scope || '';
    if (body.fallback) {
      scopeNote.hidden = false;
      scopeNote.textContent =
        'On n\'a pas pu affiner — on lance ton rêve tel quel. / Couldn\'t refine — launching your dream as-is.';
    } else {
      scopeNote.hidden = true;
      scopeNote.textContent = '';
    }
    closeScopeEditor();
    showStep('scope');
  }

  /* ─────────────── Step 3b: edit the scope ─────────────── */

  scopeEditToggle.addEventListener('click', function () {
    // Reveal the textarea prefilled with the current scope.
    scopeEditText.value = scopeText.textContent;
    scopeEdit.hidden = false;
    scopeEditToggle.hidden = true;
    scopeEditText.focus();
  });

  scopeEditCancel.addEventListener('click', closeScopeEditor);

  scopeEditSave.addEventListener('click', function () {
    if (!sessionId) return;
    var edited = scopeEditText.value.trim();
    if (edited.length === 0) return;
    scopeEditSave.disabled = true;
    fetch('/api/catch/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, scope: edited }),
    })
      .then(readJson)
      .then(function (r) {
        scopeEditSave.disabled = false;
        if (!r.ok) { showSubmissionError(r); return; }
        renderScope(r.body); // re-render the card with the saved scope
      })
      .catch(function (err) {
        scopeEditSave.disabled = false;
        showFailure('Quelque chose n\'a pas marché. / Something didn\'t work.', err.message || 'network error');
      });
  });

  function closeScopeEditor() {
    scopeEdit.hidden = true;
    scopeEditToggle.hidden = false;
    scopeEditSave.disabled = false;
  }

  scopeRestart.addEventListener('click', resetToStart);

  scopeGo.addEventListener('click', function () {
    if (!sessionId) return;
    scopeGo.disabled = true;
    scopeRestart.disabled = true;
    fetch('/api/catch/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, monitor: monitorChosen }),
    })
      .then(readJson)
      .then(function (r) {
        if (!r.ok) {
          scopeGo.disabled = false;
          scopeRestart.disabled = false;
          showSubmissionError(r);
          return;
        }
        beginProgress();
        openStream(r.body.streamUrl, r.body.jobId);
        // v0.5.c — when the user opted into monitoring, poll the context gauge.
        // Best-effort: a failed poll never breaks the page or the SSE stream.
        if (monitorChosen && r.body.slug) startGaugePoll(r.body.slug);
      })
      .catch(function (err) {
        scopeGo.disabled = false;
        scopeRestart.disabled = false;
        showFailure('Quelque chose n\'a pas marché. / Something didn\'t work.', err.message || 'network error');
      });
  });

  /* ─────────────── step visibility helper ─────────────── */

  function showStep(name) {
    form.hidden = name !== 'dream';
    stepProfile.hidden = name !== 'profile';
    stepLevel.hidden = name !== 'level';
    stepQuestion.hidden = name !== 'question';
    stepSynth.hidden = name !== 'synth';
    stepScope.hidden = name !== 'scope';
    if (name !== 'dream' && name !== 'progress' && name !== 'result') {
      progressSection.hidden = true;
      resultSection.hidden = true;
    }
  }

  function beginProgress() {
    form.hidden = true;
    stepProfile.hidden = true;
    stepLevel.hidden = true;
    stepQuestion.hidden = true;
    stepSynth.hidden = true;
    stepScope.hidden = true;
    progressSection.hidden = false;
    resultSection.hidden = true;
    logOutput.textContent = '';
    logBuffer = [];
    lastPercent = 0;
    progressBar.removeAttribute('value');
    phaseLine.textContent = '';
    heartbeat.hidden = true;
    heartbeat.classList.remove('stale');
    clearGauge(); // v0.5.c — fresh run starts with a hidden gauge
  }

  /* ─────────────── SSE engine (unchanged from v0.2.5) ─────────────── */

  function readJson(resp) {
    return resp.json().then(function (body) {
      return { ok: resp.ok, status: resp.status, body: body, retryAfter: resp.headers.get('Retry-After') };
    });
  }

  function openStream(streamUrl, jobId) {
    es = new EventSource(streamUrl);
    lastEventAt = Date.now();
    startHeartbeatWatch();
    es.onmessage = function (msg) {
      lastEventAt = Date.now();
      var data;
      try { data = JSON.parse(msg.data); } catch (e) { return; }
      handleEvent(data, jobId);
    };
    es.onerror = function () {
      // Browser auto-reconnects; persistent failures surface via heartbeat staleness.
    };
  }

  function handleEvent(data, jobId) {
    if (data.type === 'log') {
      appendLog(formatLogLine(data), data.stream === 'stderr' ? 'stderr' : 'stdout');
    } else if (data.type === 'status') {
      if (typeof data.phase === 'string') phaseLine.textContent = data.phase;
      if (typeof data.progress_percent === 'number' && isFinite(data.progress_percent)) {
        applyProgressPercent(data.progress_percent);
      }
    } else if (data.type === 'warn') {
      appendLog('[warn] ' + (data.text || ''), 'stderr');
    } else if (data.type === 'done') {
      stopHeartbeatWatch();
      stopGaugePoll(); // v0.5.c — stop polling on completion (gauge stays visible)
      if (es) { es.close(); es = null; }
      showResult(data);
    } else if (data.type === 'error') {
      stopHeartbeatWatch();
      stopGaugePoll();
      if (es) { es.close(); es = null; }
      showFailure('Quelque chose n\'a pas marché. / Something didn\'t work.', data.message || data.code);
    } else if (data.type === 'server_shutdown') {
      stopHeartbeatWatch();
      stopGaugePoll();
      if (es) { es.close(); es = null; }
      showFailure('Le serveur s\'est arrêté. / The server stopped.', '');
    }
  }

  function applyProgressPercent(p) {
    var clamped = Math.max(0, Math.min(100, p));
    if (clamped < lastPercent) return;
    lastPercent = clamped;
    progressBar.value = clamped;
  }

  function formatLogLine(ev) {
    var hhmmss = '';
    if (ev.ts) {
      var d = new Date(ev.ts);
      if (!isNaN(d.getTime())) {
        hhmmss = String(d.getHours()).padStart(2, '0') + ':' +
                 String(d.getMinutes()).padStart(2, '0') + ':' +
                 String(d.getSeconds()).padStart(2, '0') + ' ';
      }
    }
    return hhmmss + (ev.text || '');
  }

  function appendLog(line, kind) {
    logBuffer.push(line);
    if (logBuffer.length > 100) logBuffer.shift();
    var node;
    if (kind === 'stderr') {
      node = document.createElement('span');
      node.className = 'stderr';
      node.textContent = line + '\n';
    } else {
      node = document.createTextNode(line + '\n');
    }
    logOutput.appendChild(node);
    if (!userScrolledLog) {
      logOutput.scrollTop = logOutput.scrollHeight;
    }
  }

  function startHeartbeatWatch() {
    stopHeartbeatWatch();
    heartbeatTimer = setInterval(function () {
      var ageMs = Date.now() - lastEventAt;
      if (ageMs > 5 * 60_000) {
        heartbeat.hidden = false;
        heartbeat.classList.add('stale');
        heartbeat.textContent = 'Ça a peut-être planté — regarde le terminal. / May have stalled — check the terminal.';
      } else if (ageMs > 60_000) {
        heartbeat.hidden = false;
        heartbeat.classList.remove('stale');
        var mins = Math.floor(ageMs / 60_000);
        heartbeat.textContent = 'Toujours en train de bosser… (dernière nouvelle il y a ' + mins +
          ' min) / Still working… (last update ' + mins + ' min ago)';
      } else {
        heartbeat.hidden = true;
      }
    }, 5_000);
  }

  function stopHeartbeatWatch() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  /* ─────────────── v0.5.c context gauge (best-effort poll) ─────────────── */
  // Poll GET /api/status/<slug> every ~3 s while the monitored job runs and
  // render the gauge from `.context`. Decoupled from the SSE stream on purpose:
  // a failed/slow poll is swallowed and NEVER breaks the page or the SSE feed.

  function startGaugePoll(slug) {
    stopGaugePoll();
    pollGaugeOnce(slug); // immediate first sample, then every 3 s
    gaugePollTimer = setInterval(function () { pollGaugeOnce(slug); }, 3000);
  }

  function pollGaugeOnce(slug) {
    fetch('/api/status/' + encodeURIComponent(slug))
      .then(function (resp) { return resp.ok ? resp.json() : null; })
      .then(function (body) {
        if (body && body.context) renderContextGauge(body.context);
      })
      .catch(function () { /* swallow — best-effort poll (AC-4) */ });
  }

  function renderContextGauge(context) {
    if (!contextGauge || !window.MMDGauge) return;
    var html = window.MMDGauge.renderGauge(context);
    if (html) {
      contextGauge.innerHTML = html;
      contextGauge.hidden = false;
    } else {
      contextGauge.hidden = true;
      contextGauge.innerHTML = '';
    }
  }

  function stopGaugePoll() {
    if (gaugePollTimer) {
      clearInterval(gaugePollTimer);
      gaugePollTimer = null;
    }
  }

  function clearGauge() {
    stopGaugePoll();
    if (contextGauge) {
      contextGauge.hidden = true;
      contextGauge.innerHTML = '';
    }
  }

  function showResult(data) {
    progressSection.hidden = true;
    resultSection.hidden = false;
    if (data.exitCode === 0) {
      resultTitle.textContent = '✅ Ton rêve est prêt ! / Your dream is ready!';
      resultMessage.textContent = '';
      resultDebug.hidden = true;
      openAppLink.hidden = false;
      openAppLink.href = data.resultUrl || '#';
      newDreamBtn.hidden = false;
      retryBtn.hidden = true;
    } else {
      resultTitle.textContent = '⚠️ Ça n\'a pas marché. Essaie encore. / Something didn\'t work. Try again.';
      if (logBuffer.length === 0) {
        resultMessage.textContent =
          'Aucune information disponible. Vérifie le terminal où tu as lancé `mmdream serve`. ' +
          '/ No information available. Check the terminal where you started `mmdream serve`.';
        resultDebug.hidden = true;
      } else {
        resultMessage.textContent = 'Derniers messages avant l\'erreur : / Last messages before the error:';
        resultDebug.hidden = false;
        resultDebug.textContent = logBuffer.slice(-10).join('\n');
      }
      openAppLink.hidden = true;
      newDreamBtn.hidden = true;
      retryBtn.hidden = false;
    }
  }

  function showSubmissionError(r) {
    showStep('dream');
    progressSection.hidden = true;
    resultSection.hidden = false;
    input.disabled = false;
    submitBtn.disabled = false;
    var b = r.body || {};
    var msg;
    if (r.status === 429) {
      msg = 'Tu vas un peu vite ! Réessaie dans ' + (r.retryAfter || (b.retry_after_s || '?')) +
            ' s. / Slow down a bit! Try again in ' + (r.retryAfter || (b.retry_after_s || '?')) + ' s.';
    } else if (b.error === 'another_dream_in_progress') {
      msg = 'Un autre rêve est en cours. / Another dream is already running.';
    } else if (b.error === 'unknown_session' || b.error === 'bad_session_state') {
      msg = 'La session a expiré. Recommence. / The session expired. Start over.';
    } else if (b.error === 'dream_empty' || b.error === 'dream_missing') {
      msg = 'Écris quelque chose dans la boîte. / Write something in the box.';
    } else if (b.error === 'dream_too_long') {
      msg = 'Le rêve est trop long (max ' + (b.max_chars || 500) + ' lettres). / Dream too long.';
    } else if (b.error === 'scope_too_long') {
      msg = 'Le scope est trop long (max ' + (b.max_chars || 4000) + ' lettres). Raccourcis-le. ' +
            '/ The scope is too long (max ' + (b.max_chars || 4000) + ' chars). Trim it.';
    } else if (b.error === 'scope_empty' || b.error === 'scope_invalid') {
      msg = 'Écris quelque chose dans le scope. / Write something in the scope.';
    } else if (b.error === 'synthesize_in_progress') {
      msg = 'On réfléchit déjà à ton rêve, attends un instant. / Already thinking about your dream, hold on a moment.';
    } else if (b.error === 'synthesize_failed') {
      msg = 'On n\'a pas pu réfléchir à ton rêve. Réessaie. / We couldn\'t think it through. Try again.';
    } else if (b.error === 'unsluggable_dream') {
      msg = 'Utilise quelques lettres ou chiffres dans ton rêve. / Use some letters or numbers.';
    } else {
      msg = 'Quelque chose n\'a pas marché. Réessaie. / Something didn\'t work. Try again.';
    }
    resultTitle.textContent = '⚠️ ' + msg;
    resultMessage.textContent = '';
    resultDebug.hidden = true;
    openAppLink.hidden = true;
    newDreamBtn.hidden = true;
    retryBtn.hidden = false;
  }

  function showFailure(title, detail) {
    progressSection.hidden = true;
    resultSection.hidden = false;
    input.disabled = false;
    submitBtn.disabled = false;
    resultTitle.textContent = '⚠️ ' + title;
    resultMessage.textContent = detail || '';
    resultDebug.hidden = true;
    openAppLink.hidden = true;
    newDreamBtn.hidden = true;
    retryBtn.hidden = false;
  }

  newDreamBtn.addEventListener('click', resetToStart);
  retryBtn.addEventListener('click', resetToStart);

  function resetToStart() {
    if (es) { es.close(); es = null; }
    stopHeartbeatWatch();
    clearGauge(); // v0.5.c — drop the gauge + any in-flight poll
    sessionId = null;
    progressSection.hidden = true;
    resultSection.hidden = true;
    stepProfile.hidden = true;
    stepLevel.hidden = true;
    stepQuestion.hidden = true;
    stepSynth.hidden = true;
    stepScope.hidden = true;
    closeScopeEditor();
    reenableCatchButtons(); // F4 — clear any in-flight disabled state
    form.hidden = false;
    input.disabled = false;
    submitBtn.disabled = false;
    scopeGo.disabled = false;
    scopeRestart.disabled = false;
    if (questionInput) questionInput.value = '';
    input.value = '';
    input.focus();
    logBuffer = [];
    lastPercent = 0;
    progressBar.removeAttribute('value');
  }
})();
