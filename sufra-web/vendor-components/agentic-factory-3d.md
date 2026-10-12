# agentic-factory-3d.tsx (owner's paste) — spec for the Sufra rebuild

Original: "Agentic Factory — Interactive 3D Machine" (three.js, procedural, no models/images), built by Codex, ported
to React. Live demo https://agentic-factory-3d.vercel.app, template https://github.com/eugeneshilow/agentic-3d-templates
(clone that repo to get the exact source if needed). Deps: three (OrbitControls, RoundedBoxGeometry, mergeGeometries,
RoomEnvironment).

Planned Sufra use: hero of the restaurant marketing page "How Sufra runs your restaurant", re-themed:
stations = Guest order (QR/app) → Kitchen screen → Cashier/POS → Delivery → Payment & e-receipt (ETA), and the
painted canvas screens re-written in Arabic (orders queue, kitchen tickets, receipt with VAT 14% + QR, "+185 ج.م").

What the original does (keep):
- Props: height (default 100vh), className, embed (hero mode: panels hidden; on frames > 900px the machine moves
  into the right 58% via camera.setViewOffset(-width*0.21) leaving room for a headline; wheel/touch scroll the page),
  onStation(id), onReady().
- Waits for document.fonts.ready before painting canvas textures; returns a dispose() that frees all geometry,
  materials, textures, env map, renderer and listeners.
- Scene: ACES tone mapping, exposure 1.12, PCF shadows, RoomEnvironment PMREM (intensity .62), hemisphere + key
  (shadow 2048) + rim + warm point + front lights; transparent clear colour. Materials: dark steel body, chrome,
  amber emissive light strips (#ff7a1a → use Sufra brass), ivory, copper.
- A chamfered layered metal plate with captive screws, rubber feet, an engraved nameplate canvas texture, faint
  drafting ellipses on the floor; contact shadow plane.
- Five stations on pads with glow strips, internal gears, vents, tubes, plaques ("01 ENGINE" ...). Each station has its
  own animated mechanism (printhead + film reels + a vertical video screen; console with a queue screen and toggles;
  a storefront monitor; a cabinet with an orders screen and an incoming name card; a cash desk with keypad, payment
  screen, printing receipt and a falling coin).
- A closed CatmullRom conveyor with 148 instanced treads, chrome rails and posts; copper pipes between stations;
  six "packets" ride the belt and change face (order → script → video → post → receipt) at each station.
- Static meshes merged per material (compact()) for few draw calls; moving parts flagged userData.moving.
- Modes: Assembled, Cutaway (a clipping plane lowers to 0.99 to reveal internals), Stations (exploded, labels projected
  to DOM), One order (follows packet 0 with a journey bar). Cameras: Overview, Side, Top, Station (focus clicked station),
  Flight (slow orbit). Auto-rotate after 6.5s idle. Hover tooltip + click to focus via raycaster.
- Adaptive pixel ratio when FPS < 43; IntersectionObserver + visibility pause; WebGL context loss handling; window.__machine
  API (setMode, setCamera, focusStation, play, pause).
- Styling: dark (#000), amber accent, small uppercase letter-spaced labels, glass panels with backdrop blur, responsive
  rules for ≤900px, ≤360px, short heights, reduced motion.
