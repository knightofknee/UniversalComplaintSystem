# Universal Complaint System

An independent public record of what's wrong, about anything. Complaints are
split into points, matched with everyone who shares them, and shown to
whoever can fix it. Organizations can respond; they can't remove anything.

React Native (Expo) for iOS, Android and web, on Firebase. See
[docs/SPEC.md](docs/SPEC.md) for the product and [AGENTS.md](AGENTS.md) for
how the code is organized.

## Run it

```
npm install && npm --prefix functions install
npm run emulators                              # one terminal
EXPO_PUBLIC_USE_EMULATORS=1 npx expo start     # another
```

The intake model needs a Claude API key: put `ANTHROPIC_API_KEY=...` in
`functions/.secret.local` for the emulator, and set it for production with
`firebase functions:secrets:set ANTHROPIC_API_KEY`.

## Deploy

```
firebase deploy --only firestore,storage,functions
```

## Operator scripts

- `npm run review-claims` - organization access requests the daily check held
- `npm run remove -- point|submission <id> "reason"` - removal, logged publicly
