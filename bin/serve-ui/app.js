// MMD serve UI — v0.2.5
// Vanilla JS, no framework, no inline script. CSP `script-src 'self'`.
// Implements AC-2b (keyboard nav, Ctrl+Enter), AC-4 (live SSE + heartbeat),
// AC-5 (result rendering), AC-6 (status polling + heartbeat staleness).

(function () {
  'use strict';

  var form = document.getElementById('dream-form');
  var input = document.getElementById('dream-input');
  var submitBtn = document.getElementById('submit-btn');
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

  /** Bounded ring of last 100 log lines for the failure-debug snippet (AC-5). */
  var logBuffer = [];
  /** Last percent set on the bar (monotonic clamp per F24). */
  var lastPercent = 0;
  /** Last event timestamp (heartbeat staleness per AC-4). */
  var lastEventAt = 0;
  /** Whether the user has scrolled the log up (preserve scroll position per AC-4). */
  var userScrolledLog = false;
  /** Active EventSource. */
  var es = null;
  /** Heartbeat staleness timer. */
  var heartbeatTimer = null;

  logOutput.addEventListener('scroll', function () {
    var atBottom = logOutput.scrollHeight - logOutput.scrollTop - logOutput.clientHeight < 8;
    userScrolledLog = !atBottom;
  });

  // AC-2b: Ctrl+Enter / Cmd+Enter submits.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!submitBtn.disabled) form.requestSubmit();
    }
  });

  // AC-2b: Esc closes the SSE connection client-side; subprocess continues.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && es) {
      es.close();
      es = null;
      appendLog('[client] connexion fermée / connection closed', 'stderr');
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var dream = input.value.trim();
    if (dream.length === 0) return;
    submitDream(dream);
  });

  newDreamBtn.addEventListener('click', resetUi);
  retryBtn.addEventListener('click', resetUi);

  function submitDream(dream) {
    input.disabled = true;
    submitBtn.disabled = true;
    progressSection.hidden = false;
    resultSection.hidden = true;
    logOutput.textContent = '';
    logBuffer = [];
    lastPercent = 0;
    progressBar.removeAttribute('value');
    phaseLine.textContent = '';
    heartbeat.hidden = true;
    heartbeat.classList.remove('stale');

    fetch('/api/dream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dream: dream }),
    })
      .then(function (resp) {
        return resp.json().then(function (body) {
          return { ok: resp.ok, status: resp.status, body: body, retryAfter: resp.headers.get('Retry-After') };
        });
      })
      .then(function (r) {
        if (!r.ok) {
          showSubmissionError(r);
          return;
        }
        openStream(r.body.streamUrl, r.body.jobId);
      })
      .catch(function (err) {
        showFailure('Quelque chose n\'a pas marché. / Something didn\'t work.', err.message || 'network error');
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
      // Browser auto-reconnects; we only surface persistent failures via heartbeat staleness.
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
    if (clamped < lastPercent) return; // monotonic clamp (F24)
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
    submitBtn.disabled = false;
    input.disabled = false;
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
    progressSection.hidden = true;
    resultSection.hidden = false;
    submitBtn.disabled = false;
    input.disabled = false;
    var b = r.body || {};
    var msg;
    if (r.status === 429) {
      msg = 'Tu vas un peu vite ! Réessaie dans ' + (r.retryAfter || (b.retry_after_s || '?')) +
            ' s. / Slow down a bit! Try again in ' + (r.retryAfter || (b.retry_after_s || '?')) + ' s.';
    } else if (b.error === 'duplicate_dream') {
      msg = 'Un rêve avec des mots proches existe déjà. / A similar dream already exists.';
    } else if (b.error === 'another_dream_in_progress') {
      msg = 'Un autre rêve est en cours. / Another dream is already running.';
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
    submitBtn.disabled = false;
    input.disabled = false;
    resultTitle.textContent = '⚠️ ' + title;
    resultMessage.textContent = detail || '';
    resultDebug.hidden = true;
    openAppLink.hidden = true;
    newDreamBtn.hidden = true;
    retryBtn.hidden = false;
  }

  function resetUi() {
    if (es) { es.close(); es = null; }
    stopHeartbeatWatch();
    progressSection.hidden = true;
    resultSection.hidden = true;
    input.disabled = false;
    submitBtn.disabled = false;
    input.value = '';
    input.focus();
    logBuffer = [];
    lastPercent = 0;
    progressBar.removeAttribute('value');
  }
})();
