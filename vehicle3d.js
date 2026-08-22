// Barona Mobile Detailing — vehicle-type 3D preview
// Purely a fun, optional touch on the booking form, folded right into the
// "Vehicle (year/make/model)" field: as soon as someone types their vehicle
// in, we guess the body style from keywords (F-150 → truck, Explorer → SUV,
// etc., defaulting to sedan) and pop up a small rotating low-poly model with
// a gold "just detailed" shine light sweeping across it. The pills underneath
// are only there to correct a wrong guess — nothing here is required data
// for the booking itself.
//
// Three.js loads lazily (as an ES module, dynamically imported) only once
// someone actually has a model to show, so nobody pays for this on page
// load if they never touch the vehicle field. If it fails to load for any
// reason (slow connection, ad blocker, older browser), the booking form
// still works fine without it — this never blocks or breaks the actual
// booking.

(function () {
  const picker = document.getElementById('vehicle3dPicker');
  const wrap = document.getElementById('vehicle3dWrap');
  const canvas = document.getElementById('vehicle3dCanvas');
  const hint = document.getElementById('vehicle3dHint');
  const caption = document.getElementById('vehicle3dCaption');
  const vehicleInput = document.getElementById('vehicleInput');
  if (!picker || !wrap || !canvas || !hint) return;

  const THREE_MODULE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.185.1/three.module.min.js';

  // Cheap keyword guesser so the 3D preview can pick itself as soon as
  // someone types their vehicle in, instead of making them tap a button.
  // The pills stay on-screen so a wrong guess (or a model we don't
  // recognize) can be corrected in one tap.
  const TYPE_KEYWORDS = {
    truck: ['f-150', 'f150', 'f-250', 'f250', 'f-350', 'f350', 'silverado', 'sierra', 'ram 1500', 'ram 2500', 'ram 3500', 'ram1500', 'tacoma', 'tundra', 'ranger', 'colorado', 'ridgeline', 'frontier', 'titan', 'gladiator', ' pickup', 'pickup truck'],
    suv: ['explorer', 'tahoe', 'suburban', 'expedition', 'yukon', 'escalade', 'highlander', '4runner', 'pilot', 'cr-v', 'crv', 'rav4', 'rav-4', 'wrangler', 'grand cherokee', 'cherokee', 'durango', 'pathfinder', 'telluride', 'palisade', 'santa fe', 'tucson', 'forester', 'outback', 'xc90', 'xc60', 'bronco', 'blazer', 'equinox', 'traverse', 'atlas', 'tiguan', 'suv', 'cx-5', 'cx-9', 'rogue', 'murano', 'ascent'],
    van: ['sprinter', 'transit', 'odyssey', 'sienna', 'pacifica', 'express van', 'savana', 'promaster', 'caravan', 'minivan', ' van'],
    coupe: ['mustang', 'camaro', 'corvette', 'challenger', 'brz', ' 86', 'gt86', 'miata', 'mx-5', 'supra', '911', 'coupe'],
  };

  function detectVehicleType(text) {
    const t = ' ' + text.toLowerCase() + ' ';
    for (const type of Object.keys(TYPE_KEYWORDS)) {
      if (TYPE_KEYWORDS[type].some((kw) => t.includes(kw))) return type;
    }
    return null;
  }

  const VEHICLE_TYPES = {
    sedan: {
      body: { w: 1.9, h: 0.55, l: 4.4, y: 0.55 },
      cabin: { w: 1.7, h: 0.5, l: 2.0, y: 0.95, z: -0.1 },
      wheelR: 0.35,
      wheelZ: [-1.55, 1.55],
    },
    suv: {
      body: { w: 2.0, h: 0.75, l: 4.5, y: 0.75 },
      cabin: { w: 1.85, h: 0.75, l: 3.0, y: 1.35, z: -0.2 },
      wheelR: 0.42,
      wheelZ: [-1.6, 1.6],
    },
    truck: {
      body: { w: 2.0, h: 0.6, l: 5.2, y: 0.6 },
      cabin: { w: 1.85, h: 0.75, l: 1.8, y: 1.25, z: -1.5 },
      bed: { w: 1.9, h: 0.3, l: 2.6, y: 1.0, z: 1.1 },
      wheelR: 0.42,
      wheelZ: [-1.8, 1.8],
    },
    van: {
      body: { w: 2.0, h: 0.55, l: 4.6, y: 0.55 },
      cabin: { w: 1.9, h: 1.05, l: 4.0, y: 1.35, z: 0.1 },
      wheelR: 0.4,
      wheelZ: [-1.6, 1.6],
    },
    coupe: {
      body: { w: 1.85, h: 0.5, l: 4.3, y: 0.5 },
      cabin: { w: 1.6, h: 0.4, l: 1.6, y: 0.82, z: -0.35 },
      wheelR: 0.36,
      wheelZ: [-1.5, 1.5],
    },
  };

  let T = null;
  let threeLoadPromise = null;
  let scene, camera, renderer;
  let currentCar = null;
  let initialized = false;
  let animId = null;

  function loadThree() {
    if (threeLoadPromise) return threeLoadPromise;
    threeLoadPromise = import(THREE_MODULE_URL);
    return threeLoadPromise;
  }

  function disposeGroup(group) {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  function buildCar(typeKey) {
    const cfg = VEHICLE_TYPES[typeKey] || VEHICLE_TYPES.sedan;
    const group = new T.Group();

    const bodyMat = new T.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.55, roughness: 0.28 });
    const glassMat = new T.MeshStandardMaterial({ color: 0x0d1a22, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.85 });
    const wheelMat = new T.MeshStandardMaterial({ color: 0x111111, metalness: 0.2, roughness: 0.8 });
    const trimMat = new T.MeshStandardMaterial({ color: 0xc9a24c, metalness: 0.9, roughness: 0.25 });

    const body = new T.Mesh(new T.BoxGeometry(cfg.body.w, cfg.body.h, cfg.body.l), bodyMat);
    body.position.y = cfg.body.y;
    group.add(body);

    const cabin = new T.Mesh(new T.BoxGeometry(cfg.cabin.w, cfg.cabin.h, cfg.cabin.l), glassMat);
    cabin.position.set(0, cfg.cabin.y, cfg.cabin.z || 0);
    group.add(cabin);

    if (cfg.bed) {
      const bed = new T.Mesh(new T.BoxGeometry(cfg.bed.w, cfg.bed.h, cfg.bed.l), bodyMat);
      bed.position.set(0, cfg.bed.y, cfg.bed.z);
      group.add(bed);
    }

    // Thin gold trim line — a little brand touch, and it's what catches the
    // rim light as the car turns (the "just detailed" shine).
    const trim = new T.Mesh(new T.BoxGeometry(cfg.body.w + 0.02, 0.04, cfg.body.l - 0.2), trimMat);
    trim.position.y = cfg.body.y + cfg.body.h / 2 - 0.02;
    group.add(trim);

    const halfW = cfg.body.w / 2 - 0.05;
    cfg.wheelZ.forEach((z) => {
      [-1, 1].forEach((side) => {
        const wheel = new T.Mesh(new T.CylinderGeometry(cfg.wheelR, cfg.wheelR, 0.32, 20), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * halfW, cfg.wheelR, z);
        group.add(wheel);
      });
    });

    return group;
  }

  function initScene() {
    scene = new T.Scene();

    const width = canvas.clientWidth || 300;
    const height = canvas.clientHeight || 188;
    camera = new T.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(5.5, 2.6, 6.5);
    camera.lookAt(0, 0.6, 0);

    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);

    scene.add(new T.HemisphereLight(0xfff6df, 0x0a0a0a, 0.65));
    const key = new T.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 6, 4);
    scene.add(key);
    const rim = new T.DirectionalLight(0xc9a24c, 0.55); // gold rim light
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    const ground = new T.Mesh(
      new T.CircleGeometry(3.2, 32),
      new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.001;
    scene.add(ground);

    window.addEventListener('resize', handleResize);
  }

  function handleResize() {
    if (!renderer || !canvas.clientWidth || !canvas.clientHeight) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function animate() {
    animId = requestAnimationFrame(animate);
    if (currentCar) currentCar.rotation.y += 0.008;
    renderer.render(scene, camera);
  }

  function setCar(typeKey) {
    if (currentCar) {
      scene.remove(currentCar);
      disposeGroup(currentCar);
    }
    currentCar = buildCar(typeKey);
    scene.add(currentCar);
  }

  async function selectType(typeKey, btn) {
    picker.querySelectorAll('.vehicle-type-btn').forEach((b) => b.classList.remove('is-active'));
    if (!btn) btn = picker.querySelector(`[data-vehicle-type="${typeKey}"]`);
    if (btn) btn.classList.add('is-active');
    wrap.hidden = false;
    if (caption) caption.hidden = false;

    if (!initialized) {
      hint.hidden = false;
      hint.textContent = 'Loading 3D preview…';
      try {
        const mod = await loadThree();
        T = mod;
      } catch (err) {
        hint.textContent = "Couldn't load the 3D preview right now — no worries, your booking still works fine without it.";
        return;
      }
      try {
        initScene();
      } catch (err) {
        hint.textContent = "Your browser can't render the 3D preview, but the booking form still works fine.";
        return;
      }
      initialized = true;
      animate();
    }

    hint.hidden = true;
    setCar(typeKey);
  }

  function clearPreview() {
    picker.querySelectorAll('.vehicle-type-btn').forEach((b) => b.classList.remove('is-active'));
    wrap.hidden = true;
    if (caption) caption.hidden = true;
  }

  // Manual pills always win — a tap here means "no, I know better than the
  // guess," and typing more afterward shouldn't fight the user about it.
  let manualOverride = false;
  picker.querySelectorAll('.vehicle-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      manualOverride = true;
      selectType(btn.dataset.vehicleType, btn);
    });
  });

  // Auto-detect from the vehicle text field so the 3D model just appears as
  // people type — no extra tap needed unless the guess is wrong.
  if (vehicleInput) {
    let debounceId = null;
    vehicleInput.addEventListener('input', () => {
      if (manualOverride) return;
      const raw = vehicleInput.value.trim();
      window.clearTimeout(debounceId);
      if (!raw) {
        clearPreview();
        return;
      }
      if (raw.length < 3) return;
      debounceId = window.setTimeout(() => {
        const type = detectVehicleType(raw) || 'sedan';
        selectType(type, null);
      }, 350);
    });
  }
})();
