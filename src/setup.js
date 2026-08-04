const cards = Array.from(document.querySelectorAll('.pet-card'));
const nameInput = document.getElementById('pet-name-input');
const preview = document.getElementById('preview');
const confirmBtn = document.getElementById('confirm');

let selectedPet = null;
// Once the user edits the name themselves we stop overwriting it with
// suggestions when they switch pets.
let nameTouched = false;

function emojiFor(pet) {
  const card = cards.find((c) => c.dataset.pet === pet);
  return card ? card.querySelector('.pet-emoji').textContent : '';
}

function petName() {
  return nameInput.value.trim();
}

function refresh() {
  const name = petName();
  const ready = Boolean(selectedPet) && name.length > 0;
  confirmBtn.disabled = !ready;

  if (!selectedPet) {
    preview.textContent = 'Pick a pet to get started.';
  } else if (!name) {
    preview.textContent = 'Now give them a name.';
  } else {
    preview.textContent = `${emojiFor(selectedPet)} ${name} will float on your desktop.`;
  }
}

function selectPet(pet) {
  selectedPet = pet;
  cards.forEach((card) => {
    card.setAttribute('aria-checked', String(card.dataset.pet === pet));
  });

  // Offer a friendly default so the user can just hit the button.
  if (!nameTouched) {
    const card = cards.find((c) => c.dataset.pet === pet);
    nameInput.value = card.dataset.suggestion;
  }
  refresh();
}

cards.forEach((card) => {
  card.addEventListener('click', () => selectPet(card.dataset.pet));
});

nameInput.addEventListener('input', () => {
  nameTouched = true;
  refresh();
});

nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !confirmBtn.disabled) submit();
});

confirmBtn.addEventListener('click', submit);

function submit() {
  if (!selectedPet || !petName()) return;
  window.setupAPI.saveSetup(selectedPet, petName());
}

// Re-opening from the tray should show the current pet and name, not a blank form.
async function init() {
  try {
    const { pet, name } = await window.setupAPI.getState();
    if (name) {
      nameInput.value = name;
      nameTouched = true;
    }
    if (pet) selectPet(pet);
  } catch (err) {
    // Reading saved state is only a convenience — the form still works empty.
    console.error('Could not load saved pet:', err);
  }
  refresh();
  nameInput.focus();
}

init();
