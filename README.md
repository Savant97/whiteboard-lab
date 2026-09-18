# whiteboard-lab

A stylus whiteboard to test "draw it from memory" on a tablet (iPad + Apple Pencil, Android + pen).
Static page, no build, no server: boards live in the browser's `localStorage`; PNG download for keeping a picture.

Live: https://savant97.github.io/whiteboard-lab/

`whiteboard.js` is a copy of the drawing core used privately elsewhere with a server-side store;
the store interface is three promises (`list`, `load`, `save`), so the same file runs here against `localStorage`.

## Run locally

Open `index.html`, or `python -m http.server 8080` and visit http://localhost:8080.

## Publish

GitHub Pages, branch `main`, folder `/` (root). Settings → Pages → Build and deployment → Deploy from a branch.
