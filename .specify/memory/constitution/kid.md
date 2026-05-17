# Constitution Module — Kid profile (Layer C)

> Loaded ONLY when the active profile is Kid (8–14 years old). Additive on top of `safe-by-default.md`.

## I. No social, no contact with strangers

- No chat with other users.
- No comment sections open to the public.
- No DM, no friend requests, no public profile.
- If multi-user features are needed (e.g. share a drawing with a friend), use a parent-supervised flow only.

## II. No commerce, no ads

- No in-app purchases.
- No advertising, no sponsored content, no affiliate links.
- No promotional notifications.

## III. UI vocabulary

- All user-facing strings in plain language a 10-year-old would understand.
- Use icons + text together (icons alone may confuse).
- Avoid jargon: "Sauver" / "Save" not "Submit", "Recommencer" / "Start over" not "Reset", "Mon dessin" / "My drawing" not "Workspace".
- Use the local language by default (French in MMD's context). English only if explicitly requested.

## IV. Visual richness encouraged

- Emojis OK and encouraged for feedback ("✨ C'est sauvé !", "🎨 À toi de dessiner !").
- Friendly mascot or named assistant ("Luna", "Pixel", etc.) — to be decided per project.
- Soft sounds OK for feedback (success ding), but never autoplay.

## V. Adult-account hosting

- Generated apps are deployed under the adult's account (Sébastien's Vercel/Netlify), not under any account created for the kid.
- The kid never enters credentials, never sees billing.

## VI. No AI in the delivered app (default)

The PWA delivered to the kid does NOT, by default, call an LLM at runtime. If the kid asks for an AI feature explicitly (e.g. "a chatbot that tells me jokes"), the parent must approve and a dedicated ADR justifies the choice.

---

*Version: 1.0.0 | Loaded ONLY for profile=Kid. See bindings.*
