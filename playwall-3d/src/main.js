import * as THREE from 'three';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

// ── ELEMENTS ──────────────────────────────────────────────────────
const threeCanvas  = document.getElementById('three-canvas');
const videoEl      = document.getElementById('webcam');
const poseCanvas   = document.getElementById('pose-canvas');
const pCtx         = poseCanvas.getContext('2d');
const scoreEl      = document.getElementById('score-value');
const statusEl     = document.getElementById('status-text');
const gestureEl    = document.getElementById('gesture-text');
const overlayEl    = document.getElementById('overlay');
const gameoverEl   = document.getElementById('gameover');
const finalScoreEl = document.getElementById('final-score');

// ── THREE.JS ──────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0a1a, 25, 85);
scene.background = new THREE.Color(0x0a0a1a);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 3.5, 10);
camera.lookAt(0, 1.5, 0);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ── LIGHTS ────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(5, 10, 5);
sun.castShadow = true;
scene.add(sun);
const pinkL = new THREE.PointLight(0xff6b6b, 2, 30);
pinkL.position.set(-5, 4, 2);
scene.add(pinkL);
const tealL = new THREE.PointLight(0x4ecdc4, 2, 30);
tealL.position.set(5, 4, 2);
scene.add(tealL);

// ── ROAD ──────────────────────────────────────────────────────────
const roadMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 300),
  new THREE.MeshLambertMaterial({ color: 0x151530 })
);
roadMesh.rotation.x = -Math.PI / 2;
roadMesh.position.set(0, 0, -140);
roadMesh.receiveShadow = true;
scene.add(roadMesh);

// Edge glows
[-4, 4].forEach(x => {
  const e = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 300),
    new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.7 })
  );
  e.rotation.x = -Math.PI / 2;
  e.position.set(x, 0.01, -140);
  scene.add(e);
});

// Lane dashes (static — scrolled via position offset)
[-1.33, 1.33].forEach(x => {
  for (let z = -2; z > -80; z -= 4) {
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 1.8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 })
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.01, z);
    scene.add(dash);
  }
});

// Buildings
const bColors = [0x0d1b2a, 0x1b2a3b, 0x0f1f30, 0x152535];
for (let i = 0; i < 22; i++) {
  const z = -i * 8;
  const h = 5 + Math.random() * 14;
  const c = bColors[Math.floor(Math.random() * bColors.length)];
  [-8 - Math.random() * 3, 8 + Math.random() * 3].forEach(bx => {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(3 + Math.random() * 2, h, 4),
      new THREE.MeshLambertMaterial({ color: c })
    );
    b.position.set(bx, h / 2, z);
    scene.add(b);
  });
}

// ── PLAYER ────────────────────────────────────────────────────────
const LANE_X = [-2.66, 0, 2.66];

const player = new THREE.Group();
scene.add(player);

// Body
const body = new THREE.Mesh(
  new THREE.BoxGeometry(0.7, 1.1, 0.4),
  new THREE.MeshLambertMaterial({ color: 0xff6b6b })
);
body.position.y = 1.35;
body.castShadow = true;
player.add(body);

// Head
const head = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 16, 16),
  new THREE.MeshLambertMaterial({ color: 0xffd93d })
);
head.position.y = 2.2;
head.castShadow = true;
player.add(head);

// Cap
const cap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.35, 0.35, 0.14, 16),
  new THREE.MeshLambertMaterial({ color: 0x6bcb77 })
);
cap.position.y = 2.48;
player.add(cap);

// Legs
const legMat = new THREE.MeshLambertMaterial({ color: 0x2d2d6e });
const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.22), legMat);
const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.22), legMat);
legL.position.set(-0.18, 0.45, 0);
legR.position.set( 0.18, 0.45, 0);
legL.castShadow = legR.castShadow = true;
player.add(legL, legR);

player.position.set(0, 0, 2);

const PL = {
  lane: 1, targetX: 0,
  jumping: false, jumpVel: 0, jumpY: 0,
  sliding: false, slideTimer: 0,
  runT: 0
};

// ── GAME STATE ────────────────────────────────────────────────────
let state      = 'menu';
let score      = 0;
let speed      = 0.12;
let frame      = 0;
let obstacles  = [];
let coins      = [];
let sparks     = [];
let spawnT     = 0;
let coinT      = 0;

const barrierMat = new THREE.MeshLambertMaterial({ color: 0xff3434, emissive: 0x660000, emissiveIntensity: 0.2 });
const hangMat    = new THREE.MeshLambertMaterial({ color: 0x4ecdc4, emissive: 0x004444, emissiveIntensity: 0.2 });
const coinMat    = new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0x443300, emissiveIntensity: 0.3 });

function spawnObstacle() {
  const type = Math.random() < 0.45 ? 'hang' : 'barrier';
  const lane = Math.floor(Math.random() * 3);
  let mesh;
  if (type === 'barrier') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.4), barrierMat.clone());
    mesh.position.set(LANE_X[lane], 0.75, -42);
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.5), hangMat.clone());
    mesh.position.set(LANE_X[lane], 1.9, -42);
  }
  mesh.castShadow = true;
  scene.add(mesh);
  obstacles.push({ mesh, type, lane });
}

function spawnCoins() {
  const lane  = Math.floor(Math.random() * 3);
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 8, 16), coinMat.clone());
    mesh.position.set(LANE_X[lane], 1.1, -42 - i * 2.2);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    coins.push({ mesh, lane, collected: false });
  }
}

function burst(pos, color, n = 12) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 4, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    m.position.copy(pos);
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 0.25,
      Math.random() * 0.18 + 0.06,
      (Math.random() - 0.5) * 0.1
    );
    scene.add(m);
    sparks.push({ m, v, life: 35 });
  }
}

// ── POSE TRACKING ─────────────────────────────────────────────────
let poseLandmarker = null;
let drawUtils      = null;
let baseHipY       = null;
let calCount       = 0;
let hipSamples     = [];
let gCd            = 0;
const CAL_N        = 40;
let jumpCd = 0, slideCd = 0, leanCd = 0;

async function initPose() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    drawUtils = new DrawingUtils(pCtx);
    statusEl.textContent = 'Camera on. Calibrating…';
    runPose();
  } catch (e) {
    statusEl.textContent = 'Pose init failed: ' + e.message;
  }
}

function runPose() {
  pCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
  pCtx.drawImage(videoEl, 0, 0, poseCanvas.width, poseCanvas.height);

  if (poseLandmarker) {
    const res = poseLandmarker.detectForVideo(videoEl, performance.now());
    if (res.landmarks && res.landmarks.length > 0) {
      const lm = res.landmarks[0];
      drawUtils.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: '#6bcb77', lineWidth: 1.5 });
      drawUtils.drawLandmarks(lm, { color: '#ffd93d', radius: 2 });

      const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24];
      if (ls && rs && lh && rh) {
        const shX = (ls.x + rs.x) / 2;
        const hipX = (lh.x + rh.x) / 2;
        const hipY = (lh.y + rh.y) / 2;

        if (calCount < CAL_N) {
          hipSamples.push(hipY);
          calCount++;
          statusEl.textContent = `Calibrating… ${calCount}/${CAL_N}`;
          if (calCount === CAL_N) {
            baseHipY = hipSamples.reduce((a, b) => a + b) / CAL_N;
            statusEl.textContent = 'Ready!';
          }
        } else if (gCd > 0) {
          gCd--;
        } else {
          const rise = baseHipY - hipY;
          const drop = hipY - baseHipY;
          const lean = shX - hipX;
          let g = null;
          if      (rise > 0.08)  { g = 'JUMP';  gCd = 20; }
          else if (drop > 0.07)  { g = 'SQUAT'; gCd = 30; }
          else if (lean > 0.07)  { g = 'LEFT';  gCd = 22; }
          else if (lean < -0.07) { g = 'RIGHT'; gCd = 22; }
          if (g) { gestureEl.textContent = g; handleGesture(g); }
        }
      }
    }
  }
  requestAnimationFrame(runPose);
}

navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
  .then(s => { videoEl.srcObject = s; videoEl.onloadeddata = () => initPose(); })
  .catch(e => { statusEl.textContent = 'Camera: ' + e.message; });

// ── GESTURES ──────────────────────────────────────────────────────
function handleGesture(g) {
  if (state === 'dead'    && g === 'JUMP') { startGame(); return; }
  if (state !== 'playing') return;
  if      (g === 'LEFT'  && PL.lane > 0 && leanCd <= 0) { PL.lane--; PL.targetX = LANE_X[PL.lane]; leanCd = 28; }
  else if (g === 'RIGHT' && PL.lane < 2 && leanCd <= 0) { PL.lane++; PL.targetX = LANE_X[PL.lane]; leanCd = 28; }
  else if (g === 'JUMP'  && !PL.jumping  && jumpCd <= 0) { PL.jumping = true; PL.jumpVel = 0.2; jumpCd = 35; }
  else if (g === 'SQUAT' && !PL.sliding  && slideCd <= 0){ PL.sliding = true; PL.slideTimer = 44; slideCd = 60; }
}

document.addEventListener('keydown', e => {
  const m = { ArrowLeft:'LEFT', ArrowRight:'RIGHT', ArrowUp:'JUMP', ' ':'JUMP', ArrowDown:'SQUAT' };
  if (m[e.key]) { gestureEl.textContent = m[e.key]; handleGesture(m[e.key]); e.preventDefault(); }
  if (e.key === 'Enter' && state === 'dead') startGame();
});

// ── START / END ───────────────────────────────────────────────────
function startGame() {
  state = 'playing'; score = 0; speed = 0.12; frame = 0;
  PL.lane = 1; PL.targetX = LANE_X[1];
  PL.jumping = false; PL.jumpVel = 0; PL.jumpY = 0;
  PL.sliding = false; PL.slideTimer = 0;
  jumpCd = 0; slideCd = 0; leanCd = 0; spawnT = 0; coinT = 0;
  obstacles.forEach(o => scene.remove(o.mesh));
  coins.forEach(c => scene.remove(c.mesh));
  sparks.forEach(s => scene.remove(s.m));
  obstacles = []; coins = []; sparks = [];
  overlayEl.style.display  = 'none';
  gameoverEl.style.display = 'none';
}
window.startGame = startGame;

function endGame() {
  state = 'dead';
  gameoverEl.style.display = 'flex';
  finalScoreEl.textContent = 'Score: ' + score;
}

// ── MAIN LOOP ─────────────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);

  const t = Date.now() * 0.001;
  pinkL.intensity = 1.5 + Math.sin(t * 1.3) * 0.6;
  tealL.intensity = 1.5 + Math.sin(t * 0.9 + 1) * 0.6;

  if (state !== 'playing') { renderer.render(scene, camera); return; }

  frame++;
  speed = Math.min(0.38, 0.12 + frame / 7000);
  score = Math.floor(frame * speed * 8);
  scoreEl.textContent = score;

  if (leanCd  > 0) leanCd--;
  if (jumpCd  > 0) jumpCd--;
  if (slideCd > 0) slideCd--;

  // player lateral
  player.position.x += (PL.targetX - player.position.x) * 0.16;

  // jump
  if (PL.jumping) {
    PL.jumpY  += PL.jumpVel;
    PL.jumpVel -= 0.013;
    if (PL.jumpY <= 0) { PL.jumpY = 0; PL.jumping = false; }
  }
  player.position.y = PL.jumpY;

  // slide
  if (PL.sliding) {
    PL.slideTimer--;
    body.scale.y = 0.42; body.position.y = 0.75;
    head.visible = cap.visible = false;
    legL.position.y = legR.position.y = 0.22;
    if (PL.slideTimer <= 0) PL.sliding = false;
  } else {
    body.scale.y = 1; body.position.y = 1.35;
    head.visible = cap.visible = true;
    legL.position.y = legR.position.y = 0.45;
  }

  // run animation
  PL.runT += 0.2;
  legL.rotation.x =  Math.sin(PL.runT) * 0.55;
  legR.rotation.x = -Math.sin(PL.runT) * 0.55;

  // spawn
  const spawnInt = Math.max(55, 140 - Math.floor(speed * 180));
  if (++spawnT >= spawnInt) { spawnObstacle(); spawnT = 0; }
  if (++coinT  >= 90)       { spawnCoins();   coinT  = 0; }

  // obstacles
  obstacles = obstacles.filter(o => {
    o.mesh.position.z += speed;
    o.mesh.material.emissiveIntensity = 0.15 + Math.sin(t * 5) * 0.1;

    if (o.mesh.position.z > -1 && o.mesh.position.z < 3) {
      const px = player.position.x;
      if (Math.abs(px - LANE_X[o.lane]) < 0.85) {
        if (o.type === 'barrier' && PL.jumpY < 0.9) {
          burst(player.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xff3434, 16);
          endGame();
        } else if (o.type === 'hang' && !PL.sliding) {
          burst(player.position.clone().add(new THREE.Vector3(0, 2, 0)), 0x4ecdc4, 16);
          endGame();
        }
      }
    }
    if (o.mesh.position.z > 12) { scene.remove(o.mesh); return false; }
    return true;
  });

  // coins
  coins = coins.filter(c => {
    c.mesh.position.z += speed;
    c.mesh.rotation.y += 0.07;
    if (!c.collected && c.mesh.position.z > -1 && c.mesh.position.z < 3) {
      if (Math.abs(player.position.x - LANE_X[c.lane]) < 0.85) {
        c.collected = true;
        score += 10;
        burst(c.mesh.position.clone(), 0xffd700, 8);
        scene.remove(c.mesh);
        return false;
      }
    }
    if (c.mesh.position.z > 12) { scene.remove(c.mesh); return false; }
    return true;
  });

  // sparks
  sparks = sparks.filter(s => {
    s.m.position.add(s.v);
    s.v.y -= 0.006;
    s.life--;
    s.m.material.opacity = s.life / 35;
    if (s.life <= 0) { scene.remove(s.m); return false; }
    return true;
  });

  renderer.render(scene, camera);
}

loop();
