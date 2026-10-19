let activeCamera = null;

export function closeFrontCamera() {
  activeCamera?.finish(null);
}

export function openFrontCamera() {
  if (activeCamera) return activeCamera.result;
  const dialog = document.createElement('dialog');
  dialog.className = 'selfie-camera';
  dialog.setAttribute('aria-labelledby', 'selfie-camera-title');
  dialog.innerHTML = `<div class="selfie-camera-head"><div><p class="eyebrow">ATTENDANCE PHOTO</p><h2 id="selfie-camera-title">Front camera</h2></div><button type="button" class="close" data-camera-close aria-label="Cancel photo">×</button></div>
    <div class="selfie-camera-view"><video autoplay muted playsinline aria-label="Front camera preview"></video></div>
    <p class="selfie-camera-status" role="status" aria-live="polite">Opening your front camera…</p>
    <div class="selfie-camera-actions"><button type="button" class="btn ghost" data-camera-close>Cancel</button><button type="button" class="btn secondary" data-camera-retry hidden>Try again</button><button type="button" class="btn" data-camera-take disabled>Take photo</button></div>`;
  const video = dialog.querySelector('video');
  video.muted = true;
  const status = dialog.querySelector('.selfie-camera-status');
  const take = dialog.querySelector('[data-camera-take]');
  const retry = dialog.querySelector('[data-camera-retry]');
  let resolve, stream = null, request = 0, closed = false;
  const result = new Promise(done => { resolve = done; });
  const stopStream = () => {
    stream?.getTracks().forEach(track => track.stop());
    stream = null; video.srcObject = null;
  };
  const finish = canvas => {
    if (closed) return;
    closed = true; request++;
    stopStream();
    dialog.close(); dialog.remove();
    if (activeCamera?.dialog === dialog) activeCamera = null;
    resolve(canvas);
  };
  const fail = message => {
    stopStream();
    status.textContent = message;
    status.classList.add('camera-error');
    take.disabled = true; retry.hidden = false;
  };
  async function start() {
    const currentRequest = ++request;
    stopStream(); take.disabled = true; retry.hidden = true;
    status.classList.remove('camera-error');
    status.textContent = 'Opening your front camera…';
    try {
      if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.getSupportedConstraints?.().facingMode)
        throw new Error('This browser cannot select the front camera. Open the app in an updated Chrome or Safari browser.');
      // Mandatory facing mode: never retry with a generic camera, which may select the rear lens.
      const opened = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { exact: 'user' }, width: { ideal: 1280 }, height: { ideal: 1280 } } });
      if (closed || request !== currentRequest) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened;
      const track = stream.getVideoTracks()[0], facing = track?.getSettings?.().facingMode;
      if (!track || facing && facing !== 'user') throw new Error('The front camera could not be selected. Try again or open the app in Chrome or Safari.');
      video.srcObject = stream;
      await video.play();
      if (closed || request !== currentRequest) return;
      if (!video.videoWidth || !video.videoHeight) throw new Error('The camera is not ready. Close other camera apps, then try again.');
      track.addEventListener('ended', () => {
        if (!closed && request === currentRequest) fail('The camera stopped. Tap Try again to reopen the front camera.');
      });
      status.textContent = 'Keep your face clearly visible, then tap Take photo.';
      take.disabled = false;
    } catch (error) {
      if (closed || request !== currentRequest) return;
      fail(error.name === 'NotAllowedError' || error.name === 'SecurityError'
        ? 'Allow Camera access in your browser settings, then tap Try again.'
        : error.name === 'OverconstrainedError' || error.name === 'NotFoundError'
          ? 'A front camera is not available. Use a phone with a front camera and open this app in Chrome or Safari.'
          : error.name === 'NotReadableError'
            ? 'The camera is busy. Close other camera apps, then tap Try again.'
            : error.message || 'Unable to open the front camera. Tap Try again.');
    }
  }
  dialog.querySelectorAll('[data-camera-close]').forEach(button => button.addEventListener('click', () => finish(null)));
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
  retry.addEventListener('click', () => { void start(); });
  take.addEventListener('click', () => {
    if (take.disabled || !stream || closed) return;
    try {
      if (!video.videoWidth || !video.videoHeight || stream.getVideoTracks()[0]?.readyState !== 'live')
        throw new Error('The camera stopped. Tap Try again to reopen the front camera.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      finish(canvas);
    } catch (error) { fail(error.message); }
  });
  activeCamera = { dialog, result, finish };
  document.body.append(dialog);
  try { dialog.showModal(); }
  catch (error) { finish(null); throw error; }
  void start();
  return result;
}
