import {
  HandLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getPalmCenter(landmarks) {
  const ids = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const id of ids) {
    x += landmarks[id].x;
    y += landmarks[id].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

function isIndexExtended(landmarks) {
  const tip = landmarks[8];
  const pip = landmarks[6];
  const wrist = landmarks[0];
  return dist(tip, wrist) > dist(pip, wrist) * 1.12;
}

function isFist(landmarks) {
  const wrist = landmarks[0];
  const tips = [8, 12, 16, 20];
  const mcps = [5, 9, 13, 17];
  const avgTip =
    tips.reduce((sum, i) => sum + dist(landmarks[i], wrist), 0) / tips.length;
  const avgMcp =
    mcps.reduce((sum, i) => sum + dist(landmarks[i], wrist), 0) / mcps.length;
  return avgTip < avgMcp * 1.08;
}

function resolveDirection(landmarks, sensitivity, mirror) {
  if (!isIndexExtended(landmarks)) return null;

  const palm = getPalmCenter(landmarks);
  const tip = landmarks[8];
  let dx = tip.x - palm.x;
  let dy = tip.y - palm.y;
  if (mirror) dx = -dx;

  const mag = Math.hypot(dx, dy);
  if (mag < sensitivity) return null;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'down' : 'up';
}

class HandGestureController {
  constructor(callbacks) {
    this.onDirection = callbacks.onDirection;
    this.onPause = callbacks.onPause;
    this.onStatus = callbacks.onStatus;
    this.onError = callbacks.onError;

    this.video = null;
    this.previewCanvas = null;
    this.previewCtx = null;
    this.landmarker = null;
    this.stream = null;
    this.rafId = null;
    this.active = false;
    this.lastVideoTime = -1;
    this.lastDirTime = 0;
    this.fistStart = 0;
    this.fistTriggered = false;
    this.settings = {
      sensitivity: 0.12,
      mirror: true,
      showPreview: true,
      pauseGesture: true,
    };
    this.status = 'idle';
    this.currentDir = null;
  }

  async initElements(videoEl, canvasEl) {
    this.video = videoEl;
    this.previewCanvas = canvasEl;
    this.previewCtx = canvasEl.getContext('2d');
  }

  async loadModel() {
    if (this.landmarker) return;

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    });
  }

  updateSettings(next) {
    this.settings = { ...this.settings, ...next };
    if (this.video) {
      this.video.style.transform = this.settings.mirror ? 'scaleX(-1)' : 'none';
    }
    if (this.previewCanvas) {
      this.previewCanvas.style.transform = this.settings.mirror ? 'scaleX(-1)' : 'none';
    }
  }

  setStatus(status, detail = '') {
    this.status = status;
    this.onStatus?.(status, detail);
  }

  async start(settings = {}) {
    if (this.active) return;
    this.updateSettings(settings);

    try {
      await this.loadModel();

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      this.video.srcObject = this.stream;
      await this.video.play();

      this.previewCanvas.width = this.video.videoWidth || 320;
      this.previewCanvas.height = this.video.videoHeight || 240;

      this.active = true;
      this.lastVideoTime = -1;
      this.fistStart = 0;
      this.fistTriggered = false;
      this.setStatus('ready', 'Point your index finger to steer');
      this.detectLoop();
    } catch (err) {
      this.setStatus('error', err.message || 'Camera access denied');
      this.onError?.(err);
      throw err;
    }
  }

  stop() {
    this.active = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this.currentDir = null;
    this.setStatus('idle');
  }

  drawPreview(landmarks) {
    const ctx = this.previewCtx;
    const w = this.previewCanvas.width;
    const h = this.previewCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.video, 0, 0, w, h);

    if (!landmarks) return;

    ctx.strokeStyle = 'rgba(0, 255, 136, 0.85)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 6;

    const palm = getPalmCenter(landmarks);
    const tip = landmarks[8];

    ctx.beginPath();
    ctx.moveTo(palm.x * w, palm.y * h);
    ctx.lineTo(tip.x * w, tip.y * h);
    ctx.stroke();

    ctx.fillStyle = '#00e5ff';
    ctx.beginPath();
    ctx.arc(tip.x * w, tip.y * h, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  detectLoop() {
    if (!this.active) return;

    this.rafId = requestAnimationFrame(() => this.detectLoop());

    if (!this.video || this.video.readyState < 2) return;

    const now = performance.now();
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, now);
    const landmarks = result.landmarks?.[0];

    if (this.settings.showPreview) {
      this.drawPreview(landmarks || null);
    } else {
      this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }

    if (!landmarks) {
      this.currentDir = null;
      this.fistStart = 0;
      this.fistTriggered = false;
      this.setStatus('searching', 'Show your hand to the camera');
      return;
    }

    if (this.settings.pauseGesture && isFist(landmarks)) {
      if (!this.fistStart) this.fistStart = now;
      if (now - this.fistStart > 550 && !this.fistTriggered) {
        this.fistTriggered = true;
        this.onPause?.();
        this.setStatus('ready', 'Fist detected — paused');
      } else {
        this.setStatus('fist', 'Hold fist to pause');
      }
      return;
    }

    this.fistStart = 0;
    this.fistTriggered = false;

    const dir = resolveDirection(
      landmarks,
      this.settings.sensitivity,
      this.settings.mirror
    );

    if (!dir) {
      this.currentDir = null;
      this.setStatus('ready', 'Extend index finger and point');
      return;
    }

    this.currentDir = dir;
    this.setStatus('tracking', dir);

    if (now - this.lastDirTime > 120) {
      this.lastDirTime = now;
      this.onDirection?.(dir);
    }
  }
}

window.HandGestureController = HandGestureController;
