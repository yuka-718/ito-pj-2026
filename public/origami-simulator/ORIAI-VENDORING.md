# ORIAI vendoring notes

This directory vendors [Amanda Ghassaei's OrigamiSimulator](https://github.com/amandaghassaei/OrigamiSimulator) at the immutable upstream commit:

`7855983a613c879c171b2b1557f8cd102d2640cf`

The upstream project is distributed under the MIT License. Its original `LICENSE` and `README.md` are kept in this directory. The bundled third-party notices and license texts are listed in `THIRD_PARTY_NOTICES.md` and `licenses/`.

ORIAI applies only these integration changes to the vendored source:

- `index.html` removes upstream analytics and loads the Canvas-only embed stylesheet.
- `css/embed.css` hides the upstream navigation, tool panels, sliders, dialogs, and helper UI while retaining the WebGL canvas.
- `js/importer.js` replaces the permissive wildcard message bridge with a direct-parent, same-origin `importFold` bridge and returns `ready`, `loaded`, or `error` status messages.
- Bridge imports set the simulator fold percentage to 100% so the embedded canvas shows the requested completed form rather than the upstream 60% default.
- `js/main.js` does not load the upstream demo model when running inside an iframe.

The simulator remains an all-creases-at-once compliant WebGL approximation. These changes do not turn it into a sequential physical folding engine.

## Embed protocol

The direct same-origin parent sends:

```js
{
  from: "ORIAI",
  op: "importFold",
  requestId: "parent-generated-id",
  fold: {/* FOLD document with faces_vertices */}
}
```

The iframe replies only to its direct parent and only at `window.location.origin`:

```js
{
  from: "OrigamiSimulator",
  bridgeVersion: 1,
  bridgeId: "iframe-instance-id",
  status: "ready" | "loaded" | "error",
  requestId: "echoed-for-loaded-or-error"
}
```

No upstream build step is required; the simulator is a static HTML/JavaScript/WebGL application and is copied into the site's static output.

The parent may resend `{from: "ORIAI", op: "hello"}` after the iframe `load` event. The bridge answers with `ready`, preventing a cached iframe from losing the one-time startup signal.
