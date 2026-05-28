Cloud Function example for handling payment webhooks and updating Firestore.

Setup & deploy (requires Firebase CLI and project already linked):

1. Install dependencies

```bash
cd functions
npm install
```

2. Emulate locally (optional)

```bash
npx firebase emulators:start --only functions,firestore
```

3. Deploy to Firebase

```bash
firebase deploy --only functions
```

Notes:
- This function expects the Firestore document at `appState/web-joki` to exist. The client app creates it automatically if missing.
- For production, add signature verification for your payment provider and secure Firestore Rules.
 
Local emulation (recommended for testing):

```bash
cd functions
npx firebase emulators:start --only functions,firestore
```

When deploying, ensure you have the Firebase CLI installed and authenticated (`firebase login`) and that the project in `.firebaserc` matches your Firebase project.

CI deploy:
- Add `FIREBASE_TOKEN` to your GitHub repository secrets.
- The workflow `.github/workflows/firebase-deploy.yml` will deploy your functions automatically on pushes to `main`.
