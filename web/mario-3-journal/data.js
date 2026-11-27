// Super Mario Bros. 3 course list. Not exhaustive (bonus rooms, Toad houses, etc. are not scored):
// use "Add custom" in the app for anything missing. Ids are stable; do not renumber them.
const worlds = [
  ['World 1: Grass Land', ['1-1', '1-2', '1-3', '1-4', '1-Fortress', '1-Airship']],
  ['World 2: Desert Land', ['2-1', '2-2', '2-Quicksand', '2-Fortress', '2-3', '2-Pyramid', '2-Airship']],
  ['World 3: Water Land', ['3-1', '3-2', '3-3', '3-4', '3-5', '3-6', '3-7', '3-8', '3-9', '3-Fortress 1', '3-Fortress 2', '3-Airship']],
  ['World 4: Giant Land', ['4-1', '4-2', '4-3', '4-4', '4-5', '4-6', '4-Fortress 1', '4-Fortress 2', '4-Airship']],
  ['World 5: Sky Land', ['5-1', '5-2', '5-3', '5-4', '5-5', '5-6', '5-7', '5-8', '5-9', '5-Tower', '5-Fortress', '5-Airship']],
  ['World 6: Ice Land', ['6-1', '6-2', '6-3', '6-4', '6-5', '6-6', '6-7', '6-8', '6-9', '6-10', '6-Fortress 1', '6-Fortress 2', '6-Fortress 3', '6-Airship']],
  ['World 7: Pipe Maze', ['7-1', '7-2', '7-3', '7-4', '7-5', '7-6', '7-7', '7-8', '7-9', '7-Piranha Plant 1', '7-Piranha Plant 2', '7-Fortress 1', '7-Fortress 2', '7-Airship']],
  ['World 8: Dark Land', ['8-Tank 1', '8-Tank 2', '8-Battleship', '8-Hand Trap 1', '8-Hand Trap 2', '8-Hand Trap 3', '8-Fortress', '8-Airship', "8-Bowser's Castle"]],
];

export default {
  storageKey: 'mario-3-journal',
  unit: 'level',
  clearedLabel: 'levels cleared',
  coinLabel: 'Coins',
  points: true,
  systems: ['NES', 'Super Mario All-Stars (SNES)', 'Game Boy Advance (Super Mario Advance 4)', 'Wii U Virtual Console', 'Nintendo Switch Online', 'Emulator', 'Other'],
  groups: worlds.map(([label, levels]) => ({
    label,
    items: levels.map((n) => ({ id: 'smb3-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: 'World ' + n })),
  })),
};
