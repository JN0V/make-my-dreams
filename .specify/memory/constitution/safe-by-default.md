# Constitution Module — Safe-by-default (Bundle B)

> Loaded for: any session where the active profile is Kid or Curious. Pro can opt-out individual rules with explicit justification in an ADR.

## I. No tracking, no analytics, no surveillance

- No third-party analytics SDKs (Google Analytics, Mixpanel, etc.) in generated apps by default.
- No tracking pixels.
- No fingerprinting.
- No phone-home telemetry to MMD itself or to Anthropic from generated user apps.

## II. Hardware permissions on demand only

Camera, microphone, geolocation, notifications, clipboard, USB, etc., MUST be requested at the moment of use (in response to an explicit user gesture), NEVER on page load.

(Cf. the v0.1 fil-rouge PWA fix in `fix/camera-secure-context`: secure-context check happens on the user's click on "Start Camera", not at load.)

## III. No signup by default

If persistence is needed, use `localStorage` / IndexedDB / file-system access (with permission) locally. Account creation, OAuth flows, email collection — all require explicit user request, never the AI's default choice.

## IV. Graceful failure

Generated apps MUST keep working in degraded form when a feature is unavailable. A drawing app whose camera is denied still lets you draw. A todo app whose backend is unreachable still lets you browse cached items.

## V. Minimal accessibility

- Contrast ratio ≥ WCAG 2.2 AA.
- Tap/click targets ≥ 48 × 48 px on touch.
- No autoplaying audio, no flash-of-color animations, no surprise sounds.
- Keyboard navigation works for all interactive elements.

## VI. UI vocabulary

User-facing strings in generated apps use plain words: "Save" not "Submit", "Try again" not "Retry", "Done" not "Submit form" — adapted to the active profile's vocabulary level (see kid.md / pro.md).

---

*Version: 1.0.0 | Loaded by Kid + Curious profiles. See bindings.*
