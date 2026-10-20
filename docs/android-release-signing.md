# Android release signing — future procedure

This document describes what still needs to happen, later, before ALMEO
can ship a real signed Android release build. **No keystore, key,
password, or credential has been created by this scaffold.** It only
prepares the project so that doing this later is safe and mechanical.

## Current state

- `android/app/build.gradle` reads real signing credentials from
  `android/keystore.properties` if that file exists locally.
- That file is gitignored (`android/.gitignore`) and does not exist in
  a fresh checkout.
- Without it, `assembleRelease`/`bundleRelease` fail immediately with an
  explicit error, rather than silently producing an unsigned AAB/APK.
  Debug builds and `cap sync android` are unaffected either way.

## Step 1 — Generate a real upload keystore (not done yet)

Run this yourself, once, on your own machine — never in an automated
session:

```
keytool -genkeypair -v \
  -keystore /somewhere/OUTSIDE/this/repo/almeo-upload-key.jks \
  -alias almeo-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

- Keep the resulting `.jks` file **outside this repository's directory
  tree** (recommended) — an absolute `storeFile` path in
  `keystore.properties` is fine and safer than storing it inside
  `android/`, even though `*.jks`/`*.keystore` are also gitignored there.
- Store the keystore password and key password in a real secret manager
  or password manager. They are never written to any file in this repo.
- Back this file up somewhere durable and private. If it's lost with no
  backup, you cannot update the app under the same signing identity ever
  again (see "upload key" vs "Play App Signing" below for why this is
  recoverable if Play App Signing is enrolled, but not otherwise).

## Step 2 — Create `android/keystore.properties`

Copy `android/keystore.properties.example` to `android/keystore.properties`
(same directory) and fill in the four real values:

```
storeFile=/absolute/path/to/almeo-upload-key.jks
storePassword=<the real keystore password>
keyAlias=almeo-upload
keyPassword=<the real key password>
```

This file must **never** be committed. It already matches a gitignore
rule (`android/.gitignore`); double-check with:

```
git check-ignore -v android/keystore.properties
```

## Step 3 — Build and verify a real signed release

```
cd android
./gradlew bundleRelease
```

This will now succeed (the guard only fires when `keystore.properties`
is absent) and produce `android/app/build/outputs/bundle/release/app-release.aab`.

Verify it's genuinely signed before uploading anywhere:

```
jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab
```

Look for `jar verified` — if it instead says the jar is unsigned, do not
upload it.

## Step 4 — Upload key vs. Google Play App Signing

These are two different keys with two different purposes — do not
confuse them:

- **A. Upload key** — the key you generated in Step 1, used to sign the
  AAB you *upload* to Play Console. Once Play App Signing is enrolled,
  Google only uses this to verify the upload came from you; it does not
  become the key end users' devices actually trust.
- **B. Google Play App Signing key** — a separate key Google generates
  and holds, which actually re-signs your app for distribution to users.
  This is what Play Console enrolls you into on your **first** release
  upload (recommended, and required for new apps on Play as of the
  current Play Console policy) and is the SHA-256 fingerprint that
  matters for Android App Links verification in production.

Neither key is created by this scaffold. Key B does not exist until you
complete your first real upload through Play Console.

## Step 5 — The `assetlinks.json` fingerprint, later

`public/.well-known/assetlinks.json` currently declares a fingerprint
tied to whatever key was used to generate it during earlier development
— **not** the real production signing key, since that doesn't exist
yet. This scaffold deliberately does **not** touch that file (out of
scope for this task).

Once Play App Signing is enrolled (Step 4):

1. In Play Console → your app → **Setup → App integrity** (or **App
   signing**), copy the **SHA-256 certificate fingerprint** listed under
   "App signing key certificate" (not the upload key's fingerprint).
2. Update `public/.well-known/assetlinks.json`'s `sha256_cert_fingerprints`
   array with that value.
3. Redeploy the web app so `https://app.almeo.app/.well-known/assetlinks.json`
   serves the updated file.
4. Re-verify on a device:
   ```
   adb shell pm verify-app-links --re-verify com.linandmic.almeo
   adb shell pm get-app-links com.linandmic.almeo
   ```

## What must never be committed

- `android/keystore.properties` (the real credentials file)
- any `*.jks` / `*.keystore` file
- the keystore password, key alias, or key password, anywhere — not in
  `build.gradle`, not in `gradle.properties`, not in a commit message,
  not in this file
