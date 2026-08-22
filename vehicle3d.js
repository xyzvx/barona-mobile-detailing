// Barona Mobile Detailing — vehicle-type 3D preview
// Purely a fun, optional touch on the booking form, folded right into the
// "Vehicle (year/make/model)" field: as soon as someone types their vehicle
// in, we guess the body style from keywords (F-150 → truck, Explorer → SUV,
// etc., defaulting to sedan) and pop up a small rotating model with a gold
// "just detailed" shine light sweeping across it. The pills underneath are
// only there to correct a wrong guess — nothing here is required data for
// the booking itself.
//
// All 5 types are real licensed vehicle models (Ram, 1990 Mercedes 190E
// Evo II, Lamborghini Countach, Rezvani Vengeance, Mercedes Sprinter —
// bought with commercial-use rights), each cut down from its original
// studio/showroom-detail source file for a lazy-loaded web widget instead
// of a close-up render — except the Countach, which ships at its full,
// undecimated 206k-triangle topology (see the coupe note below for why).
// Every real model also gets a "fresh out of the detail bay" clearcoat
// finish pass on load (applyLuxuryFinish, below), and the sedan gets an
// actual paint color since its own source texture didn't bake one in.
// All of it is stored locally in
// /models so there's no dependency on a third-party asset host staying up.
// If a model fails to load for any reason, we fall back to a simple
// built-from-code shape (buildProceduralCar below) rather than showing
// nothing — and if three.js itself can't load at all (slow connection, ad
// blocker, older browser), the booking form still works fine without any
// preview. This never blocks or breaks the actual booking.
//
// Three.js and the GLTF loader load lazily (as ES modules, dynamically
// imported) only once someone actually has a model to show, so nobody pays
// for this on page load if they never touch the vehicle field.

(function () {
  const picker = document.getElementById('vehicle3dPicker');
  const wrap = document.getElementById('vehicle3dWrap');
  const canvas = document.getElementById('vehicle3dCanvas');
  const hint = document.getElementById('vehicle3dHint');
  const vehicleInput = document.getElementById('vehicleInput');
  if (!picker || !wrap || !canvas || !hint) return;

  // "three" is resolved via the <script type="importmap"> in index.html, so
  // this and the GLTF loader below share one engine instance instead of
  // loading two separate copies of three.js.
  const GLTF_LOADER_URL = 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/GLTFLoader.js';

  // Real modeled car shapes (see file header) — one per pill. Kenney's kit
  // doesn't have a true "coupe," so that pill uses their sporty hatchback,
  // which is the closest generic low/sporty shape in the free set.
  const MODEL_URL = {
    sedan: 'models/car-sedan.glb',
    suv: 'models/car-suv.glb',
    truck: 'models/car-truck.glb',
    van: 'models/car-van.glb',
    coupe: 'models/car-coupe.glb',
  };
  // Each real model came from a different source (studio CG file, a raw
  // photo scan, a Roblox export, a 3ds Max export) with its own local
  // scale, orientation, and resting height, so — unlike the uniform Kenney
  // kit these all replaced — each type needs its own scale/rotation/lift
  // figured out by hand from that file's actual geometry:
  //  - sedan (Benz 190E): already Y-up/Z-forward with wheel-bottom ~y=0,
  //    close to real-world meters, so barely any correction needed.
  //  - coupe (Countach): same Y-up/Z-forward convention, but centered on
  //    its body rather than resting on the ground, so it needs lifting.
  //    Its earlier sparkly/faceted "shattered glass" look turned out to
  //    have nothing to do with polycount — the source file's own material
  //    JSON had `alphaMode: "BLEND"` set on ~40 materials including the
  //    body paint itself (a sloppy setting in this "reworked" file, not an
  //    intentional design choice — a solid painted body has no business
  //    being alpha-blended). With blending on, three.js can't reliably
  //    depth-sort this model's 100+ overlapping mesh parts, so faces
  //    blend/flicker through each other. Fixed by forcing every non-glass
  //    material back to opaque and shipping the model at its full,
  //    undecimated topology (206k triangles — no more grid-decimation
  //    facets to worry about either).
  //  - truck (Ram): a raw single-session photogrammetry scan (single
  //    394k-triangle mesh) rather than a clean CG model — its texture atlas
  //    turned out to be thousands of tiny disconnected photo-fragment
  //    islands (that's just how photo scans get UV-unwrapped), which is
  //    fundamentally incompatible with cutting the mesh down the normal
  //    way: any decimation joins triangles whose UVs land in unrelated
  //    atlas islands, and the GPU smears/streaks between them — that, not
  //    file size, was the real cause of the white/melted/speckled look
  //    that survived an earlier UV-averaging fix. Fixed properly by baking
  //    each kept vertex's true color straight off the original photo (at
  //    its own still-correct UV) into a vertex-color attribute and
  //    shipping a texture-less material — vertex-color interpolation is a
  //    plain RGB blend with no atlas to smear across, so it's correct at
  //    any polycount. Its long axis also came in as X instead of the Z
  //    everything else uses, so it's rotated 90° to match.
  //  - suv (Rezvani): a Roblox export, positioned far from its own origin
  //    and X-forward — recentered and rotated during conversion.
  //  - van (Sprinter): a 3ds Max export still in Max's native Z-up axis
  //    convention — converted to Y-up during conversion (a proper axis
  //    rotation, not a mirror, so it can't have flipped inside-out).
  // useRealMaterials means "trust this model's own real paint/texture,
  // don't override it" — true for all five now that every type is a real
  // licensed model; PAINT_COLOR below is just a dormant fallback in case a
  // future swap ever brings back an untextured placeholder shape.
  const MODEL_TRANSFORM = {
    sedan: { scale: 0.75, rotY: 0, lift: -0.01, useRealMaterials: true },
    coupe: { scale: 0.80, rotY: 0, lift: 0.25, useRealMaterials: true },
    truck: { scale: 3.46, rotY: Math.PI / 2, lift: 1.27, useRealMaterials: true },
    // Rezvani source file was a Roblox export (already re-centered and its
    // length axis rotated to match the others during conversion) — same
    // "best-effort, unverified in this dev environment" caveat as the truck.
    suv: { scale: 0.25, rotY: Math.PI / 2, lift: 0, useRealMaterials: true },
    // Sprinter source was a 3ds Max export still in Max's native Z-up axis
    // convention — already rotated to Y-up during conversion (a proper
    // rotation, not a mirror, so it can't have flipped the model inside
    // out), so no extra rotation needed here, just the scale down from
    // its native (probably cm-ish) units.
    van: { scale: 0.0093, rotY: 0, lift: 0, useRealMaterials: true },
  };
  // NOTE: positioning on the 3 new real models (especially the truck,
  // which is the least "clean" source file) is a best-effort estimate
  // computed from the raw files, not something we can see rendered in this
  // dev environment (no GPU here) — if it looks off-center/floating/rotated
  // wrong once live, these numbers are the first thing to nudge.

  // The Kenney pack's own texture file wasn't actually included (it points
  // at an external image that never shipped), so the still-untextured van
  // would render flat white with no way to tell it apart from the rest.
  // Painting it a distinct solid color is the stopgap until its real-model
  // replacement arrives — see useRealMaterials above.
  const PAINT_COLOR = {
    van: 0x3a3a42, // graphite
  };
  const WHEEL_COLOR = 0x161616;

  // "Fresh out of the detail bay" finish pass — run on every real model
  // after it loads. Only touches each vehicle's actual body-paint
  // material(s) by name (never glass/tires/interior/trim), giving it a
  // deeper, glossier clearcoat response so it reads as a just-detailed
  // showroom shine instead of flat matte plastic. The sedan's own factory
  // texture came in with no real paint color baked into it, so it also
  // gets an actual color here — a deep pearl sapphire, distinct from the
  // truck's black and the van's graphite.
  const PAINT_MATERIAL_NAMES = {
    sedan: ['Material'], // the "_ext" body panels: BODY/HOOD/DOOR/BUMPER/MIRROR
    coupe: ['vehicle_paint1'], // Countach's own body-paint material
    truck: ['truck-paint-vcolor'], // baked vertex-color body (see below)
    van: ['carpaint'],
    // suv intentionally left out — Rezvani's own baked paint already reads
    // well as-is, so it only gets the light global gloss bump further down.
  };
  const SEDAN_PAINT_COLOR = 0x0b2a52;

  function applyLuxuryFinish(car, typeKey) {
    const paintNames = PAINT_MATERIAL_NAMES[typeKey];
    const upgraded = new Map(); // original material uuid -> upgraded MeshPhysicalMaterial
    car.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const applyOne = (mat) => {
        if (!mat) return mat;
        const isPaint = paintNames && mat.name && paintNames.indexOf(mat.name) !== -1;
        if (!isPaint) {
          // Every other real-paint material still gets a very light sheen
          // bump so the whole car reads "freshly detailed," without
          // touching color or risking glass/tire/interior looking wrong.
          if (mat.isMeshStandardMaterial && mat.name && !/glass|tire|neumatico|rubber|interior|seat|cloth|window/i.test(mat.name)) {
            mat.envMapIntensity = Math.max(mat.envMapIntensity || 1, 1.15);
            mat.needsUpdate = true;
          }
          return mat;
        }
        let target = mat;
        if (!('clearcoat' in mat) && T.MeshPhysicalMaterial) {
          if (upgraded.has(mat.uuid)) {
            target = upgraded.get(mat.uuid);
          } else {
            target = new T.MeshPhysicalMaterial();
            target.copy(mat);
            upgraded.set(mat.uuid, target);
          }
        }
        target.metalness = typeKey === 'truck' ? 0.5 : 0.75;
        target.roughness = typeKey === 'truck' ? 0.28 : 0.16;
        target.clearcoat = 1.0;
        target.clearcoatRoughness = 0.08;
        target.envMapIntensity = 1.5;
        if (typeKey === 'sedan' && target.color) target.color.setHex(SEDAN_PAINT_COLOR);
        target.needsUpdate = true;
        return target;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(applyOne) : applyOne(obj.material);
    });
  }

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

  // Each body style is defined as two "lofts": a row of control points
  // (t = 0 front bumper → 1 rear bumper, w/h = actual width/height in scene
  // units at that point along the car) for the painted body, and a second
  // set for the glass greenhouse that sits on top of it. buildLoftGroup()
  // below samples these at fine steps and stitches together many thin
  // slices, which is what turns two flat boxes into an actual rounded
  // hood-cowl-roof-decklid silhouette instead of a couple of Minecraft
  // blocks stacked on each other.
  const PROFILE = {
    sedan: {
      length: 4.5, wheelR: 0.34, tireW: 0.30, wheelZFrac: [0.15, 0.87], mirrorT: 0.34,
      body: [
        { t: 0.00, w: 0.75, h: 0.18 }, { t: 0.05, w: 1.55, h: 0.22 },
        { t: 0.13, w: 1.85, h: 0.38 }, { t: 0.24, w: 1.78, h: 0.46 },
        { t: 0.34, w: 1.72, h: 0.55 }, { t: 0.50, w: 1.80, h: 0.58 },
        { t: 0.66, w: 1.72, h: 0.54 }, { t: 0.77, w: 1.65, h: 0.44 },
        { t: 0.87, w: 1.50, h: 0.30 }, { t: 0.94, w: 1.15, h: 0.22 },
        { t: 1.00, w: 0.70, h: 0.16 },
      ],
      greenhouse: [
        { t: 0.00, w: 0, h: 0 }, { t: 0.31, w: 0, h: 0 },
        { t: 0.36, w: 1.55, h: 0.35 }, { t: 0.44, w: 1.68, h: 0.58 },
        { t: 0.55, w: 1.72, h: 0.64 }, { t: 0.65, w: 1.62, h: 0.55 },
        { t: 0.74, w: 1.30, h: 0.28 }, { t: 0.80, w: 0, h: 0 },
        { t: 1.00, w: 0, h: 0 },
      ],
    },
    coupe: {
      length: 4.3, wheelR: 0.32, tireW: 0.30, wheelZFrac: [0.14, 0.86], mirrorT: 0.35, spoilerT: 0.80,
      body: [
        { t: 0.00, w: 0.70, h: 0.16 }, { t: 0.05, w: 1.50, h: 0.20 },
        { t: 0.12, w: 1.80, h: 0.34 }, { t: 0.22, w: 1.74, h: 0.42 },
        { t: 0.32, w: 1.68, h: 0.50 }, { t: 0.48, w: 1.75, h: 0.52 },
        { t: 0.62, w: 1.68, h: 0.48 }, { t: 0.74, w: 1.60, h: 0.38 },
        { t: 0.85, w: 1.45, h: 0.26 }, { t: 0.93, w: 1.10, h: 0.20 },
        { t: 1.00, w: 0.65, h: 0.14 },
      ],
      greenhouse: [
        { t: 0.00, w: 0, h: 0 }, { t: 0.33, w: 0, h: 0 },
        { t: 0.38, w: 1.45, h: 0.28 }, { t: 0.46, w: 1.60, h: 0.48 },
        { t: 0.55, w: 1.62, h: 0.53 }, { t: 0.64, w: 1.52, h: 0.44 },
        { t: 0.72, w: 1.20, h: 0.20 }, { t: 0.76, w: 0, h: 0 },
        { t: 1.00, w: 0, h: 0 },
      ],
    },
    suv: {
      length: 4.7, wheelR: 0.42, tireW: 0.40, wheelZFrac: [0.14, 0.90], mirrorT: 0.32,
      flareWheels: true, roofRailFrac: [0.32, 0.84],
      body: [
        { t: 0.00, w: 0.85, h: 0.30 }, { t: 0.05, w: 1.70, h: 0.36 },
        { t: 0.12, w: 2.00, h: 0.56 }, { t: 0.22, w: 1.95, h: 0.66 },
        { t: 0.32, w: 1.92, h: 0.76 }, { t: 0.50, w: 1.98, h: 0.78 },
        { t: 0.68, w: 1.92, h: 0.76 }, { t: 0.80, w: 1.88, h: 0.66 },
        { t: 0.89, w: 1.75, h: 0.48 }, { t: 0.95, w: 1.35, h: 0.34 },
        { t: 1.00, w: 0.80, h: 0.26 },
      ],
      greenhouse: [
        { t: 0.00, w: 0, h: 0 }, { t: 0.29, w: 0, h: 0 },
        { t: 0.34, w: 1.70, h: 0.40 }, { t: 0.42, w: 1.85, h: 0.72 },
        { t: 0.55, w: 1.88, h: 0.84 }, { t: 0.70, w: 1.85, h: 0.82 },
        { t: 0.80, w: 1.70, h: 0.66 }, { t: 0.86, w: 1.40, h: 0.30 },
        { t: 0.90, w: 0, h: 0 }, { t: 1.00, w: 0, h: 0 },
      ],
    },
    van: {
      length: 4.8, wheelR: 0.38, tireW: 0.32, wheelZFrac: [0.10, 0.92], mirrorT: 0.14,
      body: [
        { t: 0.00, w: 0.90, h: 0.24 }, { t: 0.04, w: 1.75, h: 0.28 },
        { t: 0.09, w: 2.00, h: 0.42 }, { t: 0.18, w: 1.98, h: 0.50 },
        { t: 0.30, w: 1.98, h: 0.55 }, { t: 0.55, w: 2.00, h: 0.55 },
        { t: 0.75, w: 1.96, h: 0.52 }, { t: 0.88, w: 1.85, h: 0.40 },
        { t: 0.95, w: 1.50, h: 0.28 }, { t: 1.00, w: 0.90, h: 0.22 },
      ],
      greenhouse: [
        { t: 0.00, w: 0, h: 0 }, { t: 0.09, w: 0, h: 0 },
        { t: 0.14, w: 1.85, h: 0.55 }, { t: 0.22, w: 1.95, h: 1.15 },
        { t: 0.40, w: 1.98, h: 1.30 }, { t: 0.65, w: 1.98, h: 1.30 },
        { t: 0.82, w: 1.92, h: 1.15 }, { t: 0.90, w: 1.60, h: 0.55 },
        { t: 0.94, w: 0, h: 0 }, { t: 1.00, w: 0, h: 0 },
      ],
    },
    truck: {
      length: 5.3, wheelR: 0.44, tireW: 0.42, wheelZFrac: [0.16, 0.86], mirrorT: 0.16,
      bed: { t: 0.70, len: 2.4 }, flareWheels: true, hoodScoopT: 0.24,
      body: [
        { t: 0.00, w: 0.85, h: 0.28 }, { t: 0.04, w: 1.70, h: 0.34 },
        { t: 0.10, w: 2.00, h: 0.52 }, { t: 0.18, w: 1.95, h: 0.60 },
        { t: 0.28, w: 1.92, h: 0.62 }, { t: 0.40, w: 1.95, h: 0.60 },
        { t: 0.44, w: 1.90, h: 0.52 }, { t: 0.50, w: 1.90, h: 0.50 },
        { t: 0.75, w: 1.88, h: 0.50 }, { t: 0.92, w: 1.85, h: 0.48 },
        { t: 0.97, w: 1.60, h: 0.40 }, { t: 1.00, w: 1.30, h: 0.34 },
      ],
      greenhouse: [
        { t: 0.00, w: 0, h: 0 }, { t: 0.13, w: 0, h: 0 },
        { t: 0.17, w: 1.75, h: 0.45 }, { t: 0.24, w: 1.88, h: 0.85 },
        { t: 0.32, w: 1.88, h: 0.93 }, { t: 0.38, w: 1.70, h: 0.55 },
        { t: 0.42, w: 0, h: 0 }, { t: 1.00, w: 0, h: 0 },
      ],
    },
  };

  // Piecewise-linear lookup along a profile's control points.
  function interp(points, t, key) {
    if (t <= points[0].t) return points[0][key];
    const last = points[points.length - 1];
    if (t >= last.t) return last[key];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        const u = span > 0 ? (t - a.t) / span : 0;
        return a[key] + (b[key] - a[key]) * u;
      }
    }
    return last[key];
  }

  // Samples a profile into many thin box slices and stitches them into one
  // group — a "loft" built from safe, well-understood primitives instead of
  // hand-rolled triangle geometry, so there's no risk of inverted normals or
  // holes. yBaseFn lets a second loft (the greenhouse) sit directly on top
  // of the first one's (the body's) surface at each point along the car.
  function buildLoftGroup(points, opts) {
    const { length, zStart, material, steps, yBaseFn } = opts;
    const group = new T.Group();
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const tm = (t0 + t1) / 2;
      const w = interp(points, tm, 'w');
      const h = interp(points, tm, 'h');
      if (w < 0.02 || h < 0.02) continue; // skip near-zero taper slivers
      const z0 = zStart + t0 * length;
      const z1 = zStart + t1 * length;
      const segLen = (z1 - z0) + 0.015; // tiny overlap so slices don't gap
      const yBase = yBaseFn ? yBaseFn(tm) : 0;
      const box = new T.Mesh(new T.BoxGeometry(w, h, segLen), material);
      box.position.set(0, yBase + h / 2, (z0 + z1) / 2);
      group.add(box);
    }
    return group;
  }

  let T = null;
  let GLTFLoaderClass = null;
  let threeLoadPromise = null;
  let scene, camera, renderer;
  let currentCar = null;
  let initialized = false;
  let animId = null;
  const modelCache = {}; // typeKey -> loaded THREE.Group, reused (never disposed) once fetched

  // Loads three.js and the GLTF loader together. The loader is optional in
  // the sense that if it fails to load we still have three.js itself and
  // can fall back to the built-from-code shapes.
  function loadThree() {
    if (threeLoadPromise) return threeLoadPromise;
    threeLoadPromise = import('three').then(async (threeMod) => {
      T = threeMod;
      try {
        const loaderMod = await import(GLTF_LOADER_URL);
        GLTFLoaderClass = loaderMod.GLTFLoader;
      } catch (err) {
        GLTFLoaderClass = null; // real models unavailable — procedural fallback still works
      }
      return threeMod;
    });
    return threeLoadPromise;
  }

  function disposeGroup(group) {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  // Fetches (and caches) the real modeled car for a type. Never disposed
  // once loaded — these are small files and we only ever show one at a
  // time, so keeping all five in memory once visited is cheap and means
  // switching pills back and forth is instant after the first load.
  async function loadRealCar(typeKey) {
    if (modelCache[typeKey]) return modelCache[typeKey];
    if (!GLTFLoaderClass || !MODEL_URL[typeKey]) return null;
    const xform = MODEL_TRANSFORM[typeKey] || { scale: 1, rotY: 0, lift: 0, useRealMaterials: false };
    const loader = new GLTFLoaderClass();
    const gltf = await loader.loadAsync(MODEL_URL[typeKey]);
    const car = gltf.scene;
    car.scale.setScalar(xform.scale);
    car.rotation.y = xform.rotY;
    car.position.set(0, xform.lift, 0);

    if (!xform.useRealMaterials) {
      // Still-Kenney-kit types (suv/van, for now) have no real paint of
      // their own — paint them a flat color per type instead, same as
      // before, so they're at least visually distinct from each other.
      const bodyMat = new T.MeshStandardMaterial({
        color: PAINT_COLOR[typeKey] != null ? PAINT_COLOR[typeKey] : 0x2a2a2a,
        metalness: 0.5, roughness: 0.3, side: T.DoubleSide,
      });
      const wheelMat = new T.MeshStandardMaterial({ color: WHEEL_COLOR, metalness: 0.25, roughness: 0.75, side: T.DoubleSide });
      car.traverse((obj) => {
        if (!obj.material) return;
        obj.material = obj.name && obj.name.indexOf('wheel') !== -1 ? wheelMat : bodyMat;
      });
    }
    // Real licensed models (sedan/coupe/truck) keep whatever material the
    // file itself came with — that's the actual paint/texture we paid for,
    // no reason to paper over it with a flat color. On top of that, give
    // every real model its "fresh out of the detail bay" clearcoat finish
    // (and the sedan its actual paint color) — see applyLuxuryFinish above.
    // This is purely cosmetic polish on top of an already-successfully-
    // loaded model, so it must never be able to take the whole model down
    // with it — if anything in here throws, log it and keep the real,
    // unpolished model instead of falling all the way back to the boxy
    // procedural placeholder.
    if (xform.useRealMaterials) {
      try {
        applyLuxuryFinish(car, typeKey);
      } catch (err) {
        console.warn('[vehicle3d] luxury finish pass failed for', typeKey, err);
      }
    }

    modelCache[typeKey] = car;
    return car;
  }

  function buildProceduralCar(typeKey) {
    const cfg = PROFILE[typeKey] || PROFILE.sedan;
    const group = new T.Group();
    const zStart = -cfg.length / 2;

    const bodyMat = new T.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.55, roughness: 0.28 });
    const glassMat = new T.MeshStandardMaterial({ color: 0x0d1a22, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.82 });
    const tireMat = new T.MeshStandardMaterial({ color: 0x111111, metalness: 0.1, roughness: 0.9 });
    const hubMat = new T.MeshStandardMaterial({ color: 0xb9b9b9, metalness: 0.85, roughness: 0.3 });
    const trimMat = new T.MeshStandardMaterial({ color: 0xc9a24c, metalness: 0.9, roughness: 0.25 });
    const headlightMat = new T.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xfff2c8, emissiveIntensity: 0.5, roughness: 0.4 });
    const taillightMat = new T.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xaa1414, emissiveIntensity: 0.7, roughness: 0.4 });
    const bedLinerMat = new T.MeshStandardMaterial({ color: 0x161616, metalness: 0.2, roughness: 0.85 });

    // The painted body — a rounded hood-to-decklid silhouette lofted from
    // many thin slices instead of one flat box.
    group.add(buildLoftGroup(cfg.body, { length: cfg.length, zStart, material: bodyMat, steps: 30 }));

    // The glass greenhouse, sitting directly on the body's roofline with
    // its own sloped windshield/backlite taper.
    group.add(buildLoftGroup(cfg.greenhouse, {
      length: cfg.length, zStart, material: glassMat, steps: 26,
      yBaseFn: (t) => interp(cfg.body, t, 'h'),
    }));

    // Gold beltline trim — a brand touch, and what catches the rim light as
    // the car turns (the "just detailed" shine). The mid-body is close to
    // flat on every profile, so one straight strip reads fine here.
    const trimY = interp(cfg.body, 0.5, 'h');
    const trimW = interp(cfg.body, 0.5, 'w') + 0.03;
    const trim = new T.Mesh(new T.BoxGeometry(trimW, 0.03, cfg.length * 0.34), trimMat);
    trim.position.set(0, trimY, 0);
    group.add(trim);

    // Wheels — dark tire, a lighter hub cap, and 5 spokes for a real
    // wheel-and-rim look instead of a plain disc. Off-road-leaning types
    // (SUV/truck) also get a dark fender-flare lip wrapping the wheel arch.
    const tireW = cfg.tireW || 0.30;
    cfg.wheelZFrac.forEach((frac) => {
      const z = zStart + frac * cfg.length;
      const halfW = interp(cfg.body, frac, 'w') / 2 - 0.03;
      [-1, 1].forEach((side) => {
        const x = side * halfW;
        const tire = new T.Mesh(new T.CylinderGeometry(cfg.wheelR, cfg.wheelR, tireW, 18), tireMat);
        tire.rotation.z = Math.PI / 2;
        tire.position.set(x, cfg.wheelR, z);
        group.add(tire);
        const hub = new T.Mesh(new T.CylinderGeometry(cfg.wheelR * 0.42, cfg.wheelR * 0.42, tireW + 0.03, 14), hubMat);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(x, cfg.wheelR, z);
        group.add(hub);
        for (let i = 0; i < 5; i++) {
          const spoke = new T.Mesh(new T.BoxGeometry(tireW + 0.02, cfg.wheelR * 0.72, 0.045), hubMat);
          spoke.rotation.x = (i * Math.PI * 2) / 5;
          spoke.position.set(x, cfg.wheelR, z);
          group.add(spoke);
        }
        if (cfg.flareWheels) {
          const flare = new T.Mesh(new T.BoxGeometry(0.12, cfg.wheelR * 0.65, tireW + 0.32), bedLinerMat);
          flare.position.set(x + side * 0.06, cfg.wheelR * 1.05, z);
          group.add(flare);
        }
      });
    });

    // Headlights and taillights at the very front/rear tips.
    const frontT = 0.05, rearT = 0.95;
    [-1, 1].forEach((side) => {
      const fx = side * (interp(cfg.body, frontT, 'w') / 2 - 0.1);
      const fy = interp(cfg.body, frontT, 'h') * 0.6;
      const headlight = new T.Mesh(new T.BoxGeometry(0.12, 0.09, 0.05), headlightMat);
      headlight.position.set(fx, fy, zStart + frontT * cfg.length);
      group.add(headlight);

      const rx = side * (interp(cfg.body, rearT, 'w') / 2 - 0.1);
      const ry = interp(cfg.body, rearT, 'h') * 0.65;
      const taillight = new T.Mesh(new T.BoxGeometry(0.12, 0.1, 0.05), taillightMat);
      taillight.position.set(rx, ry, zStart + rearT * cfg.length);
      group.add(taillight);
    });

    // Side mirrors sprouting from the base of the windshield.
    const mirrorT = cfg.mirrorT;
    const mirrorHalfW = interp(cfg.body, mirrorT, 'w') / 2;
    const mirrorY = interp(cfg.body, mirrorT, 'h') + 0.14;
    [-1, 1].forEach((side) => {
      const mirror = new T.Mesh(new T.BoxGeometry(0.08, 0.06, 0.14), bodyMat);
      mirror.position.set(side * (mirrorHalfW + 0.06), mirrorY, zStart + mirrorT * cfg.length);
      group.add(mirror);
    });

    // Truck bed — a dark inset "liner" panel to fake an open cargo bed
    // instead of a solid block.
    if (cfg.bed) {
      const liner = new T.Mesh(
        new T.BoxGeometry(interp(cfg.body, cfg.bed.t, 'w') - 0.12, 0.03, cfg.bed.len),
        bedLinerMat
      );
      liner.position.set(0, interp(cfg.body, cfg.bed.t, 'h') - 0.02, zStart + cfg.bed.t * cfg.length);
      group.add(liner);
    }

    // Roof rails — a pair of thin bars along an SUV's roofline.
    if (cfg.roofRailFrac) {
      const [rt0, rt1] = cfg.roofRailFrac;
      const railZ0 = zStart + rt0 * cfg.length;
      const railZ1 = zStart + rt1 * cfg.length;
      const railLen = railZ1 - railZ0;
      const railY = interp(cfg.body, (rt0 + rt1) / 2, 'h') + interp(cfg.greenhouse, (rt0 + rt1) / 2, 'h') + 0.05;
      [-1, 1].forEach((side) => {
        const railX = side * (interp(cfg.greenhouse, (rt0 + rt1) / 2, 'w') / 2 - 0.08);
        const rail = new T.Mesh(new T.BoxGeometry(0.05, 0.045, railLen), bedLinerMat);
        rail.position.set(railX, railY, (railZ0 + railZ1) / 2);
        group.add(rail);
      });
    }

    // Rear spoiler — two struts and a wing over the decklid, coupe-only.
    if (cfg.spoilerT != null) {
      const spoilerZ = zStart + cfg.spoilerT * cfg.length;
      const baseY = interp(cfg.body, cfg.spoilerT, 'h');
      const wingY = baseY + 0.22;
      const spoilerHalfW = interp(cfg.body, cfg.spoilerT, 'w') / 2 - 0.12;
      [-1, 1].forEach((side) => {
        const strut = new T.Mesh(new T.BoxGeometry(0.05, 0.22, 0.06), bodyMat);
        strut.position.set(side * spoilerHalfW, baseY + 0.11, spoilerZ);
        group.add(strut);
      });
      const wing = new T.Mesh(new T.BoxGeometry(spoilerHalfW * 2 + 0.1, 0.04, 0.3), bodyMat);
      wing.position.set(0, wingY, spoilerZ);
      group.add(wing);
    }

    // Hood scoop — a raised, dark inset block on the hood, truck-only.
    if (cfg.hoodScoopT != null) {
      const scoopY = interp(cfg.body, cfg.hoodScoopT, 'h');
      const scoop = new T.Mesh(new T.BoxGeometry(0.55, 0.06, 0.5), bedLinerMat);
      scoop.position.set(0, scoopY + 0.03, zStart + cfg.hoodScoopT * cfg.length);
      group.add(scoop);
    }

    return group;
  }

  function initScene() {
    scene = new T.Scene();

    const width = canvas.clientWidth || 300;
    const height = canvas.clientHeight || 188;
    camera = new T.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(5.5, 2.6, 6.5);
    camera.lookAt(0, 0.75, 0);

    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    // Modern three.js uses physically-based light units, where the old
    // "1.0 is plenty bright" intensities read as almost pitch black — this
    // is what was making the car nearly disappear into the dark card
    // background. These values are tuned for a clearly-lit "showroom" look
    // against that dark backdrop instead.
    if (T.ACESFilmicToneMapping) renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    if (T.SRGBColorSpace) renderer.outputColorSpace = T.SRGBColorSpace;

    scene.add(new T.HemisphereLight(0xfff6df, 0x11151c, 2.4));
    const key = new T.DirectionalLight(0xffffff, 3.6);
    key.position.set(4, 6, 4);
    scene.add(key);
    const fill = new T.DirectionalLight(0xbfd4ff, 1.1); // cool fill so the shadow side isn't pure black
    fill.position.set(-5, 2, 5);
    scene.add(fill);
    const rim = new T.DirectionalLight(0xc9a24c, 2.6); // gold rim light — the "just detailed" shine
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

  function placeCar(carObject) {
    if (currentCar) {
      scene.remove(currentCar);
      if (currentCar.__procedural) disposeGroup(currentCar); // cached real models are kept, not disposed
    }
    currentCar = carObject;
    scene.add(currentCar);
  }

  // Tries the real modeled car first; if the loader isn't available or the
  // fetch fails (missing file, flaky connection), builds the simpler
  // shape-from-code version instead so there's always something to show.
  // myToken lets a rapid second pill-tap win instead of both this and a
  // newer call racing to place their result last.
  async function setCar(typeKey, myToken) {
    let car = null;
    try {
      car = await loadRealCar(typeKey);
    } catch (err) {
      console.warn('[vehicle3d] real model load failed for', typeKey, '— falling back to the procedural shape:', err);
      car = null; // fall through to the procedural shape below
    }
    if (myToken !== loadToken) return; // a newer pill was tapped meanwhile
    if (!car) {
      car = buildProceduralCar(typeKey);
      car.__procedural = true;
    }
    placeCar(car);
  }

  let loadToken = 0;
  async function selectType(typeKey, btn) {
    const myToken = ++loadToken;
    picker.querySelectorAll('.vehicle-type-btn').forEach((b) => b.classList.remove('is-active'));
    if (!btn) btn = picker.querySelector(`[data-vehicle-type="${typeKey}"]`);
    if (btn) btn.classList.add('is-active');
    wrap.hidden = false;

    if (!initialized) {
      hint.hidden = false;
      hint.textContent = 'Loading 3D preview…';
      try {
        await loadThree();
      } catch (err) {
        if (myToken === loadToken) hint.textContent = "Couldn't load the 3D preview right now — no worries, your booking still works fine without it.";
        return;
      }
      if (myToken !== loadToken) return; // a newer pill was tapped while three.js was loading
      try {
        initScene();
      } catch (err) {
        hint.textContent = "Your browser can't render the 3D preview, but the booking form still works fine.";
        return;
      }
      initialized = true;
      animate();
    }

    await setCar(typeKey, myToken);
    if (myToken !== loadToken) return; // a newer pill was tapped while this model was loading
    hint.hidden = true;
  }

  function clearPreview() {
    picker.querySelectorAll('.vehicle-type-btn').forEach((b) => b.classList.remove('is-active'));
    wrap.hidden = true;
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
