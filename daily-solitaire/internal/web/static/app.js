// Daily Solitaire — the whole JavaScript budget: Turbo, Stimulus and three
// small controllers. The game is fully playable with JavaScript off; these
// only add passkey ceremonies (which need the WebAuthn browser API), card
// animation, and drag.
import * as Turbo from "@hotwired/turbo"
import { Application, Controller } from "@hotwired/stimulus"

const application = Application.start()

// ---------------------------------------------------------------- passkeys

const b64uToBuf = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer
}
const bufToB64u = (buf) => {
  let bin = ""
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || ""

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
    body: JSON.stringify(body || {}),
  })
  let data = {}
  try { data = await res.json() } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, data }
}

function creationOptions(o) {
  const pk = o.publicKey
  pk.challenge = b64uToBuf(pk.challenge)
  pk.user.id = b64uToBuf(pk.user.id)
  for (const c of pk.excludeCredentials || []) c.id = b64uToBuf(c.id)
  return o
}
function requestOptions(o) {
  const pk = o.publicKey
  pk.challenge = b64uToBuf(pk.challenge)
  for (const c of pk.allowCredentials || []) c.id = b64uToBuf(c.id)
  return o
}
function encodeAttestation(c) {
  return {
    id: c.id, rawId: bufToB64u(c.rawId), type: c.type,
    authenticatorAttachment: c.authenticatorAttachment,
    response: {
      attestationObject: bufToB64u(c.response.attestationObject),
      clientDataJSON: bufToB64u(c.response.clientDataJSON),
      transports: c.response.getTransports ? c.response.getTransports() : [],
    },
    clientExtensionResults: c.getClientExtensionResults(),
  }
}
function encodeAssertion(c) {
  return {
    id: c.id, rawId: bufToB64u(c.rawId), type: c.type,
    authenticatorAttachment: c.authenticatorAttachment,
    response: {
      authenticatorData: bufToB64u(c.response.authenticatorData),
      clientDataJSON: bufToB64u(c.response.clientDataJSON),
      signature: bufToB64u(c.response.signature),
      userHandle: c.response.userHandle ? bufToB64u(c.response.userHandle) : null,
    },
    clientExtensionResults: c.getClientExtensionResults(),
  }
}

application.register("passkey", class extends Controller {
  static targets = ["username", "display", "status", "button"]
  static values = { next: String, conditional: Boolean, rp: String, user: String, username: String, display: String, credentials: Array }

  connect() {
    if (this.conditionalValue) this.startConditional()
    this.sendSignals()
  }
  disconnect() { this.abort?.abort() }

  // The passkey appears in the username field's autofill.
  async startConditional() {
    try {
      if (!window.PublicKeyCredential?.isConditionalMediationAvailable) return
      if (!(await PublicKeyCredential.isConditionalMediationAvailable())) return
      const begin = await post("/auth/login/begin", { next: this.nextValue })
      if (!begin.ok) return
      this.abort = new AbortController()
      const cred = await navigator.credentials.get({
        ...requestOptions(begin.data.options), mediation: "conditional", signal: this.abort.signal,
      })
      await this.finishLogin(begin.data.c, "", cred)
    } catch { /* aborted, or the user ignored the autofill: fine */ }
  }

  async login(event) {
    event.preventDefault()
    this.abort?.abort()
    await this.run(async () => {
      const begin = await post("/auth/login/begin", { username: this.hasUsernameTarget ? this.usernameTarget.value : "", next: this.nextValue })
      if (!begin.ok) throw new Error(begin.data.error || "Could not start sign-in.")
      const cred = await navigator.credentials.get(requestOptions(begin.data.options))
      await this.finishLogin(begin.data.c, begin.data.mode === "user" ? "&mode=user" : "", cred)
    })
  }

  async finishLogin(c, extra, cred) {
    const done = await post(`/auth/login/finish?c=${encodeURIComponent(c)}${extra}`, encodeAssertion(cred))
    if (!done.ok) {
      if (done.data.unknown_credential) this.signalUnknown(cred.id)
      throw new Error(done.data.error || "Sign-in failed.")
    }
    Turbo.visit(done.data.redirect || "/")
  }

  async signup(event) {
    event.preventDefault()
    await this.run(async () => {
      const begin = await post("/auth/signup/begin", { username: this.usernameTarget.value, display_name: this.displayTarget.value })
      if (!begin.ok) throw new Error(begin.data.error || "Could not start sign-up.")
      const cred = await navigator.credentials.create(creationOptions(begin.data.options))
      const done = await post(`/auth/signup/finish?c=${encodeURIComponent(begin.data.c)}`, encodeAttestation(cred))
      if (!done.ok) throw new Error(done.data.error || "Sign-up failed.")
      Turbo.visit(done.data.redirect || "/")
    })
  }

  async stepup(event) {
    event.preventDefault()
    await this.run(async () => {
      const begin = await post("/auth/stepup/begin")
      if (!begin.ok) throw new Error(begin.data.error || "Could not start verification.")
      const cred = await navigator.credentials.get(requestOptions(begin.data.options))
      const done = await post(`/auth/stepup/finish?c=${encodeURIComponent(begin.data.c)}&next=${encodeURIComponent(this.nextValue)}`, encodeAssertion(cred))
      if (!done.ok) throw new Error(done.data.error || "Verification failed.")
      Turbo.visit(done.data.redirect || "/")
    })
  }

  async add(event) {
    event.preventDefault()
    await this.run(async () => {
      const name = this.hasDisplayTarget ? this.displayTarget.value : ""
      const begin = await post("/account/passkeys/begin", { name })
      if (begin.status === 403) { Turbo.visit(`/auth/stepup?next=${encodeURIComponent("/account#passkeys")}`); return }
      if (!begin.ok) throw new Error(begin.data.error || "Could not start.")
      const cred = await navigator.credentials.create(creationOptions(begin.data.options))
      const done = await post(`/account/passkeys/finish?c=${encodeURIComponent(begin.data.c)}`, encodeAttestation(cred))
      if (!done.ok) throw new Error(done.data.error || "Could not add the passkey.")
      Turbo.visit(done.data.redirect || "/account")
    })
  }

  async run(fn) {
    this.say("")
    if (this.hasButtonTarget) this.buttonTarget.disabled = true
    try {
      if (!window.PublicKeyCredential) throw new Error("This browser doesn't support passkeys.")
      await fn()
    } catch (err) {
      this.say(err.name === "NotAllowedError" ? "That was cancelled. Try again when you're ready." : err.message)
    } finally {
      if (this.hasButtonTarget) this.buttonTarget.disabled = false
    }
  }

  say(msg) {
    if (!this.hasStatusTarget) return
    this.statusTarget.textContent = msg
    this.statusTarget.hidden = !msg
  }

  // WebAuthn Signals keep the password manager in step with the server.
  async sendSignals() {
    if (!window.PublicKeyCredential || !this.hasUserValue || !this.userValue) return
    try {
      if (PublicKeyCredential.signalAllAcceptedCredentials) {
        await PublicKeyCredential.signalAllAcceptedCredentials({ rpId: this.rpValue, userId: this.userValue, allAcceptedCredentialsIds: this.credentialsValue })
      }
      if (PublicKeyCredential.signalCurrentUserDetails) {
        await PublicKeyCredential.signalCurrentUserDetails({ rpId: this.rpValue, userId: this.userValue, name: this.usernameValue, displayName: this.displayValue })
      }
    } catch { /* signals are best-effort */ }
  }
  async signalUnknown(credentialId) {
    try { await PublicKeyCredential.signalUnknownCredential?.({ rpId: this.rpValue, credentialId }) } catch { /* best-effort */ }
  }
})

// --------------------------------------------------------------- animation
// Cards carry stable ids, which morphing preserves, so each card can be
// FLIP-animated from where it was to where it is now.

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches

application.register("flip", class extends Controller {
  connect() {
    this.before = this.snapshot.bind(this)
    this.after = this.play.bind(this)
    addEventListener("turbo:before-render", this.before)
    addEventListener("turbo:render", this.after)
  }
  disconnect() {
    removeEventListener("turbo:before-render", this.before)
    removeEventListener("turbo:render", this.after)
  }

  rects() {
    const map = new Map()
    for (const el of this.element.querySelectorAll(".slot[id]")) map.set(el.id, el.getBoundingClientRect())
    return map
  }
  snapshot() {
    this.old = this.rects()
    this.stock = this.element.querySelector(".stock")?.getBoundingClientRect()
  }
  play() {
    const old = this.old
    this.old = null
    if (!old || !this.element.isConnected) return
    const quiet = reduce()
    for (const el of this.element.querySelectorAll(".slot[id]")) {
      const was = old.get(el.id)
      const now = el.getBoundingClientRect()
      if (was) {
        const dx = was.left - now.left, dy = was.top - now.top
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
        if (quiet) el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 150 })
        else el.animate([{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 20 }, { transform: "none", zIndex: 20 }], { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" })
      } else if (!quiet && this.stock && el.closest(".waste")) {
        // A freshly drawn card flies in from the stock.
        el.animate([{ transform: `translate(${this.stock.left - now.left}px, ${this.stock.top - now.top}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" })
      } else {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: quiet ? 120 : 200 })
      }
    }
  }
})

// -------------------------------------------------------------------- drag
// Tap-to-move is primary; dragging a card (and the cards on top of it) onto a
// pile is a progressive enhancement that submits the same form with `to` set.

application.register("drag", class extends Controller {
  connect() {
    this.onDown = this.down.bind(this)
    this.onClick = (e) => { if (this.justDragged) { e.preventDefault(); e.stopPropagation(); this.justDragged = false } }
    this.element.addEventListener("pointerdown", this.onDown)
    this.element.addEventListener("click", this.onClick, true)
  }
  disconnect() {
    this.element.removeEventListener("pointerdown", this.onDown)
    this.element.removeEventListener("click", this.onClick, true)
  }

  down(e) {
    const slot = e.target.closest("[data-drag-card]")
    if (!slot || (e.pointerType === "mouse" && e.button !== 0)) return
    this.slot = slot
    this.start = { x: e.clientX, y: e.clientY }
    this.dragging = false
    this.pointerId = e.pointerId
    this.move = this.moved.bind(this)
    this.up = this.dropped.bind(this)
    addEventListener("pointermove", this.move)
    addEventListener("pointerup", this.up)
    addEventListener("pointercancel", this.up)
  }

  group() {
    const out = [this.slot]
    if (this.slot.parentElement.classList.contains("col")) {
      for (let n = this.slot.nextElementSibling; n; n = n.nextElementSibling) out.push(n)
    }
    return out
  }

  moved(e) {
    const dx = e.clientX - this.start.x, dy = e.clientY - this.start.y
    if (!this.dragging) {
      if (Math.hypot(dx, dy) < 8) return
      this.dragging = true
      this.cards = this.group()
      for (const c of this.cards) c.classList.add("dragging")
    }
    for (const c of this.cards) c.style.transform = `translate(${dx}px, ${dy}px)`
  }

  dropped(e) {
    removeEventListener("pointermove", this.move)
    removeEventListener("pointerup", this.up)
    removeEventListener("pointercancel", this.up)
    if (!this.dragging) return
    this.dragging = false
    this.justDragged = true
    setTimeout(() => { this.justDragged = false }, 50)
    const target = e.type === "pointerup" ? this.target(e.clientX, e.clientY) : null
    const form = this.slot
    const source = form.closest("[data-pile]")?.dataset.pile
    for (const c of this.cards) { c.classList.remove("dragging"); c.style.transform = "" }
    if (target && target !== source && form.requestSubmit) {
      form.querySelector('input[name="to"]').value = target
      form.requestSubmit()
    }
  }

  target(x, y) {
    const hit = document.elementFromPoint(x, y)?.closest("[data-pile]")
    if (hit && hit.dataset.pile !== "stock") return hit.dataset.pile
    // Dropping beside a short column still counts: pick the column under x.
    for (const col of this.element.querySelectorAll(".col")) {
      const r = col.getBoundingClientRect()
      if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 8) return col.dataset.pile
    }
    return null
  }
})
