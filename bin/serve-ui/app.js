// MMD serve UI — v0.3.a-1 Dream Catcher multi-step flow.
// Vanilla JS, no framework, no inline script (CSP `script-src 'self'`).
//
// Flow: dream textarea → 3 profile buttons (Enfant / Curieux / Pro) → autonomous
// BMAD synthesize → scope card (Recommencer / C'est parti !) → existing SSE
// progress view. No involvement-level chooser and no scope editor in this slice
// (SPEC_V03A1 AC-5). The SSE/progress/result engine below is unchanged from
// v0.2.5 — only the front of the flow is new.

(function () {
  'use strict';

  // Step elements
  var form = document.getElementById('dream-form');
  var input = document.getElementById('dream-input');
  var submitBtn = document.getElementById('submit-btn');
  var stepProfile = document.getElementById('step-profile');
  var profileButtons = document.querySelectorAll('.profile-btn');
  var stepSynth = document.getElementById('step-synth');
  var stepScope = document.getElementById('step-scope');
  var scopeNote = document.getElementById('scope-note');
  var scopeText = document.getElementById('scope-text');
  var scopeRestart = document.getElementById('scope-restart');
  var scopeGo = document.getElementById('scope-go');

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

  /* ─────────────── Step 2: profile → synthesize ─────────────── */

  profileButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!sessionId) return;
      answerProfile(btn.getAttribute('data-profile'));
    });
  });

  function answerProfile(profile) {
    showStep('synth');
    fetch('/api/catch/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, answer: profile }),
    })
      .then(readJson)
      .then(function (r) {
        if (!r.ok) { showSubmissionError(r); return; }
        renderScope(r.body);
      })
      .catch(function (err) {
        showFailure('Quelque chose n\'a pas marché. / Something didn\'t work.', err.message || 'network error');
      });
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
    showStep('scope');
  }

  scopeRestart.addEventListener('click', resetToStart);

  scopeGo.addEventListener('click', function () {
    if (!sessionId) return;
    scopeGo.disabled = true;
    scopeRestart.disabled = true;
    fetch('/api/catch/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId }),
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
      if (es) { es.close(); es = null; }
      showResult(data);
    } else if (data.type === 'error') {
      stopHeartbeatWatch();
      if (es) { es.close(); es = null; }
      showFailure('Quelque chose n\'a pas marché. / Something didn\'t work.', data.message || data.code);
    } else if (data.type === 'server_shutdown') {
      stopHeartbeatWatch();
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
          'Aucune information disponible. Vérifie le terminal où tu as lancé `mmd serve`. ' +
          '/ No information available. Check the terminal where you started `mmd serve`.';
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
    sessionId = null;
    progressSection.hidden = true;
    resultSection.hidden = true;
    stepProfile.hidden = true;
    stepSynth.hidden = true;
    stepScope.hidden = true;
    form.hidden = false;
    input.disabled = false;
    submitBtn.disabled = false;
    scopeGo.disabled = false;
    scopeRestart.disabled = false;
    input.value = '';
    input.focus();
    logBuffer = [];
    lastPercent = 0;
    progressBar.removeAttribute('value');
  }
})();
