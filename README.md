# Mari & Graftan

Wedding website for marigraftan.com. Netlify publishes every push to `main`.

- `public/` is what the site serves: `index.html` (English and Georgian) and `media/`.
- `netlify/functions/guest.mjs` finds a guest by the name they type and returns only their own invitation.
- `netlify/functions/rsvp.mjs` saves one reply per invitation (couples share one) in Netlify Blobs; sending again updates it.
- The guest list lives in Mari's private Google Sheet, never in this repository. The site reads it through the sheet's
  Apps Script web app (`apps-script/Code.gs`). Replies go to the sheet's "Replies" tab and names that aren't found to
  "Not found"; each one emails Mari.
- Two environment variables are set in Netlify, not here: `SHEET_URL` (the Apps Script web app link) and
  `TOKEN_SECRET` (signs the "remember me" token saved on each guest's phone).
