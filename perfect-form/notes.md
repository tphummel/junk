# Notes

## Goal
A single static page exercising mobile web form features, to see how well iOS
(Safari, and Brave with 1Password) fills it from the contact card, password
manager, and saved cards.

## What was built
- `index.html`: no build step, no dependencies, nothing is sent anywhere.
  Separate `<form>`s for contact/address, sign up, sign in, one-time code,
  payment, files, keyboards and pickers, plus a passkey section.
- Submitting stores a masked report in sessionStorage and navigates, which is
  the signal password managers use to offer "Save Password?". Untested on a
  device: that is the first thing to check.
- A "This browser" readout shows the detected browser, iOS version, HTTPS,
  autofill selector support and passkey availability, so test screenshots are
  labelled.

## Learned along the way
- Playwright's Chromium (iPhone 14 emulation) ran the page with no console
  errors; it cannot exercise iOS AutoFill, camera or password manager.
- A three-column city/state/ZIP grid was too cramped on a phone width; city
  now takes its own row.
- Safari's "AutoFill Contact" uses the card chosen under Settings > Safari >
  AutoFill > My Info. I believe Brave on iOS does not read the contact card
  (unverified); 1Password handles passwords, passkeys and one-time codes via
  the system AutoFill provider.
- All iOS browsers use WebKit, so the markup behaves the same; the difference
  is the app's own autofill integration.
- Brave on iOS may not identify itself in the user agent, so the readout says
  "Safari (or a browser that hides its name)" when it cannot tell.

## Open questions
- Which fields Safari fills from the card (birthday, job title and website are
  expected to stay empty).
- Whether 1Password fills Identity and Credit Card items on iOS.
- Whether the post-submit navigation triggers "Save Password?" in each browser.
