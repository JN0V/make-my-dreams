// MMD Drawing — Camera Overlay (vanilla ES2022 module).
// Bundle B safe-default: getUserMedia is requested ONLY on the "Start Camera"
// button click, never on page load.

const $ = (id) => document.getElementById(id);

const video    = $('video');
const overlay  = $('overlay');
const draw     = $('draw');
const message  = $('message');

const btnCamera = $('btn-camera');
const btnPen    = $('btn-pen');
const btnEraser = $('btn-eraser');
const btnClear  = $('btn-clear');
const colorIn   = $('color-input');
const sizeIn    = $('size-input');
const fileIn    = $('file-input');

const overlayCtx = overlay.getContext('2d');
const drawCtx    = draw.getContext('2d');

let tool = 'pen';            // 'pen' | 'eraser'
let pointerActive = false;
let lastX = 0, lastY = 0;

// ---------- Canvas sizing ----------
function resizeCanvases() {
  const rect = draw.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  for (const c of [overlay, draw]) {
    c.width  = Math.max(1, Math.floor(rect.width  * dpr));
    c.height = Math.max(1, Math.floor(rect.height * dpr));
  }
  // Reset transforms after resize.
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawCtx.setTransform(1, 0, 0, 1, 0, 0);
}

window.addEventListener('resize', resizeCanvases);
window.addEventListener('orientationchange', resizeCanvases);
resizeCanvases();

// ---------- Tool selection ----------
function setTool(name) {
  tool = name;
  btnPen.setAttribute('aria-pressed', name === 'pen' ? 'true' : 'false');
  btnEraser.setAttribute('aria-pressed', name === 'eraser' ? 'true' : 'false');
}

btnPen.addEventListener('click',    () => setTool('pen'));
btnEraser.addEventListener('click', () => setTool('eraser'));

btnClear.addEventListener('click', () => {
  drawCtx.save();
  drawCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawCtx.clearRect(0, 0, draw.width, draw.height);
  drawCtx.restore();
});

// ---------- Camera (Bundle B safe-default: user gesture only) ----------
function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}
function clearMessage() {
  message.hidden = true;
}

btnCamera.addEventListener('click', async () => {
  // Distinguish three failure modes so the message is actually useful:
  //   1. Page opened via file:// or http:// non-localhost — browser blocks
  //      navigator.mediaDevices (which then appears "undefined"). Fix: serve
  //      via http://localhost or https://. This is by far the most common
  //      cause of "camera not working" reports.
  //   2. Genuinely-old browser without the MediaDevices API.
  //   3. API present but getUserMedia returns null/undefined.
  // Per constitution v1.2 principle IV (every failure deserves a red-green
  // pass): the v0.1 message "Camera API not available in this browser" was
  // misleading for case 1, which is what Sébastien observed when opening
  // via file://. Test in test/integration/camera-secure-context.test.js.
  if (!window.isSecureContext) {
    showMessage(
      'Camera blocked: this page is not in a secure context. ' +
        'Open it via http://localhost or https:// to enable the camera. ' +
        'In the meantime you can still upload an image and draw.'
    );
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMessage(
      'Camera API not available in this browser (try Chrome 120+, Firefox 120+, or Safari 17+). ' +
        'You can still upload an image and draw.'
    );
    return;
  }
  btnCamera.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => { /* autoplay may already be in progress */ });
    clearMessage();
    btnCamera.textContent = 'Camera On';
  } catch (err) {
    // Graceful degrade: keep drawing usable even when camera is denied.
    showMessage(
      `Camera unavailable (${err.name || 'error'}). ` +
        'You can still upload an image and draw on top of it.'
    );
    btnCamera.disabled = false;
  }
});

// ---------- Image upload (overlay onto the overlay canvas at 0.5 alpha) ----------
fileIn.addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    showMessage('Please choose an image file.');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    overlayCtx.save();
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    overlayCtx.globalAlpha = 0.5;
    // Contain-fit the image inside the overlay canvas.
    const cw = overlay.width, ch = overlay.height;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    overlayCtx.drawImage(img, dx, dy, dw, dh);
    overlayCtx.restore();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    showMessage('Could not load that image.');
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

// ---------- Drawing (pointer events cover mouse + touch + pen) ----------
function eventToLocal(ev) {
  const rect = draw.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: (ev.clientX - rect.left) * dpr,
    y: (ev.clientY - rect.top)  * dpr,
  };
}

draw.addEventListener('pointerdown', (ev) => {
  pointerActive = true;
  draw.setPointerCapture(ev.pointerId);
  const { x, y } = eventToLocal(ev);
  lastX = x; lastY = y;
  // Tiny dot on click.
  drawCtx.save();
  drawCtx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  drawCtx.fillStyle = colorIn.value;
  drawCtx.beginPath();
  drawCtx.arc(x, y, Math.max(0.5, Number(sizeIn.value) / 2), 0, Math.PI * 2);
  drawCtx.fill();
  drawCtx.restore();
});

draw.addEventListener('pointermove', (ev) => {
  if (!pointerActive) return;
  const { x, y } = eventToLocal(ev);
  drawCtx.save();
  drawCtx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  drawCtx.strokeStyle = colorIn.value;
  drawCtx.lineWidth   = Number(sizeIn.value);
  drawCtx.lineCap     = 'round';
  drawCtx.lineJoin    = 'round';
  drawCtx.beginPath();
  drawCtx.moveTo(lastX, lastY);
  drawCtx.lineTo(x, y);
  drawCtx.stroke();
  drawCtx.restore();
  lastX = x; lastY = y;
});

function endPointer(ev) {
  if (!pointerActive) return;
  pointerActive = false;
  try { draw.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
}
draw.addEventListener('pointerup', endPointer);
draw.addEventListener('pointercancel', endPointer);
draw.addEventListener('pointerleave', endPointer);
