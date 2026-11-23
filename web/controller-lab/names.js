// Names for gamepad controls. Only the "standard" mapping promises what each index is; for any other mapping the
// indexes are all we know, so they are shown as numbers.

/** The standard mapping's buttons, by index. */
const STANDARD_BUTTONS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "L3", "R3", "Up", "Down", "Left", "Right", "Home"];
/** The standard mapping's axes, by index. */
const STANDARD_AXES = ["LX", "LY", "RX", "RY"];

/** @param {string} mapping the Gamepad's mapping @param {number} index @returns {string} */
export function buttonName(mapping, index) {
  return (mapping === "standard" && STANDARD_BUTTONS[index]) || `button ${index}`;
}

/** @param {string} mapping @param {number} index @returns {string} */
export function axisName(mapping, index) {
  return (mapping === "standard" && STANDARD_AXES[index]) || `axis ${index}`;
}
