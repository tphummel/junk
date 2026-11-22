// What can be known about a controller and about the browser we are looking at it through. Pure.
//
// The Gamepad API gives a page very little about the device: a name string (often with USB vendor and product ids
// inside it), a mapping, the buttons and axes, and sometimes a vibration actuator, touch points or a pose. It does NOT
// give the connection protocol, signal strength or battery level, and Safari (so every browser on an iPad) has neither
// Web Bluetooth nor WebHID that could read them another way. So this file decodes what is there and says plainly what
// is not, and why.

/** USB vendor ids of the makers we expect to meet. */
const VENDORS = /** @type {Record<string, string>} */ ({
  "057e": "Nintendo",
  "2dc8": "8BitDo",
  "045e": "Microsoft",
  "054c": "Sony",
  "046d": "Logitech",
  "0e6f": "PDP",
  "20d6": "PowerA",
  "0f0d": "Hori",
  "1532": "Razer",
  "28de": "Valve",
  "0738": "Mad Catz",
  "0079": "generic (DragonRise)",
  "2563": "generic (ShanWan)",
});

/** A few products we are sure of, as "vendor:product". Anything else is shown by its ids alone. */
const PRODUCTS = /** @type {Record<string, string>} */ ({
  "057e:2009": "Switch Pro Controller",
  "057e:2006": "Joy-Con (L)",
  "057e:2007": "Joy-Con (R)",
  "057e:200e": "Joy-Con charging grip",
  "054c:05c4": "DualShock 4",
  "054c:09cc": "DualShock 4 (2nd generation)",
  "054c:0ce6": "DualSense",
  "045e:028e": "Xbox 360 Controller",
  "045e:02ea": "Xbox One Controller",
  "045e:02e0": "Xbox One S Controller (Bluetooth)",
  "045e:0b13": "Xbox Series X|S Controller (Bluetooth)",
});

/**
 * @typedef {object} PadIdentity
 * @property {string} raw the id string exactly as the browser gave it
 * @property {string} name the controller's name without the details in brackets
 * @property {string | null} vendorId four hex digits, if the id carried one
 * @property {string | null} productId
 * @property {string | null} vendorName the maker, if we know that vendor id
 * @property {string | null} productName the product, if we know that vendor and product pair
 * @property {string | null} profile Apple's GameController profile named at the end of an iPad or iPhone id ("Extended Gamepad" is the full layout with two sticks and triggers; "Gamepad" is the basic one: d-pad, four buttons, shoulders)
 * @property {"chromium" | "firefox" | "webkit" | "unknown"} format which browser style of id this was
 */

/**
 * Take a Gamepad id apart. Chrome, Edge and Safari write "Name (STANDARD GAMEPAD Vendor: 057e Product: 2009)";
 * Firefox writes "057e-2009-Name"; some pads (on iPadOS especially) carry no ids at all.
 * @param {string} id
 * @returns {PadIdentity}
 */
export function parsePadId(id) {
  const raw = String(id ?? "");
  /** @type {PadIdentity} */
  const out = { raw, name: raw.trim() || "controller", vendorId: null, productId: null, vendorName: null, productName: null, profile: null, format: "unknown" };
  const chromium = raw.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  const details = chromium?.[2] ?? "";
  const vendor = details.match(/Vendor:\s*([0-9a-f]{1,4})/i)?.[1];
  const product = details.match(/Product:\s*([0-9a-f]{1,4})/i)?.[1];
  if (chromium && (vendor || product || /STANDARD GAMEPAD/i.test(details))) {
    out.format = "chromium";
    out.name = chromium[1].trim() || out.name;
    if (vendor) out.vendorId = vendor.toLowerCase().padStart(4, "0");
    if (product) out.productId = product.toLowerCase().padStart(4, "0");
  } else {
    const ff = raw.match(/^([0-9a-f]{1,4})-([0-9a-f]{1,4})-(.+)$/i);
    if (ff) {
      out.format = "firefox";
      out.vendorId = ff[1].toLowerCase().padStart(4, "0");
      out.productId = ff[2].toLowerCase().padStart(4, "0");
      out.name = ff[3].trim();
    } else {
      // iPadOS and iOS name a controller "<name> <profile>", such as "8BitDo SN30 gamepad Extended Gamepad".
      const wk = raw.match(/^(.*?)\s+(Extended Gamepad|Micro Gamepad|Directional Gamepad|Gamepad)$/i);
      if (wk && wk[1].trim()) {
        out.format = "webkit";
        out.name = wk[1].trim();
        out.profile = wk[2].replace(/gamepad/i, "Gamepad").replace(/^extended/i, "Extended").replace(/^micro/i, "Micro").replace(/^directional/i, "Directional");
      }
    }
  }
  if (out.vendorId) out.vendorName = VENDORS[out.vendorId] ?? null;
  if (out.vendorId && out.productId) out.productName = PRODUCTS[`${out.vendorId}:${out.productId}`] ?? null;
  return out;
}

/**
 * @typedef {object} Environment
 * @property {string} browser like "Safari 17", or "unknown"
 * @property {string} os like "iPadOS", "iOS", "macOS", "Windows", "Android", "Linux"
 * @property {boolean} webKitOnly true where every browser is Safari's engine (iPhone and iPad)
 * @property {boolean} gamepadApi
 * @property {boolean} secureContext
 * @property {boolean} webBluetooth
 * @property {boolean} webHid
 * @property {string} userAgent
 */

/**
 * What kind of browser and device this is, from the pieces of `navigator` we are given.
 * @param {{ userAgent?: string, maxTouchPoints?: number, getGamepads?: unknown, bluetooth?: unknown, hid?: unknown }} nav
 * @param {{ isSecureContext?: boolean }} [win]
 * @returns {Environment}
 */
export function describeEnvironment(nav, win = {}) {
  const ua = nav.userAgent ?? "";
  // iPadOS Safari announces itself as a Mac; the touch screen gives it away.
  const iPad = /\biPad\b/.test(ua) || (/\bMacintosh\b/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  const iPhone = /\biPhone\b|\biPod\b/.test(ua);
  const os = iPad ? "iPadOS" : iPhone ? "iOS" : /\bAndroid\b/.test(ua) ? "Android" : /\bWindows\b/.test(ua) ? "Windows" : /\bMacintosh\b/.test(ua) ? "macOS" : /\bCrOS\b/.test(ua) ? "ChromeOS" : /\bLinux\b/.test(ua) ? "Linux" : "unknown";
  const webKitOnly = iPad || iPhone;
  /** @param {RegExp} re */
  const version = (re) => ua.match(re)?.[1]?.split(".")[0] ?? "";
  const browser =
    /\bEdg(?:e|A|iOS)?\/(\d+)/.test(ua) ? `Edge ${version(/\bEdg(?:e|A|iOS)?\/([\d.]+)/)}`
    : /\bFxiOS\/(\d+)|\bFirefox\/(\d+)/.test(ua) ? `Firefox ${version(/\b(?:FxiOS|Firefox)\/([\d.]+)/)}`
    : /\bCriOS\/(\d+)|\bChrome\/(\d+)/.test(ua) ? `Chrome ${version(/\b(?:CriOS|Chrome)\/([\d.]+)/)}`
    : /\bVersion\/([\d.]+).*\bSafari\//.test(ua) ? `Safari ${version(/\bVersion\/([\d.]+)/)}`
    : "unknown";
  return {
    browser, os, webKitOnly,
    gamepadApi: typeof nav.getGamepads === "function",
    secureContext: win.isSecureContext ?? false,
    webBluetooth: Boolean(nav.bluetooth),
    webHid: Boolean(nav.hid),
    userAgent: ua,
  };
}

/**
 * @typedef {object} Availability
 * @property {string} field what the page cannot read
 * @property {string} short a label short enough for a column
 * @property {string} why the reason, for this browser
 */

/**
 * The things a person would like to know about a controller that this browser will not tell a web page, and why.
 * @param {Environment} env
 * @returns {Availability[]}
 */
export function unavailable(env) {
  const base =
    env.webKitOnly
      ? `${env.os} gives web pages only the Gamepad API, and every browser on ${env.os} uses Safari's engine, which has neither Web Bluetooth nor WebHID`
      : env.webBluetooth || env.webHid
        ? `The Gamepad API does not carry it. ${env.browser} on ${env.os} has ${[env.webBluetooth && "Web Bluetooth", env.webHid && "WebHID"].filter(Boolean).join(" and ")}, which can read this from some controllers, but this lab does not use it`
        : `The Gamepad API does not carry it, and ${env.browser} on ${env.os} has no Web Bluetooth or WebHID to read it another way`;
  return [
    { field: "Connection protocol (Bluetooth, USB, wireless dongle)", short: "Protocol", why: `${base}. The controller was paired or plugged in by the operating system, which does not report how to the page.` },
    { field: "Signal strength", short: "Signal strength", why: `${base}. Signal strength belongs to the Bluetooth link, which only the operating system sees.` },
    { field: "Motion sensors (gyroscope and accelerometer)", short: "Motion", why: `The Gamepad API has no motion fields, so a page cannot read a controller's gyroscope or accelerometer. ${env.webHid ? `${env.browser} has WebHID, which can read some controllers' raw motion reports, but this lab does not use it` : `${env.browser} on ${env.os} has no WebHID to read the raw reports another way`}. Native apps can read motion (on Apple devices through the GameController framework).` },
    { field: "Battery level and charging state", short: "Battery", why: `${base}. Only a native app can read it (on Apple devices through the GameController framework).` },
  ];
}

/**
 * How long, as m:ss or h:mm:ss. @param {number | null | undefined} ms
 */
export function clock(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "-";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * About how many bits an axis has, from the smallest step it has been seen to move. An 8-bit axis moves in steps of
 * about 0.0078 across its -1 to 1 range, a 12-bit one in about 0.0005, a 16-bit one in about 0.00003.
 * @param {number | null} smallestStep
 * @returns {number | null}
 */
export function approxBits(smallestStep) {
  if (smallestStep === null || !(smallestStep > 0)) return null;
  const bits = Math.round(Math.log2(2 / smallestStep));
  return bits >= 1 && bits <= 24 ? bits : null;
}
