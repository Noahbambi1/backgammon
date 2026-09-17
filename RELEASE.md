# Releasing to the App Store and Google Play

The web app is wrapped with [Capacitor](https://capacitorjs.com) — the same HTML/JS runs inside a native
shell with the app icon, splash screen and store presence. Everything that can be prepared without a
Mac / Android Studio has been done and is committed:

| Done | Where |
|---|---|
| Capacitor project (`npm install` already run) | `package.json`, `capacitor.config.json`, `build-www.js` |
| iOS Xcode project | `ios/App/` — bundle id `com.habanerosystems.backgammon`, camera + local-network usage strings, light status bar |
| Android Studio project | `android/` — CAMERA / VIBRATE permissions, all launcher & splash densities |
| App icon (1024) + splash, generated for every size | `assets/`, `ios/App/App/Assets.xcassets`, `android/app/src/main/res` |
| Native-aware app (no service worker in the shell, invite links point to the web URL, no fullscreen toggle) | `js/app.js` (`IS_NATIVE`) |
| Privacy policy (hosted) | https://noahbambi1.github.io/backgammon/privacy.html |
| Store text, keywords, screenshot list | `store/STORE_LISTING.md` |

What remains needs accounts and tools only you can hold: an **Apple Developer Program** membership
(US$99/year, https://developer.apple.com/programs/enroll/) and a **Mac with Xcode** for iOS; a
**Google Play Console** account (US$25 once, https://play.google.com/console/signup) and **Android
Studio** for Android. No Mac? Options at the end.

## Every release

```bash
node bump.js            # bump the web version (cache busting for the web build)
npm run sync            # copies the web app into www/ and into both native projects
```
Then bump the native version numbers: `android/app/build.gradle` → `versionCode` (+1 every upload) and
`versionName`; iOS → in Xcode, target *App* › General › *Version* and *Build*.

## iOS — App Store

1. On the Mac: install Xcode from the App Store, then `sudo gem install cocoapods` (or `brew install cocoapods`).
2. Clone the repo, `npm install`, `npm run sync`, then `npx cap open ios`.
3. In Xcode: select the *App* target › **Signing & Capabilities** → tick *Automatically manage signing*
   and pick your Team (appears once you're enrolled in the Developer Program). Bundle identifier is
   already `com.habanerosystems.backgammon` — change it here if you want another.
4. Plug in an iPhone (or pick a simulator) and press ▶ to check it runs. Test: bot game, Nearby pairing
   (camera prompt should appear with our text), online room with another phone.
5. **App Store Connect** (https://appstoreconnect.apple.com): *My Apps › + › New App* — platform iOS,
   name (see `store/STORE_LISTING.md` — "Backgammon" alone will be taken), primary language, bundle id
   (register it under *Certificates, IDs & Profiles* if Xcode hasn't already), SKU e.g. `backgammon-1`.
6. Back in Xcode: set the run destination to *Any iOS Device (arm64)* → **Product › Archive** →
   in the Organizer press **Distribute App › App Store Connect › Upload**. First upload takes ~10 min to process.
7. In App Store Connect fill in the listing: description, keywords, subtitle, support URL
   (https://github.com/Noahbambi1/backgammon), privacy policy URL (above), category Games/Board,
   age rating questionnaire (all "None" → 4+), **App Privacy → Data Not Collected**.
   Export compliance: the app uses only standard encryption (HTTPS/WSS and AES for player messages),
   which is exempt — `ITSAppUsesNonExemptEncryption` is already `false` in Info.plist.
8. **Screenshots** are mandatory: 6.9" iPhone (1320×2868) and 6.5" (1284×2778 or 1242×2688); iPad
   13" (2064×2752) only if you keep iPad enabled. Take them in the Simulator (⌘S saves a PNG at the right
   size). Suggested shots are listed in `store/STORE_LISTING.md`.
9. Optional but recommended: **TestFlight** tab → add yourself and Natasha as internal testers; you get
   the build on your phones within minutes, before review.
10. *Add for Review* → *Submit*. Review usually takes 1–3 days.

Review notes worth adding (the *Notes* field for the reviewer): "Online play uses public MQTT
relay servers; to test, open the app on two devices, Create Room on one and Join with the code on the
other. Nearby mode requires two physical devices on one hotspot."

Guideline risks to know about: Apple's 4.2 ("minimum functionality") sometimes flags simple web
wrappers — this app has offline play, a real AI opponent, camera-based pairing and native permissions,
which is normally enough. If they ask, point to those features.

## Android — Google Play

1. Install **Android Studio** (https://developer.android.com/studio); let it install the SDK + JDK.
2. In this folder: `npm run sync`, then `npx cap open android` (or open the `android/` folder in Studio).
3. Let Gradle sync. Run ▶ on a connected phone (USB debugging on) or an emulator to check it.
4. Create your **upload keystore** once — keep it and its password forever, Play cannot recover it:
   *Build › Generate Signed Bundle / APK › Android App Bundle › Create new…* — or in a terminal:
   ```
   keytool -genkeypair -v -keystore backgammon-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Store it **outside** the repo (or rely on `.gitignore`, which already ignores `*.jks` in `android/`).
5. *Build › Generate Signed Bundle* → choose the keystore → **release** → produces
   `android/app/release/app-release.aab`.
6. **Play Console** (https://play.google.com/console): *Create app* → name, Game, Free. Complete the
   *Dashboard* checklist: privacy policy URL, app access (no login), ads (no), content rating
   questionnaire (Board game, no violence → Everyone), target audience, **Data safety** (no data
   collected/shared), store listing text + graphics: 512×512 icon (`assets/icon.png` — Play wants it
   without rounded corners, which ours is), 1024×500 feature graphic (make one from the board), phone
   screenshots (at least 2, 16:9 or 9:16).
7. *Testing › Internal testing* → create release → upload the `.aab` → add your and Natasha's Google
   accounts as testers → you get an install link within minutes.
8. When happy: *Production › Create release* → upload the same `.aab` → roll out. First review typically
   1–3 days (new developer accounts may require 12+ testers for 14 days on a closed test first — Play
   introduced this for personal accounts in 2023; the console tells you if it applies).

## No Mac?

- **Codemagic** (https://codemagic.io, free tier) or **Ionic Appflow** build and upload iOS apps from
  the repo in the cloud; you still need the Apple Developer membership, and you upload your signing
  certificate/keys to them.
- **Rent a Mac** for a day (MacinCloud, MacStadium) — cheapest way to do the Xcode steps yourself.
- A friend's Mac works fine: everything is in git; they only need Xcode and your Apple ID logged in.

## Local checks before any upload

```bash
npm test                # rules + AI tests
node build-www.js       # www/ must contain index.html, js/, css/, vendor/, icons/
```
Play the web build at https://noahbambi1.github.io/backgammon/ — the native shell runs the identical code.
