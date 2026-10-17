#!/usr/bin/env python3
"""Add slide-level data to station.json.

A slide here is one BCSS ROI (slide <-> ROI is 1:1). Its regions are 1024px
tiles on a regular ~915px-stride grid; the tile filename's trailing _<dy>_<dx>
gives the grid position, so a slide can be rebuilt as a mosaic.

Every grid cell is rendered with its REAL tile. Cells holding validation tiles
(the split is tile-level: val tiles sit on training slides) are baked
desaturated+dim so they read as "exists, not selectable". Test tiles never
appear: the test split is institution-level and shares no slide with the pool.

Writes into station.json:
  pool            one composite wall of all pool slides (+ per-slide cell rects)
  slides[]        id, grid, pool/val counts, tiles [[r,c,name,isVal]], mid mosaic
  iters[].picks   the 10 regions selected that iteration, with slide + grid pos
  iters[].queue[] gains slide / r / c so the camera knows where each tile lives

  AL_ROOT=/path python src/make_slides.py
"""
import os, re, csv, json, io, base64
from collections import defaultdict
from PIL import Image, ImageFilter

ROOT = os.environ.get('AL_ROOT', os.path.expanduser('~/ActiveLearningSegmentation'))
FSW  = os.environ.get('AL_FSW', f'{ROOT}/finetune-SAM-Winter')
HERE = os.path.dirname(os.path.abspath(__file__))
STATION = os.environ.get('AL_STATION', os.path.join(HERE, 'data', 'station.json'))
PAT = re.compile(r'^(?P<slide>.+?)_xmin\d+_ymin\d+_MPP-[\d.]+_(?P<dy>\d+)_(?P<dx>\d+)$')
WALL_COLS, WALL_CELL, MID = 11, 104, 224
BG = (246, 243, 246)   # the void around tissue is glass, not black


def b64(im, q):
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()


def load_tile(name, px):
    im = Image.open(f'{ROOT}/merged_dataset/img/{name}.jpg')
    im.draft('RGB', (px, px))                      # decode at reduced scale: ~8x faster
    return im.convert('RGB').resize((px, px), Image.LANCZOS)


def mosaic(tiles, side, bg):
    """tiles = [(row, col, name, is_val)] -> slide image at `side` px per cell."""
    rows = max(r for r, _, _, _ in tiles) + 1
    cols = max(c for _, c, _, _ in tiles) + 1
    out = Image.new('RGB', (cols * side, rows * side), bg)
    for r, c, n, v in tiles:
        # held-out validation tiles are rendered at full colour like everything
        # else; blur + a dashed outline mark them, never a grey cast
        out.paste(load_tile(n, side), (c * side, r * side))
    return out


def blurred(im, cell):
    """Soft-focus copy: everything not selected is shown through this."""
    return im.filter(ImageFilter.GaussianBlur(max(1.2, cell / 9)))


def main():
    st = json.load(open(STATION))
    split = {}
    for sp in ('train', 'val', 'test'):
        for r in csv.reader(open(f'{FSW}/dataset_cfg/SAMPathBCSS/{sp}.csv')):
            split[os.path.splitext(os.path.basename(r[1]))[0]] = sp
    pool_slides = {PAT.match(n)['slide'] for n, sp in split.items() if sp == 'train' and PAT.match(n)}

    # every tile of every pool slide, on an integer grid
    by = defaultdict(list)
    for n, sp in split.items():
        m = PAT.match(n)
        if m and m['slide'] in pool_slides:
            assert sp != 'test', f'test tile on a pool slide: {n}'
            by[m['slide']].append((int(m['dy']), int(m['dx']), n, sp == 'val'))
    grids = {}
    for s, v in by.items():
        ys = sorted({a for a, _, _, _ in v}); xs = sorted({b for _, b, _, _ in v})
        grids[s] = [(ys.index(a), xs.index(b), n, isv) for a, b, n, isv in v]
    pos = {n: (r, c, s) for s, tl in grids.items() for r, c, n, _ in tl}

    picks = defaultdict(list)
    for it in range(30):
        dp = f'{ROOT}/entropy_analysis_maps3/iter{it}_high_gauss10_vizP93'
        if not os.path.isdir(dp): continue
        for f in sorted(os.listdir(dp)):
            m = re.match(r'rank(\d+)_(.+?)_score', f)
            if m and f.endswith('_2d.png') and m.group(2) in pos:
                picks[it].append((int(m.group(1)), m.group(2)))

    # slides the camera will actually enter: every slide holding a queued tile
    visit = {pos[t['name']][2] for i in st['iters'] for t in i['queue'] if t['name'] in pos}

    items = sorted(grids.items())
    wrows = -(-len(items) // WALL_COLS)
    wall = Image.new('RGB', (WALL_COLS * WALL_CELL, wrows * WALL_CELL), BG)
    slides = []
    print(f'{len(items)} pool slides, {sum(len(v) for v in grids.values())} cells '
          f'({sum(not t[3] for v in grids.values() for t in v)} pool, '
          f'{sum(t[3] for v in grids.values() for t in v)} validation)')
    print(f'{len(visit)} slides get a zoom mosaic\n')
    for i, (s, tiles) in enumerate(items):
        rows = max(r for r, _, _, _ in tiles) + 1
        cols = max(c for _, c, _, _ in tiles) + 1
        side = max(6, int((WALL_CELL - 8) / max(rows, cols)))
        th = mosaic(tiles, side, BG)
        gx, gy = (i % WALL_COLS) * WALL_CELL, (i // WALL_COLS) * WALL_CELL
        ox, oy = gx + (WALL_CELL - th.width) // 2, gy + (WALL_CELL - th.height) // 2
        wall.paste(th, (ox, oy))
        e = dict(id=s, rows=rows, cols=cols,
                 n=sum(not t[3] for t in tiles), nv=sum(t[3] for t in tiles),
                 cell=[ox, oy, th.width, th.height],
                 tiles=[[r, c, n, int(v)] for r, c, n, v in tiles])
        if s in visit:
            side_m = max(28, int(MID / max(rows, cols)))
            m = mosaic(tiles, side_m, BG)
            e['mid']  = b64(m, 64)
            e['midb'] = b64(blurred(m, side_m), 52)
        slides.append(e)
        if (i + 1) % 25 == 0: print(f'  ...{i+1}/{len(items)}')

    st['pool'] = dict(img=b64(wall, 62), imgb=b64(blurred(wall, 18), 50), w=wall.width, h=wall.height)
    st['slides'] = slides
    for it in st['iters']:
        it['picks'] = [dict(rank=rk, tile=n, slide=pos[n][2], r=pos[n][0], c=pos[n][1])
                       for rk, n in sorted(picks.get(it['iter'], []))]
        for t in it['queue']:
            if t['name'] in pos:
                t['r'], t['c'], t['slide'] = pos[t['name']]
    # ---- neighbourhood context for the detailed tiles ----------------------------
    # When the camera pans past a tile's edge the main stage used to show black.
    # Bake the real 8 neighbours (train AND validation tiles -- it is just the slide)
    # at their TRUE pixel offsets, so the view continues into adjacent tissue. The
    # centre is left empty: the annotated tile is always drawn on top of this.
    CTX = 192                                   # px per 1024px tile in the mosaic
    ncx = 0
    for it in st['iters']:
        for t in it['queue']:
            if 'he' not in t or t['name'] not in pos:
                continue
            r0, c0, sid = pos[t['name']]
            tiles = by[sid]
            cen = next(x for x in tiles if x[2] == t['name'])
            dy0, dx0 = cen[0], cen[1]
            gi = {n: (r, c) for r, c, n, _ in grids[sid]}
            nb = [(dy - dy0, dx - dx0, n) for dy, dx, n, _ in tiles
                  if n != t['name'] and abs(gi[n][0] - r0) <= 1 and abs(gi[n][1] - c0) <= 1]
            if not nb:
                continue
            minx = min(ox for _, ox, _ in nb + [(0, 0, None)]); miny = min(oy for oy, _, _ in nb + [(0, 0, None)])
            maxx = max(ox for _, ox, _ in nb + [(0, 0, None)]) + 1024
            maxy = max(oy for oy, _, _ in nb + [(0, 0, None)]) + 1024
            sc = CTX / 1024.0
            W = int(round((maxx - minx) * sc)); H = int(round((maxy - miny) * sc))
            mos = Image.new('RGB', (W, H), BG)
            for oy, ox, n in nb:
                mos.paste(load_tile(n, CTX), (int(round((ox - minx) * sc)), int(round((oy - miny) * sc))))
            t['ctx'] = dict(img=b64(mos, 60), ox=minx, oy=miny, w=maxx - minx, h=maxy - miny, n=len(nb))
            ncx += 1
    print(f'  context mosaics for {ncx} detailed tiles')
    json.dump(st, open(STATION, 'w'))
    print(f'\nwrote {STATION}  {os.path.getsize(STATION)/1e6:.2f} MB')


if __name__ == '__main__':
    main()
