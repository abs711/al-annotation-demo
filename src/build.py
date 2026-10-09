#!/usr/bin/env python3
"""Assemble the standalone annotation-station page.

    python src/build.py              -> index.html
    python src/build.py --out X      -> X

page.html holds the markup plus its <title>/<style>, app.js is the whole
application, and data/station.json is the run data. All three are inlined, so
the result is one file that opens straight from the filesystem: no server, no
fetch, no build toolchain. The only network request the page makes is the
Google Fonts stylesheet, and it falls back to system fonts without it.
"""
import argparse, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WRAP = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Region-level active learning for tissue segmentation: three annotation protocols in action on real run data.">
{head}
<style>
/* only what the page does not already set for itself */
:root{{color-scheme:light dark}}
img{{max-width:100%}}
[hidden]{{display:none!important}}
</style>
</head>
<body>
{body}
<script id="d" type="application/json">{data}</script>
<script>
{app}
</script>
</body>
</html>
"""

def build(out):
    page = open(os.path.join(HERE, 'page.html')).read()
    app  = open(os.path.join(HERE, 'app.js')).read()
    data = open(os.path.join(HERE, 'data', 'station.json')).read().strip()
    for blob, what in ((data, 'station.json'), (app, 'app.js')):
        if '</script>' in blob:
            raise SystemExit(f'{what} contains a literal </script>, which would close the tag early')

    head_bits, body = [], page          # <title>/<link>/<style> belong in <head>
    for pat in (r'<title>.*?</title>', r'<link\b[^>]*>', r'<style>.*?</style>'):
        for m in re.findall(pat, body, re.S):
            head_bits.append(m)
            body = body.replace(m, '', 1)

    html = WRAP.format(head='\n'.join(head_bits), body=body.strip(), data=data, app=app)
    with open(out, 'w') as f:
        f.write(html)
    print(f"wrote {out}  {os.path.getsize(out)/1e6:.2f} MB")

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'index.html'))
    build(ap.parse_args().out)
