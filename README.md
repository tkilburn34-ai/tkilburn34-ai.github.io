# Pen Click Morse

Send Morse code by clicking a pen. Your phone listens and turns the clicks into text.

- **One click** → dot
- **Two quick clicks** → dash
- **Short pause** → next letter · **long pause** → space · **six clicks** → erase the last letter
- **Send tab** → type a message and the phone plays it as clicks for another phone to decode

It runs entirely on the phone. No accounts, no tracking, no audio leaves the device.

---

## How to publish on Google Play (no Mac or Android Studio needed)

The app is an installable web app. You host it for free on GitHub Pages, then
PWABuilder (a free tool from Microsoft) wraps it into the file Google Play wants.
Every step happens in a web browser. A computer makes the uploads easier, but
it can be any computer: Windows, Chromebook or a library PC.

### 1. Put the app online (GitHub Pages, free)

1. Create a free account at **github.com**. Your username becomes part of the app's address.
2. Create a **new public repository** named exactly **`YOURUSERNAME.github.io`**
   (for example `tkilburn.github.io`). It has to be this name: Android only
   trusts the app if its verification file sits at the root of the site.
3. Unzip `pen-click-morse.zip` and upload **everything inside it** to the repository
   (*Add file → Upload files*, then drag the files and folders in).
   - Make sure `.nojekyll` and the `.well-known` folder made it. Files starting with a
     dot are sometimes hidden. If one is missing, use *Add file → Create new file*,
     type the name (for example `.well-known/assetlinks.json`), and paste the contents.
4. In the repository go to **Settings → Pages**. Under *Source*, choose
   **Deploy from a branch → main → / (root)** and save.
5. After a minute or two, open `https://YOURUSERNAME.github.io` on your Android phone.
   Run *Teach it your pen* and try sending SOS. This is the real app.

### 2. Turn it into an Android app (PWABuilder, free)

1. Go to **pwabuilder.com**, enter `https://YOURUSERNAME.github.io` and start.
2. Choose **Package for stores → Android → Google Play** and set:
   - **Package ID:** something unique you'll never change, for example `io.github.yourusername.penclickmorse`
   - **App name:** `Pen Click Morse` · **Short name:** `Pen Morse`
   - **Signing key:** *Create new*
3. Download the zip. It contains:
   - an **`.aab`** file → this is what you upload to Google Play
   - an **`.apk`** file → install it on your own phone to test
   - **`signing.keystore`** and **`signing-key-info.txt`** → **back these up somewhere safe**
     (Google Drive, a USB stick, a password manager). You need them for every future update.
     If you lose them, you can't update the app.
   - an **`assetlinks.json`** file
4. Replace `.well-known/assetlinks.json` in your repository with the one from the zip.
   This removes the browser address bar inside the app.

### 3. Set up Google Play Console

1. Sign up at **play.google.com/console**. There's a one-time fee (currently $25)
   and an identity check that can take a few days.
2. **To sell the app**, set up a **payments profile** (Play Console → *Settings →
   Payments profile*). You can't make an app paid without it.
3. **Create app** → name `Pen Click Morse` → *App* → **Paid**.
   ⚠️ An app can go from paid to free later, but **never from free back to paid**.
4. Fill in the store listing using the text in `STORE-LISTING.md` and the images in `store/`:
   - App icon: `store/play-icon-512.png`
   - Feature graphic: `store/feature-graphic.png`
   - Phone screenshots: `store/screenshot-*.png`
   - Privacy policy URL: `https://YOURUSERNAME.github.io/privacy.html`
     (first replace `[your email address]` in `privacy.html` with a real contact email)
5. Complete the required forms:
   - **Data safety:** the app collects no data and shares no data.
     (Microphone audio is processed on the device and never stored or sent.)
   - **Content rating:** answer the questionnaire. There's no violence, user chat or ads.
   - **Target audience:** 13 and over is simplest.
   - **Ads:** No ads.
   - **Price:** for example $1.99. Google sets prices for other countries automatically.

### 4. The 12-tester rule (new personal accounts)

Personal developer accounts created after November 2023 must run a **closed test
with at least 12 testers who stay opted in for 14 days in a row** before the app
can go public. Plan for this:

1. Play Console → **Testing → Closed testing** → create a track and upload the `.aab`.
2. Add testers' Gmail addresses (friends, family, classmates). Each one opens the
   opt-in link and installs the app. Testers get it free.
3. After 14 days with 12 or more testers, apply for production access on the Dashboard.

### 5. One last fix after the first upload

Google re-signs your app with its own key ("Play App Signing"). Copy Google's
**SHA-256 fingerprint** from Play Console → *Test and release → App integrity →
App signing* and add it as a second entry in `.well-known/assetlinks.json`:

```json
"sha256_cert_fingerprints": ["FINGERPRINT_FROM_PWABUILDER", "FINGERPRINT_FROM_PLAY_CONSOLE"]
```

If you skip this, the app shows an address bar when installed from the store.

### 6. Once it's live: turn on the web demo limit

Open `app.js` and paste your Play Store link into `PLAY_URL` at the top:

```js
const CONFIG = {
  PLAY_URL: "https://play.google.com/store/apps/details?id=io.github.yourusername.penclickmorse",
  WEB_LETTER_LIMIT: 30,
};
```

The free website then stops after 30 letters per visit and shows a **Get it on
Google Play** button. The Android app has no limit. This limit is a nudge, not a
lock: a determined person could get around it.

Then open `sw.js` and change `pcm-v1` to `pcm-v2`. **Do this every time you change
any file**, so phones download the new version.

---

## Updating the app later

Most changes need **no new Play Store upload**. The Android app loads the website,
so editing the files on GitHub updates everyone.

Whenever you change an app file, raise the version number in two places so every
phone switches to the new files together:
- `index.html`: the `?v=5` on the `styles.css`, `decoder.js` and `app.js` lines (make them all `?v=6`)
- `sw.js`: `V = "?v=5"` → `"?v=6"` and `VERSION = "pcm-v5"` → `"pcm-v6"`

The company page lives at `sixsided/` (https://YOURUSERNAME.github.io/sixsided/).
Don't add a custom domain to this repository: it would change the app's address
and break the Android app. Put a company domain on a separate repository instead.
You only need a new `.aab` from PWABuilder if you change the app's name, icon or
package details. Use the **same signing key** you backed up.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app screen, look and behaviour |
| `click-worklet.js` | Click detector. Listens to every audio sample and rejects speech, knocks and echoes |
| `decoder.js` | Turns click timing into dots, dashes and letters |
| `sw.js`, `manifest.webmanifest` | Make it installable and work offline |
| `privacy.html` | Privacy policy (needed for Google Play) |
| `.well-known/assetlinks.json` | Proves the Android app and the website belong together |
| `store/` | Icon, feature graphic and screenshots for the Play listing |
| `tests/` | Automated tests: `node tests/detector.test.js` |
| `fonts/` | Bundled fonts (SIL Open Font License) |

## Tuning tips

- Run **Settings → Teach it your pen** in each new place. It measures the room
  noise and learns your pen's release echo and your double-click speed.
- If letters split or merge, adjust **Letter pause**. If dashes come out as two
  dots, raise **Double-click window**.
- Keyboards and finger snaps sound a lot like pen clicks, so they can trigger it.
