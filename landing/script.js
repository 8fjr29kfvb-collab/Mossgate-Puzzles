const rows = ['FOREST', 'MOSSAL', 'GATEIF', 'FOXBOE', 'CLANMR', 'BIRDSN'];
const targets = { FOREST: [0, 5], MOSS: [6, 9], GATE: [12, 15], FOX: [18, 20], FERN: [17, 35] };
let start = null;
const found = new Set();
const grid = document.querySelector('#grid');
const status = document.querySelector('#status');

rows.join('').split('').forEach((letter, i) => {
  const button = document.createElement('button');
  button.textContent = letter;
  button.setAttribute('aria-label', `${letter}, row ${Math.floor(i / 6) + 1}, column ${(i % 6) + 1}`);
  button.onclick = () => choose(i);
  grid.append(button);
});

function choose(i) {
  if (start === null) {
    start = i;
    grid.children[i].classList.add('selected');
    status.textContent = 'Now choose the last letter.';
    return;
  }
  const word = Object.keys(targets).find((name) => {
    const [a, b] = targets[name];
    return (a === start && b === i) || (b === start && a === i);
  });
  grid.children[start].classList.remove('selected');
  if (word) {
    found.add(word);
    const [a, b] = targets[word];
    const step = Math.floor(a / 6) === Math.floor(b / 6) ? 1 : 6;
    for (let k = a; k <= b; k += step) grid.children[k].classList.add('found');
    document.querySelector(`[data-word="${word}"]`).classList.add('found');
    status.textContent = found.size === 5
      ? 'You found all five! A lovely little discovery.'
      : `${word} found! ${found.size} of 5 discovered.`;
  } else {
    status.textContent = 'No hidden word there. Choose a new starting letter.';
  }
  start = null;
}

document.querySelector('#reset').onclick = () => {
  start = null;
  found.clear();
  document.querySelectorAll('.found,.selected').forEach((element) => {
    element.classList.remove('found', 'selected');
  });
  status.textContent = 'Choose a starting letter.';
};
