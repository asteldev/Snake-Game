(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const gameContainer = document.getElementById('game-container');
  const canvasWrapper = canvas.closest('.canvas-wrapper');

  const scoreEl = document.getElementById('score');
  const highScoreEl = document.getElementById('high-score');
  const lengthEl = document.getElementById('length');
  const speedLevelEl = document.getElementById('speed-level');
  const overlay = document.getElementById('overlay');
  const pauseOverlay = document.getElementById('pause-overlay');
  const gameOverEl = document.getElementById('game-over');
  const finalScoreEl = document.getElementById('final-score');
  const finalMessageEl = document.getElementById('final-message');
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');
  const resumeBtn = document.getElementById('resume-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const touchControls = document.getElementById('touch-controls');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsOverlay = document.getElementById('settings-overlay');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const openSettingsStart = document.getElementById('open-settings-start');
  const gestureSettingsPanel = document.getElementById('gesture-settings');
  const settingsError = document.getElementById('settings-error');
  const cameraPreview = document.getElementById('camera-preview');
  const gestureVideo = document.getElementById('gesture-video');
  const gestureCanvas = document.getElementById('gesture-canvas');
  const gestureStatusDot = document.getElementById('gesture-status-dot');
  const gestureStatusText = document.getElementById('gesture-status-text');
  const sensitivityInput = document.getElementById('gesture-sensitivity');
  const sensitivityValue = document.getElementById('sensitivity-value');
  const mirrorCameraInput = document.getElementById('mirror-camera');
  const showPreviewInput = document.getElementById('show-preview');
  const pauseGestureInput = document.getElementById('pause-gesture');
  const controlModeInputs = document.querySelectorAll('input[name="control-mode"]');

  const GRID_COLS = 30;
  const GRID_ROWS = 30;
  const BASE_TICK = 140;
  const MIN_TICK = 55;
  const HIGH_SCORE_KEY = 'neonSerpentHighScore';
  const SETTINGS_KEY = 'neonSerpentSettings';
  const MIN_CELL = 10;
  const MAX_CELL = 24;

  const SENSITIVITY_MAP = { 1: 0.16, 2: 0.12, 3: 0.08 };
  const SENSITIVITY_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };

  const DEFAULT_SETTINGS = {
    controlMode: 'touch',
    gestureSensitivity: 2,
    mirrorCamera: true,
    showPreview: true,
    pauseGesture: true,
  };

  const COLORS = {
    grid: 'rgba(255, 255, 255, 0.03)',
    snakeHead: '#00ff88',
    snakeGlow: 'rgba(0, 255, 136, 0.4)',
    food: '#ff2d95',
    foodGlow: 'rgba(255, 45, 149, 0.5)',
    golden: '#ffd700',
    goldenGlow: 'rgba(255, 215, 0, 0.6)',
  };

  let cellSize = 20;
  let boardW = GRID_COLS * cellSize;
  let boardH = GRID_ROWS * cellSize;
  let dpr = 1;

  let snake = [];
  let direction = { x: 1, y: 0 };
  let nextDirection = { x: 1, y: 0 };
  let food = null;
  let score = 0;
  let highScore = parseInt(localStorage.getItem(HIGH_SCORE_KEY) || '0', 10);
  let gameLoop = null;
  let lastTick = 0;
  let tickInterval = BASE_TICK;
  let speedLevel = 1;
  let paused = false;
  let running = false;
  let particles = [];
  let foodPulse = 0;
  let gridOffset = 0;
  let resizeTimer = null;
  let settings = loadSettings();
  let gestureController = null;
  let swipeEnabled = true;

  highScoreEl.textContent = highScore;

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      return { ...DEFAULT_SETTINGS, ...saved };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function isGestureMode() {
    return settings.controlMode === 'gestures';
  }

  function getGestureOptions() {
    return {
      sensitivity: SENSITIVITY_MAP[settings.gestureSensitivity] || 0.12,
      mirror: settings.mirrorCamera,
      showPreview: settings.showPreview,
      pauseGesture: settings.pauseGesture,
    };
  }

  function applyControlMode() {
    document.body.classList.remove('mode-touch', 'mode-gestures');
    document.body.classList.add(isGestureMode() ? 'mode-gestures' : 'mode-touch');
    swipeEnabled = !isGestureMode();
  }

  function updateGestureStatus(status, detail) {
    if(!gestureStatusDot) return;
    gestureStatusDot.className = 'gesture-dot';
    if (status === 'searching') {
      gestureStatusDot.classList.add('gesture-dot--searching');
      gestureStatusText.textContent = detail || 'Show your hand to the camera';
    } else if (status === 'tracking') {
      gestureStatusDot.classList.add('gesture-dot--tracking');
      gestureStatusText.textContent = 'Pointing ' + detail;
    } else if (status === 'fist') {
      gestureStatusDot.classList.add('gesture-dot--fist');
      gestureStatusText.textContent = detail || 'Hold fist to pause';
    } else if (status === 'error') {
      gestureStatusDot.classList.add('gesture-dot--error');
      gestureStatusText.textContent = detail || 'Camera unavailable';
    } else {
      gestureStatusText.textContent = 'Point index finger to steer · fist to pause';
    }
  }

  async function ensureGestureController() {
    if (gestureController) return gestureController;
    if (!window.HandGestureController) {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (window.HandGestureController) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
    }

    gestureController = new window.HandGestureController({
      onDirection: (dir) => {
        if (dir === 'up') setDirection(0, -1);
        else if (dir === 'down') setDirection(0, 1);
        else if (dir === 'left') setDirection(-1, 0);
        else if (dir === 'right') setDirection(1, 0);
      },
      onPause: () => togglePause(),
      onStatus: updateGestureStatus,
      onError: (err) => {
        settingsError.textContent = err.message || 'Could not access camera.';
        settingsError.classList.remove('hidden');
      },
    });

    await gestureController.initElements(gestureVideo, gestureCanvas);
    return gestureController;
  }

  async function startGestureControl() {
    try {
      const controller = await ensureGestureController();
      controller.updateSettings(getGestureOptions());
      await controller.start(getGestureOptions());
      cameraPreview.classList.remove('hidden');
      cameraPreview.setAttribute('aria-hidden', 'false');
      if (!settings.showPreview) {
        cameraPreview.classList.add('camera-preview--hidden-feed');
      } else {
        cameraPreview.classList.remove('camera-preview--hidden-feed');
      }
    } catch {
      updateGestureStatus('error', 'Allow camera access in Settings');
    }
  }

  function stopGestureControl() {
    if (gestureController) gestureController.stop();
    if(cameraPreview) {
      cameraPreview.classList.add('hidden');
      cameraPreview.setAttribute('aria-hidden', 'true');
    }
    updateGestureStatus('idle');
  }

  function populateSettingsForm() {
    controlModeInputs.forEach((input) => {
      input.checked = input.value === settings.controlMode;
    });
    sensitivityInput.value = settings.gestureSensitivity;
    sensitivityValue.textContent = SENSITIVITY_LABELS[settings.gestureSensitivity];
    mirrorCameraInput.checked = settings.mirrorCamera;
    showPreviewInput.checked = settings.showPreview;
    pauseGestureInput.checked = settings.pauseGesture;
    gestureSettingsPanel.classList.toggle('hidden', !isGestureMode());
    settingsError.classList.add('hidden');
  }

  function readSettingsForm() {
    const selectedMode = document.querySelector('input[name="control-mode"]:checked');
    settings = {
      controlMode: selectedMode ? selectedMode.value : 'touch',
      gestureSensitivity: parseInt(sensitivityInput.value, 10),
      mirrorCamera: mirrorCameraInput.checked,
      showPreview: showPreviewInput.checked,
      pauseGesture: pauseGestureInput.checked,
    };
  }

  function openSettings() {
    if (running && !paused && !gameOverEl.classList.contains('visible')) {
      togglePause();
    }
    populateSettingsForm();
    settingsOverlay.classList.remove('hidden');
    settingsOverlay.classList.add('visible');
  }

  function closeSettings() {
    settingsOverlay.classList.remove('visible');
    settingsOverlay.classList.add('hidden');
  }

  async function commitSettings() {
    readSettingsForm();
    saveSettings();
    applyControlMode();

    if (gestureController) {
      gestureController.updateSettings(getGestureOptions());
    }

    if (running && isGestureMode()) {
      await startGestureControl();
    } else {
      stopGestureControl();
    }

    closeSettings();
    onResize();
  }

  function measureChromeHeight() {
    const header = gameContainer.querySelector('.header');
    const hud = gameContainer.querySelector('.hud');
    const keyboardHint = document.getElementById('controls-hint');
    const touchHint = document.getElementById('controls-hint-touch');
    const gestureHint = document.getElementById('controls-hint-gesture');
    const gap = parseFloat(getComputedStyle(gameContainer).gap) || 12;
    const padding =
      parseFloat(getComputedStyle(gameContainer).paddingTop) +
      parseFloat(getComputedStyle(gameContainer).paddingBottom);

    let chrome = header.offsetHeight + hud.offsetHeight + padding + gap * 3;

    if (keyboardHint && keyboardHint.offsetParent !== null) {
      chrome += keyboardHint.offsetHeight + gap;
    }
    if (touchHint && touchHint.offsetParent !== null) {
      chrome += touchHint.offsetHeight + gap;
    }
    if (gestureHint && gestureHint.offsetParent !== null) {
      chrome += gestureHint.offsetHeight + gap;
    }
    if (touchControls && touchControls.offsetParent !== null) {
      chrome += touchControls.offsetHeight + gap;
    }

    return chrome;
  }

  function resizeCanvas() {
    const chrome = measureChromeHeight();
    const availW = window.innerWidth - 32;
    const availH = window.innerHeight - chrome - 16;

    const cellFromW = Math.floor(availW / GRID_COLS);
    const cellFromH = Math.floor(availH / GRID_ROWS);
    cellSize = Math.min(cellFromW, cellFromH, MAX_CELL);
    cellSize = Math.max(cellSize, MIN_CELL);

    boardW = GRID_COLS * cellSize;
    boardH = GRID_ROWS * cellSize;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(boardW * dpr);
    canvas.height = Math.round(boardH * dpr);
    canvas.style.width = boardW + 'px';
    canvas.style.height = boardH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if(canvasWrapper) {
      canvasWrapper.style.width = boardW + 'px';
      canvasWrapper.style.height = boardH + 'px';
    }
  }

  function scale(value, ref) {
    return value * (cellSize / ref);
  }

  function initSnake() {
    const startX = Math.floor(GRID_COLS / 2);
    const startY = Math.floor(GRID_ROWS / 2);
    snake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
  }

  function randomCell() {
    return {
      x: Math.floor(Math.random() * GRID_COLS),
      y: Math.floor(Math.random() * GRID_ROWS),
    };
  }

  function spawnFood() {
    let cell;
    do {
      cell = randomCell();
    } while (snake.some(s => s.x === cell.x && s.y === cell.y));

    food = {
      ...cell,
      golden: Math.random() < 0.12,
      born: performance.now(),
    };
  }

  function spawnParticles(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = scale(1.5 + Math.random() * 3, 20);
      particles.push({
        x: x * cellSize + cellSize / 2,
        y: y * cellSize + cellSize / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
        size: scale(2 + Math.random() * 3, 20),
      });
    }
  }

  function updateParticles(dt) {
    particles = particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= dt * 0.002;
      p.vx *= 0.96;
      p.vy *= 0.96;
      return p.life > 0;
    });
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = scale(8, 20);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawBackground() {
    ctx.fillStyle = '#0d0d18';
    ctx.fillRect(0, 0, boardW, boardH);

    gridOffset = (gridOffset + 0.15) % cellSize;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = -gridOffset; x < boardW; x += cellSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, boardH);
      ctx.stroke();
    }
    for (let y = -gridOffset; y < boardH; y += cellSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(boardW, y);
      ctx.stroke();
    }

    const grad = ctx.createRadialGradient(
      boardW / 2, boardH / 2, 0,
      boardW / 2, boardH / 2, boardW * 0.7
    );
    grad.addColorStop(0, 'rgba(0, 255, 136, 0.04)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, boardW, boardH);
  }

  function drawSnake() {
    snake.forEach((seg, i) => {
      const t = i / Math.max(snake.length - 1, 1);
      const px = seg.x * cellSize;
      const py = seg.y * cellSize;
      const pad = i === 0 ? scale(1, 20) : scale(2, 20);
      const size = cellSize - pad * 2;
      const radius = i === 0 ? scale(6, 20) : scale(4, 20);

      const g = Math.round(255 - t * 80);
      const b = Math.round(136 - t * 60);
      const color = i === 0 ? COLORS.snakeHead : `rgb(0, ${g}, ${b})`;

      ctx.shadowColor = COLORS.snakeGlow;
      ctx.shadowBlur = i === 0 ? scale(16, 20) : scale(8, 20);

      ctx.fillStyle = color;
      roundRect(ctx, px + pad, py + pad, size, size, radius);
      ctx.fill();

      if (i === 0) {
        ctx.shadowBlur = 0;
        drawEyes(seg);
      }
    });
    ctx.shadowBlur = 0;
  }

  function drawEyes(head) {
    const cx = head.x * cellSize + cellSize / 2;
    const cy = head.y * cellSize + cellSize / 2;
    const eyeOffset = scale(4, 20);
    const eyeSize = scale(3, 20);
    const forward = scale(4, 20);

    let ex1, ey1, ex2, ey2;
    if (direction.x === 1) {
      ex1 = cx + forward; ey1 = cy - eyeOffset;
      ex2 = cx + forward; ey2 = cy + eyeOffset;
    } else if (direction.x === -1) {
      ex1 = cx - forward; ey1 = cy - eyeOffset;
      ex2 = cx - forward; ey2 = cy + eyeOffset;
    } else if (direction.y === -1) {
      ex1 = cx - eyeOffset; ey1 = cy - forward;
      ex2 = cx + eyeOffset; ey2 = cy - forward;
    } else {
      ex1 = cx - eyeOffset; ey1 = cy + forward;
      ex2 = cx + eyeOffset; ey2 = cy + forward;
    }

    ctx.fillStyle = '#0a0a12';
    ctx.beginPath();
    ctx.arc(ex1, ey1, eyeSize, 0, Math.PI * 2);
    ctx.arc(ex2, ey2, eyeSize, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFood(now) {
    if (!food) return;

    foodPulse = Math.sin(now * 0.006) * 0.15 + 1;
    const cx = food.x * cellSize + cellSize / 2;
    const cy = food.y * cellSize + cellSize / 2;
    const baseR = cellSize / 2 - scale(3, 20);
    const r = baseR * foodPulse;

    const isGolden = food.golden;
    const color = isGolden ? COLORS.golden : COLORS.food;
    const glow = isGolden ? COLORS.goldenGlow : COLORS.foodGlow;

    ctx.shadowColor = glow;
    ctx.shadowBlur = isGolden ? scale(24, 20) : scale(16, 20);

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, color);
    grad.addColorStop(1, isGolden ? '#cc9900' : '#cc1470');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    if (isGolden) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = scale(1.5, 20);
      ctx.beginPath();
      ctx.arc(cx, cy, r + scale(2, 20), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
  }

  function roundRect(c, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + radius, y);
    c.lineTo(x + w - radius, y);
    c.quadraticCurveTo(x + w, y, x + w, y + radius);
    c.lineTo(x + w, y + h - radius);
    c.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    c.lineTo(x + radius, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - radius);
    c.lineTo(x, y + radius);
    c.quadraticCurveTo(x, y, x + radius, y);
    c.closePath();
  }

  function updateHUD() {
    scoreEl.textContent = score;
    lengthEl.textContent = snake.length;
    speedLevelEl.textContent = speedLevel + '×';
  }

  function popScore() {
    scoreEl.classList.remove('pop');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('pop');
  }

  function updateSpeed() {
    const newLevel = Math.min(8, 1 + Math.floor((snake.length - 3) / 4));
    if (newLevel !== speedLevel) {
      speedLevel = newLevel;
      tickInterval = Math.max(MIN_TICK, BASE_TICK - (speedLevel - 1) * 12);
    }
  }

  function setDirection(dx, dy) {
    if (paused || !running) return;

    const goingUp = direction.y === -1;
    const goingDown = direction.y === 1;
    const goingLeft = direction.x === -1;
    const goingRight = direction.x === 1;

    if (dy === -1 && !goingDown) nextDirection = { x: 0, y: -1 };
    else if (dy === 1 && !goingUp) nextDirection = { x: 0, y: 1 };
    else if (dx === -1 && !goingRight) nextDirection = { x: -1, y: 0 };
    else if (dx === 1 && !goingLeft) nextDirection = { x: 1, y: 0 };
  }

  function tick() {
    direction = nextDirection;

    const head = {
      x: snake[0].x + direction.x,
      y: snake[0].y + direction.y,
    };

    if (head.x < 0 || head.x >= GRID_COLS || head.y < 0 || head.y >= GRID_ROWS) {
      endGame();
      return;
    }

    if (snake.some(s => s.x === head.x && s.y === head.y)) {
      endGame();
      return;
    }

    snake.unshift(head);

    if (food && head.x === food.x && head.y === food.y) {
      const points = food.golden ? 30 : 10;
      score += points;
      popScore();
      spawnParticles(
        food.x,
        food.y,
        food.golden ? COLORS.golden : COLORS.food,
        food.golden ? 20 : 12
      );
      spawnFood();
      updateSpeed();
    } else {
      snake.pop();
    }

    updateHUD();
  }

  function render(now) {
    drawBackground();
    drawFood(now);
    drawSnake();
    drawParticles();
  }

  function gameFrame(timestamp) {
    if (!running) return;

    updateParticles(16);

    if (!paused) {
      const dt = timestamp - lastTick;
      if (dt >= tickInterval) {
        lastTick = timestamp - (dt % tickInterval);
        tick();
      }
    }

    render(timestamp);
    gameLoop = requestAnimationFrame(gameFrame);
  }

  function startGame() {
    resizeCanvas();
    score = 0;
    speedLevel = 1;
    tickInterval = BASE_TICK;
    paused = false;
    running = true;
    particles = [];

    initSnake();
    spawnFood();
    updateHUD();

    overlay.classList.remove('visible');
    overlay.classList.add('hidden');
    gameOverEl.classList.remove('visible');
    gameOverEl.classList.add('hidden');
    pauseOverlay.classList.remove('visible');
    pauseOverlay.classList.add('hidden');

    lastTick = performance.now();
    canvas.focus();

    if (gameLoop) cancelAnimationFrame(gameLoop);
    gameLoop = requestAnimationFrame(gameFrame);

    if (isGestureMode()) {
      startGestureControl();
    } else {
      stopGestureControl();
    }
  }

  function togglePause() {
    if (!running || gameOverEl.classList.contains('visible')) return;

    paused = !paused;
    if (paused) {
      pauseOverlay.classList.remove('hidden');
      pauseOverlay.classList.add('visible');
    } else {
      pauseOverlay.classList.remove('visible');
      pauseOverlay.classList.add('hidden');
      lastTick = performance.now();
      canvas.focus();
    }
  }

  function getMessage(s) {
    if (s >= 200) return 'Legendary serpent!';
    if (s >= 100) return 'Master of the grid!';
    if (s >= 50) return 'Impressive slithering!';
    if (s >= 20) return 'Getting the hang of it!';
    return 'Nice try — go again!';
  }

  function endGame() {
    running = false;
    if (gameLoop) cancelAnimationFrame(gameLoop);
    stopGestureControl();

    if (score > highScore) {
      highScore = score;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
      highScoreEl.textContent = highScore;
    }

    finalScoreEl.textContent = 'Score: ' + score;
    finalMessageEl.textContent = getMessage(score);

    gameOverEl.classList.remove('hidden');
    gameOverEl.classList.add('visible');
  }

  function handleKey(e) {
    const key = e.key.toLowerCase();

    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '].includes(key)) {
      e.preventDefault();
    }

    if (key === ' ' && running && !gameOverEl.classList.contains('visible')) {
      togglePause();
      return;
    }

    if (paused || !running) return;

    if (key === 'arrowup' || key === 'w') setDirection(0, -1);
    else if (key === 'arrowdown' || key === 's') setDirection(0, 1);
    else if (key === 'arrowleft' || key === 'a') setDirection(-1, 0);
    else if (key === 'arrowright' || key === 'd') setDirection(1, 0);
  }

  function setupSwipeControls() {
    let touchStartX = 0;
    let touchStartY = 0;
    const minSwipe = 24;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (!running || paused || !swipeEnabled) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;

      if (Math.abs(dx) < minSwipe && Math.abs(dy) < minSwipe) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        setDirection(dx > 0 ? 1 : -1, 0);
      } else {
        setDirection(0, dy > 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  function setupDpadControls() {
    const pressClass = 'pressed';

    function bindDirection(btn, dx, dy) {
      const apply = () => setDirection(dx, dy);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        apply();
      });

      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btn.classList.add(pressClass);
        apply();
      }, { passive: false });

      const release = () => btn.classList.remove(pressClass);
      btn.addEventListener('touchend', release);
      btn.addEventListener('touchcancel', release);
    }

    document.querySelectorAll('.dpad-btn[data-dir]').forEach((btn) => {
      const dir = btn.dataset.dir;
      if (dir === 'up') bindDirection(btn, 0, -1);
      else if (dir === 'down') bindDirection(btn, 0, 1);
      else if (dir === 'left') bindDirection(btn, -1, 0);
      else if (dir === 'right') bindDirection(btn, 1, 0);
    });

    if(pauseBtn) {
      pauseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        togglePause();
      });
    }
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wasRunning = running;
      resizeCanvas();
      if (wasRunning) {
        render(performance.now());
      } else {
        drawBackground();
        render(0);
      }
    }, 100);
  }

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);
  resumeBtn.addEventListener('click', () => {
    if (paused) togglePause();
  });

  if(settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if(openSettingsStart) openSettingsStart.addEventListener('click', openSettings);
  if(closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if(saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => commitSettings());

  controlModeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      const selected = document.querySelector('input[name="control-mode"]:checked');
      if(gestureSettingsPanel) gestureSettingsPanel.classList.toggle('hidden', selected?.value !== 'gestures');
    });
  });

  if(sensitivityInput) {
    sensitivityInput.addEventListener('input', () => {
      sensitivityValue.textContent = SENSITIVITY_LABELS[sensitivityInput.value];
    });
  }

  document.addEventListener('keydown', handleKey);
  canvas.addEventListener('click', () => canvas.focus());
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopGestureControl();
    } else if (running && isGestureMode()) {
      startGestureControl();
    }
  });

  setupSwipeControls();
  setupDpadControls();
  applyControlMode();
  if(sensitivityInput) populateSettingsForm();
  resizeCanvas();
  drawBackground();
  render(0);
})();