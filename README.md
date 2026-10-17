# Annotation station

An interactive walkthrough of a region-level active-learning loop for tissue
segmentation — **select → annotate → train → evaluate** — showing what the
annotator actually does under three different feedback protocols, on real data
from a real run.

**[▶ Open the demo](https://abs711.github.io/al-annotation-demo/)**


## What it shows

A 30-iteration run, visiting iterations 1, 2, 5, 10, 15, 25 and 29. Each one
scores the unlabelled pool, selects the 10 most-uncertain tiles, annotates them,
fine-tunes for 10 epochs, and re-evaluates. The panel tracks macro-Dice without
background on val and test, the region count, and — the point of the whole
exercise — the share of pixels that actually had to be labelled.

Three protocols, switchable mid-run:

| protocol | what the annotator is given | what they do |
|---|---|---|
| **Full feedback** | the whole tile | draw each interface once, then name each enclosed area. Regions already closed by earlier curves cost nothing but a class |
| **Partial pixels** | the top-5% entropy pixels (P95) | drag a box over a uniform clump; split a clump into a few pure boxes where its classes sit apart; click pixel by pixel only where classes interleave |
| **Contiguous blobs** | the P93 islands after thin-island removal | confirm an island and name it — drawing a dividing line through it first when it holds two classes |

Two tiles per detailed iteration are annotated step by step; the rest
fast-forward, showing the labels that protocol would have produced — or stating
plainly when a round yields nothing (under contour feedback, ~45% of selected
tiles have no island survive the thin-island filter in a given round).

**Where the regions come from.** A navigator beside the stage shows the pool
(all 105 slides, the 10 picks of the round outlined) and the current slide as its
grid of regions — picked this round, picked in an earlier round, the one being
annotated. Slides are revisited: 74% of touched slides are selected from again in
a later iteration. Panning past a region's edge shows the real neighbouring tiles
of that slide, not black.

Controls: play/pause, step one stage, speed, and **show surrounding context** to
lift the dimming and see a proposal in its tissue.

## Real, reconstructed, depicted

Being precise about this, because a demo that blurs it is worthless:

- **Real** — the tiles and their H&E, the ground-truth labels, the selection
  ranking and entropy scores, the proposal masks, and every Dice, region count
  and pixel percentage in the panel. All from the run's own saved outputs.
- **Reconstructed** — the P95 pixel set, recovered by inverting the colormap of
  the saved entropy figure and taking the top 5%. It follows the real rule but
  is not the original array.
- **Depicted** — the cursor path, the class picker and the pacing. Nobody
  recorded a pathologist; the gestures are a faithful depiction of each
  protocol, not a replay of one.

Which tiles get annotated in close-up is a presentation choice: the queue is the
run's real entropy-ranked selection, but the two shown in detail are picked for
class diversity and for being drawable — tiles where one tissue would need a
dozen jagged curves are skipped, because no one annotates that way.

## Running it

`index.html` is self-contained. Open it from disk, drop it on any static host,
or embed it:

```html
<iframe src="index.html" style="width:100%;height:760px;border:0"></iframe>
```

**GitHub Pages:** *Settings → Pages → Source: `main` / `/ (root)`.* The
`.nojekyll` file keeps Pages from reprocessing anything.

## Rebuilding

```bash
python src/build.py          # page.html + app.js + data/station.json -> index.html
```

That is the whole build: no bundler, no dependencies, no node. Edit
`src/page.html` or `src/app.js` and run it again.

Regenerating the data needs the original run outputs and is only necessary when
those change. Two steps, in order:

```bash
AL_ROOT=/path/to/ActiveLearningSegmentation python src/make_data.py    # tiles, metrics, proposals
AL_ROOT=/path/to/ActiveLearningSegmentation python src/make_slides.py  # pool wall, slide grids, neighbours
```

`make_data.py` reads the entropy maps, the tile images and masks, and the
per-iteration evaluation CSVs, and writes `src/data/station.json`;
`make_slides.py` adds the slide-level data to that file. Requires numpy, Pillow,
scipy and matplotlib.

## Layout

| path | role |
|---|---|
| `index.html` | the built page — the only file needed to view it |
| `src/page.html` | markup, `<title>`, CSS |
| `src/app.js` | the application: geometry, protocols, animation |
| `src/data/station.json` | run data — metrics, tiles, label maps, proposal masks, slides |
| `src/build.py` | inlines the three into `index.html` |
| `src/make_data.py` | regenerates `station.json` from the run outputs |
| `src/make_slides.py` | adds the pool wall, slide grids, picks and neighbourhood mosaics |

## How it works

`app.js` has no dependencies and draws everything on three stacked canvases:
the tile, the dimming and committed labels, and the live overlay with the cursor
and picker.

The protocols are generated from the data rather than scripted:

- **Full feedback** builds a planar subdivision incrementally. Regions are
  worked largest-first, and each owes only the part of its border nobody has
  drawn yet — found by crack-following over the label grid with a shared set of
  drawn edges. The image frame counts as already drawn, so nothing traces the
  tile edge. A region fully enclosed by earlier curves needs no drawing at all.
- **Contiguous** traces each island's true outline at pixel resolution, dims
  everything outside it, and splits it along the interface when it holds more
  than one class.
- **Partial** treats a box as labelling every proposed pixel inside it, so a box
  is only drawn where its contents are a single class: clumps are subdivided
  into tight single-class boxes and whatever cannot be isolated that way is
  clicked pixel by pixel, each with its own class. Proposals are shown as the
  real tissue through a dim veil rather than as coloured dots.

The camera behaves like an imaging tool — discrete zoom notches rather than a
cinematic glide, and a pan at the current magnification when the next target is
already on screen.
