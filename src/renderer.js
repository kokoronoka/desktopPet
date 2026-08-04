const PET_EMOJI = {
  cat: '🐱',
  dog: '🐶',
  bunny: '🐰'
};

const DRAG_THRESHOLD = 4;   // px of movement before a press counts as a drag
const NAMETAG_MS = 2600;    // how long the nametag lingers after an interaction

const petEl = document.getElementById('pet');
const spriteEl = document.getElementById('pet-sprite');
const nametagEl = document.getElementById('nametag');

let currentPet = null;
let petName = '';
let isDragging = false;
let dragMoved = false;
let lastMouse = { x: 0, y: 0 };
let walkTimer = null;
let nametagTimer = null;

// ---------- Sprite state ----------
// Exactly one state class at a time, so animations never stack.
function setSpriteState(state) {
  spriteEl.classList.remove('idle', 'walking', 'happy', 'dragging');
  if (state) spriteEl.classList.add(state);
}

// ---------- Nametag ----------
function showNametag({ sticky = false } = {}) {
  if (!petName) return;
  clearTimeout(nametagTimer);
  nametagEl.classList.add('visible');
  if (!sticky) nametagTimer = setTimeout(hideNametag, NAMETAG_MS);
}

function hideNametag() {
  clearTimeout(nametagTimer);
  nametagEl.classList.remove('visible');
}

// Hovering the pet reveals the name; it fades again once the cursor leaves.
petEl.addEventListener('pointerenter', () => showNametag({ sticky: true }));
petEl.addEventListener('pointerleave', () => {
  if (!isDragging) showNametag(); // fade out shortly after
});

// ---------- Applying the chosen pet ----------
function applyPet({ pet, name }) {
  currentPet = pet;
  petName = name || '';
  spriteEl.textContent = PET_EMOJI[pet] || PET_EMOJI.cat;
  nametagEl.textContent = petName;
  setSpriteState('idle');
  showNametag(); // brief hello so you can see who just arrived
  scheduleRandomWalk();
}

async function init() {
  const state = await window.petAPI.getState();
  if (state.pet) applyPet(state);
}

// Sent when the setup page saves a new pet or name.
window.petAPI.onPetUpdated(applyPet);

// ---------- Click-through: only capture the mouse over visible elements ----------
document.addEventListener('mousemove', (event) => {
  // While dragging we must keep receiving events even if the cursor slips off
  // the pet, so don't hand the mouse back to the desktop mid-drag.
  if (isDragging) return;

  const hovered = document.elementFromPoint(event.clientX, event.clientY);
  const overPet = hovered && hovered.closest('.pet');
  window.petAPI.setIgnoreMouseEvents(!overPet, { forward: true });
});

// ---------- Drag to move the pet around the screen ----------
petEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  isDragging = true;
  dragMoved = false;
  lastMouse = { x: event.screenX, y: event.screenY };
  // Pointer capture keeps events coming even when the window can't quite keep
  // up with a fast drag.
  petEl.setPointerCapture(event.pointerId);
  clearTimeout(walkTimer);
  window.petAPI.stopWalk();
});

petEl.addEventListener('pointermove', (event) => {
  if (!isDragging) return;

  const deltaX = event.screenX - lastMouse.x;
  const deltaY = event.screenY - lastMouse.y;
  if (deltaX === 0 && deltaY === 0) return;

  if (!dragMoved && Math.abs(deltaX) + Math.abs(deltaY) >= DRAG_THRESHOLD) {
    dragMoved = true;
    setSpriteState('dragging');
    hideNametag(); // gets in the way while the pet is being carried
  }

  lastMouse = { x: event.screenX, y: event.screenY };
  window.petAPI.moveWindow(deltaX, deltaY);
});

function endDrag(event) {
  if (!isDragging) return;
  isDragging = false;
  if (petEl.hasPointerCapture(event.pointerId)) {
    petEl.releasePointerCapture(event.pointerId);
  }

  if (dragMoved) {
    setSpriteState('idle');
  } else {
    reactToPet(); // a press that never moved is a pet, not a drag
  }
  scheduleRandomWalk();
}

petEl.addEventListener('pointerup', endDrag);
petEl.addEventListener('pointercancel', endDrag);

// ---------- Click (without drag) = pet interaction ----------
function reactToPet() {
  setSpriteState('happy');
  showNametag();
  spriteEl.addEventListener(
    'animationend',
    () => {
      // Don't stomp on a state the pet has moved into since the bounce started.
      if (spriteEl.classList.contains('happy')) setSpriteState('idle');
    },
    { once: true }
  );
}

// ---------- Occasional autonomous walk ----------
window.petAPI.onWalkDirection((direction) => {
  petEl.style.setProperty('--facing', direction === -1 ? '-1' : '1');
});

function scheduleRandomWalk() {
  clearTimeout(walkTimer);
  const delay = 8000 + Math.random() * 12000; // every 8-20s

  walkTimer = setTimeout(async () => {
    if (!currentPet || isDragging) {
      scheduleRandomWalk();
      return;
    }

    setSpriteState('walking');
    try {
      // Resolves once the main process has finished moving the window; null
      // means it declined (e.g. hidden, or already up against the screen edge).
      const direction = await window.petAPI.walk(120 + Math.random() * 160);
      if (direction === null) petEl.style.setProperty('--facing', '1');
    } catch (err) {
      // A failed walk must never end the loop — without this, one rejected
      // call would leave the pet stuck mid-stride for the rest of the session.
      console.error('Walk failed:', err);
    }
    if (!isDragging) setSpriteState('idle');
    scheduleRandomWalk();
  }, delay);
}

init();
