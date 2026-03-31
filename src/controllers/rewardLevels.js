// src/controllers/rewardLevels.js
const LEVELS = [
  { name: "Bronze", keep: 0,   next: 1000, bonusPct: 0.00 },
  { name: "Silver", keep: 500, next: 3000, bonusPct: 0.05 },
  { name: "Gold",   keep: 1500,next: 6000, bonusPct: 0.15 },
  { name: "Platinum", keep: 3000, next: 999999999, bonusPct: 0.25 },
];

function getLevelIndex(name) {
  return Math.max(0, LEVELS.findIndex((l) => l.name === name));
}
function getLevel(name) {
  return LEVELS[getLevelIndex(name)] || LEVELS[0];
}
function getNextLevel(name) {
  const i = getLevelIndex(name);
  return LEVELS[Math.min(i + 1, LEVELS.length - 1)];
}

module.exports = { LEVELS, getLevel, getNextLevel, getLevelIndex };