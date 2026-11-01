# Mari & Graftan

Wedding website for marigraftan.com. Netlify publishes every push to `main`.

- `public/` is what the site serves: `index.html` (English and Georgian) and `media/`.
- `netlify/functions/guest.mjs` finds a guest by the name they type and returns only their own invitation.
- `netlify/functions/rsvp.mjs` saves one reply per invitation (couples share one) in Netlify Blobs; sending again updates it.
- `netlify/lib/guests.enc.mjs` is the guest list, encrypted. It can only be read with the `GUEST_KEY` environment variable set in Netlify.
  To update it, export the Google Sheet as CSV and run `GUEST_KEY=... node tools/encrypt-guests.mjs guests.csv`. Never commit the CSV or the key.
- Netlify Forms (`rsvp`, `not-found`) email Mari when a reply arrives or changes, and when someone's name isn't found.
