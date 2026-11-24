// Super Mario 64 stars. Names follow the N64 release. Secret-star coverage is best effort:
// use "Add custom" in the app for anything missing. Ids are stable; do not renumber them.
const courses = [
  ['Bob-omb Battlefield', ['Big Bob-omb on the Summit', 'Footrace with Koopa the Quick', 'Shoot to the Island in the Sky', 'Find the 8 Red Coins', 'Mario Wings to the Sky', "Behind Chain Chomp's Gate"]],
  ["Whomp's Fortress", ["Chip Off Whomp's Block", 'To the Top of the Fortress', 'Shoot into the Wild Blue', 'Red Coins on the Floating Isles', 'Fall onto the Caged Island', 'Blast Away the Wall']],
  ['Jolly Roger Bay', ['Plunder in the Sunken Ship', 'Can the Eel Come Out to Play?', 'Treasure of the Ocean Cave', 'Red Coins on the Ship Afloat', 'Blast to the Stone Pillar', 'Through the Jet Stream']],
  ['Cool, Cool Mountain', ["Slip Slidin' Away", "Li'l Penguin Lost", 'Big Penguin Race', 'Frosty Slide for 8 Red Coins', "Snowman's Lost His Head", 'Wall Kicks Will Work']],
  ["Big Boo's Haunt", ['Go on a Ghost Hunt', "Ride Big Boo's Merry-Go-Round", 'Secret of the Haunted Books', 'Seek the 8 Red Coins', "Big Boo's Balcony", 'Eye to Eye in the Secret Room']],
  ['Hazy Maze Cave', ['Swimming Beast in the Cavern', 'Elevate for 8 Red Coins', 'Metal-Head Mario Can Move!', 'Navigating the Toxic Maze', 'A-Maze-Ing Emergency Exit', 'Watch for Rolling Rocks']],
  ['Lethal Lava Land', ['Boil the Big Bully', 'Bully the Bullies', '8-Coin Puzzle with 15 Pieces', 'Red-Hot Log Rolling', 'Hot-Foot-It into the Volcano', 'Elevator Tour in the Volcano']],
  ['Shifting Sand Land', ['In the Talons of the Big Bird', 'Shining Atop the Pyramid', 'Inside the Ancient Pyramid', 'Stand Tall on the Four Pillars', 'Free Flying for 8 Red Coins', 'Pyramid Puzzle']],
  ['Dire, Dire Docks', ["Board Bowser's Sub", 'Chests in the Current', 'Pole-Jumping for Red Coins', 'Through the Jet Stream', "The Manta Ray's Reward", 'Collect the Caps...']],
  ["Snowman's Land", ["Snowman's Big Head", 'Chill with the Bully', 'In the Deep Freeze', 'Whirl from the Freezing Pond', "Shell Shreddin' for Red Coins", 'Into the Igloo']],
  ['Wet-Dry World', ['Shocking Arrow Lifts!', "Top o' the Town", 'Secrets in the Shallows & Sky', 'Express Elevator--Hurry Up!', 'Go to Town for Red Coins', 'Quick Race Through Downtown!']],
  ['Tall, Tall Mountain', ['Scale the Mountain', 'Mystery of the Monkey Cage', "Scary 'Shrooms, Red Coins", 'Mysterious Mountainside', 'Breathtaking View from Bridge', 'Blast to the Lonely Mushroom']],
  ['Tiny-Huge Island', ['Pluck the Piranha Flower', 'The Tip Top of the Huge Island', 'Rematch with Koopa the Quick', 'Five Itty Bitty Secrets', "Wiggler's Red Coins", 'Make Wiggler Squirm']],
  ['Tick Tock Clock', ['Roll into the Cage', 'The Pit and the Pendulums', 'Get a Hand', 'Stomp on the Thwomp', 'Timed Jumps on Moving Bars', 'Stop Time for Red Coins']],
  ['Rainbow Ride', ['Cruiser Crossing the Rainbow', 'The Big House in the Sky', 'Coins Amassed in a Maze', "Swingin' in the Breeze", 'Tricky Triangles!', 'Somewhere Over the Rainbow']],
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const groups = courses.map(([course, stars]) => ({
  label: course,
  items: [...stars.map((s) => `${s}`), '100 Coins'].map((s) => ({ id: `sm64-${slug(course)}-${slug(s)}`, name: `${course}: ${s}` })),
}));

const castle = [
  'Toad (Basement)', 'Toad (Second floor)', 'Toad (Third floor)',
  'MIPS the Rabbit (first catch)', 'MIPS the Rabbit (second catch)',
  "The Princess's Secret Slide", "The Princess's Secret Slide (under 21 seconds)",
  'The Secret Aquarium', 'Tower of the Wing Cap: Wing Mario Over the Rainbow',
  'Vanish Cap Under the Moat', 'Cavern of the Metal Cap',
  'Bowser in the Dark World: Red Coins', 'Bowser in the Fire Sea: Red Coins', 'Bowser in the Sky: Red Coins',
];
const bowser = ['Bowser in the Dark World (boss)', 'Bowser in the Fire Sea (boss)', 'Bowser in the Sky (boss)'];
groups.push({ label: 'Castle and secret stars', items: castle.map((s) => ({ id: 'sm64-castle-' + slug(s), name: s })) });
groups.push({ label: 'Bowser fights', items: bowser.map((s) => ({ id: 'sm64-bowser-' + slug(s), name: s })) });

export default {
  storageKey: 'mario-64-journal',
  unit: 'star',
  clearedLabel: 'stars and fights logged',
  coinLabel: 'Coins (or red coins) collected',
  points: false,
  systems: ['Nintendo 64', 'Wii Virtual Console', 'Wii U Virtual Console', 'Nintendo Switch Online', 'Super Mario 3D All-Stars', 'Emulator', 'Other'],
  groups,
};
