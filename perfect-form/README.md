# The Perfect Form

A static test page for mobile web form features and iOS autofill. Open
`index.html` over HTTPS on a phone (passwords and passkeys need a secure
context) and see how much each browser and password manager fills.

Sections: contact and address, create account, sign in, passkey, one-time
code, payment, photos and files (library, rear and front camera, video, PDF),
keyboards, and native pickers. The grey text under each field is the markup
that drives it. A "This browser" box at the top identifies the browser.

Nothing leaves the device. Submitting shows a local report; passwords, card
numbers and security codes are masked. The passkey buttons create a real
passkey for the host, which you may want to delete from your password manager.

Status: smoke-tested in emulated mobile Chromium only. Not yet verified on iOS.
See `notes.md` for what was tried and the open questions.
