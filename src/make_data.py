import os,re,csv,json,io,base64,numpy as np
from PIL import Image
from scipy import ndimage
import matplotlib; matplotlib.use('Agg'); import matplotlib.image as mpimg
from matplotlib import cm
# Source run outputs. Override with AL_ROOT=/path/to/ActiveLearningSegmentation
ROOT=os.environ.get('AL_ROOT', os.path.expanduser('~/ActiveLearningSegmentation'))
FSW=os.environ.get('AL_FSW', f'{ROOT}/finetune-SAM-Winter')
SP=os.path.dirname(os.path.abspath(__file__))
S=448; MID=200; THUMB=72
SHOW=[1,2,5,10,15,25,29]        # iterations the demo visits; the run itself has 30
DETAIL=[1,2]; NDET=2; QF=10; QFAST=10   # every iteration selects 10 (NUM_SELECTIONS)
CC={0:(0,0,0),1:(255,214,10),2:(220,38,58),3:(45,125,210),4:(34,185,110),5:(168,85,220)}
CN={0:'outside',1:'other',2:'tumor',3:'stroma',4:'inflammatory',5:'necrosis'}
sel=json.load(open(os.environ.get('AL_MODE_RUNS','/tmp/mode_runs.json')))
px={}
for r in csv.DictReader(open(f'{FSW}/mnt_data_format/pixel_cost_by_iter.csv')):
    px.setdefault(r['run'],{})[int(round(float(r['images'])))]=float(r['pct_pixels'])
def series(run):
    s={}
    for r in csv.DictReader(open(f'{FSW}/mnt_data_format/eo_extracted/eval_out/per_iter_eval.csv')):
        if r['run']==run and r['epoch']=='8':
            it=int(r['iter']); d=s.setdefault(it,{'iter':it,'images':int(round(float(r['images'])))})
            d['val' if r['split']=='val' else 'test']=round(float(r['M2_perimg_smooth1_fg']),4)
    for it,d in s.items():
        d['pct']=round(px.get(run,{}).get(d['images'], d['images']/325*100),2)
    return [s[k] for k in sorted(s)]
SER={k:series(v) for k,v in sel.items()}
def b64(im,f,**k):
    b=io.BytesIO(); im.save(b,f,**k); return f"data:image/{f.lower()};base64,"+base64.b64encode(b.getvalue()).decode()
def _run(mask):
    """longest contiguous True run -- isolates the image axes from the colorbar beside it"""
    best=None; s=None
    for i,v in enumerate(list(mask)+[False]):
        if v and s is None: s=i
        elif not v and s is not None:
            if best is None or i-s>best[1]-best[0]+1: best=(s,i-1)
            s=None
    return best
def crop(fig,w):
    """the plotted axes of panel w. Non-white run, not dark run: panel 0 is a viridis map
       with a colorbar to its right -- the old dark-pixel box swallowed the colorbar and
       stretched the map ~9% horizontally."""
    H,W=fig.shape[:2]; sub=fig[:,int(W*w/3):int(W*(w+1)/3)]
    nw=(sub[...,:3].max(2)<0.97)|(sub[...,:3].min(2)<0.9)
    cr=_run(nw.sum(0)>sub.shape[0]*.5); rr=_run(nw.sum(1)>sub.shape[1]*.5)
    return None if cr is None or rr is None else sub[rr[0]:rr[1]+1, cr[0]:cr[1]+1]
def _delegend(a):
    """matplotlib drops a legend in the bottom-right of every panel; its colour swatches
       were being recovered as tissue (the same 119px + 36px specks in all 8 tiles)."""
    h,w=a.shape[:2]; a[int(h*.84):, int(w*.52):]=0; return a
def blobmask(fig):
    c=crop(fig,2)
    if c is None: return None
    r,g,b=c[...,0],c[...,1],c[...,2]
    m=_delegend((((r>.8)&(g>.8)&(b>.8))|((r<.5)&(g>.7)&(b>.7))).astype('uint8'))
    return np.array(Image.fromarray((m*255).astype('uint8')).resize((S,S),Image.NEAREST))>127
def entropy(fig):
    c=crop(fig,0)
    if c is None: return None
    lut=(cm.viridis(np.linspace(0,1,256))[:,:3]*255).astype(np.int16)
    sm=np.array(Image.fromarray((c[...,:3]*255).astype('uint8')).resize((S,S),Image.BILINEAR)).astype(np.int16)
    e=(((sm[:,:,None,:]-lut[None,None,:,:])**2).sum(-1).argmin(-1)/255.).astype(np.float32)
    return _delegend(e)

# ---- what full feedback will actually ask the annotator to draw -------------
# Same incremental subdivision the page runs: largest region first, each region
# only owes the part of its border nobody has drawn yet. Tiles that make one
# tissue carry a dozen jagged curves and a pile of inner loops are unusable as a
# demo -- no one draws a whole gland's outer and inner edges in one unbroken go.
def full_cost(g, GG=112):
    lab=np.full(GG*GG,-1,int); R=[]
    for i in range(GG*GG):
        if lab[i]>=0 or g[i]==0: continue
        k=g[i]; rid=len(R); lab[i]=rid; q=[i]; cl=[]
        while q:
            pp=q.pop(); cl.append(pp); x,y=pp%GG,pp//GG
            for ok,dd in ((x>0,-1),(x<GG-1,1),(y>0,-GG),(y<GG-1,GG)):
                n=pp+dd
                if ok and lab[n]<0 and g[n]==k: lab[n]=rid; q.append(n)
        R.append((k,cl))
    drawn=set(); mx=0; loops=0; tot=0; jobs=0
    for i in sorted([i for i in range(len(R)) if len(R[i][1])>=20],key=lambda i:-len(R[i][1]))[:6]:
        E=[]
        for pp in R[i][1]:
            x,y=pp%GG,pp//GG
            for nx,ny,dd in ((x,y-1,0),(x-1,y,1),(x,y+1,2),(x+1,y,3)):
                if not(0<=nx<GG and 0<=ny<GG): continue
                q2=ny*GG+nx
                if lab[q2]==i: continue
                cid=min(pp,q2)*GG*GG+max(pp,q2)
                if cid in drawn: continue
                seg=[(x+1,y,x,y),(x,y,x,y+1),(x,y+1,x+1,y+1),(x+1,y+1,x+1,y)][dd]
                E.append((cid,)+seg)
        out={}; ind={}
        for e in E:
            out.setdefault((e[1],e[2]),[]).append(e); ind[(e[3],e[4])]=ind.get((e[3],e[4]),0)+1
        ch=[]
        def walk(k0):
            cur=k0; pts=[k0]; ids=[]; gd=0
            while gd<GG*GG*4:
                gd+=1
                if not out.get(cur): break
                e=out[cur].pop(); ids.append(e[0]); pts.append((e[3],e[4])); cur=(e[3],e[4])
                if cur==k0: break
            return pts,ids,(cur==k0 and len(pts)>2)
        for k0 in [k for k in list(out) if k not in ind]+list(out):
            while out.get(k0):
                pts,ids,cl_=walk(k0)
                if ids: ch.append((pts,ids,cl_))
        for _,ids,_c in ch: drawn.update(ids)
        keep=[(pts,cl_) for pts,ids,cl_ in ch if len(pts)>=4]
        jobs+=1; mx=max(mx,len(keep)); loops+=sum(1 for _,c in keep if c)
        tot+=sum(len(pts) for pts,_ in keep)
    return mx,loops,tot,jobs
imgs={os.path.splitext(f)[0] for f in os.listdir(f'{ROOT}/merged_dataset/img')}
iters=[]
for d in SER['contour']:
    it=d['iter']
    if it not in SHOW: continue
    dp=f"{ROOT}/entropy_analysis_maps3/iter{it}_high_gauss10_vizP93"
    cand=[]
    if os.path.isdir(dp):
        for f in sorted(os.listdir(dp)):
            m=re.match(r'rank(\d+)_(.+?)_score([\d.]+)_vizP',f)
            if m and f.endswith('_2d.png') and m.group(2) in imgs:
                cand.append((int(m.group(1)),m.group(2),float(m.group(3)),os.path.join(dp,f)))
    cand.sort(); det = it in DETAIL
    pool = cand[:(QF if det else QFAST)]
    # The queue stays entropy-ranked -- that is the real selection. But which of those
    # tiles we zoom into is a presentation choice, and the top-ranked ones are often a
    # single class (iter0 rank1 is 99% necrosis), which shows the protocols off badly.
    # Pick the most class-diverse tiles in the selected queue instead.
    chosen=set()
    if det:
        sc=[]
        for rk,base,score,panel in pool:
            gtq=np.array(Image.open(f'{ROOT}/merged_dataset/mask/{base}.png').resize((S,S),Image.NEAREST))
            h=np.bincount(gtq.ravel(),minlength=6)/gtq.size
            div=-sum(p*np.log(p) for p in h[1:] if p>0)
            bmq=blobmask(mpimg.imread(panel))
            if bmq is None or bmq.sum()<120: continue
            # contour mode annotates the post-filter islands, so what matters for THAT
            # protocol is how many classes the islands themselves span
            g112=np.array(Image.fromarray(gtq).resize((112,112),Image.NEAREST))
            lb,nb=ndimage.label(bmq); ks=[]
            for j in range(1,nb+1):
                ys,xs=np.nonzero(lb==j)
                if len(ys)<26: continue
                kk=np.bincount(g112[np.minimum(111,ys*112//S),np.minimum(111,xs*112//S)],minlength=6)
                kk[0]=0
                if kk.sum(): ks.append(int(kk.argmax()))
            if not ks: continue
            nk=len(set(ks))
            g112=g112.ravel()
            mx,loops,tot,njobs=full_cost(g112)
            if mx>8 or loops>4 or tot>900: continue      # unhumanly tangled for full feedback
            sc.append((div+0.8*(1-h[1:].max())+0.7*(nk-1), rk, base, panel, h, nk, ks,
                       (mx,loops,tot,njobs)))
        # Three tiers for the contour demo. Islands spanning several classes first;
        # a tile whose islands are ALL 'other' (the catch-all class) is the last resort.
        by=lambda f:sorted([r for r in sc if f(r)],key=lambda z:-z[0])
        rank=(by(lambda r:r[5]>=2)
            + by(lambda r:r[5]<2 and set(r[6])!={1})
            + by(lambda r:r[5]<2 and set(r[6])=={1}))
        if len(rank)<NDET:                            # nothing clean enough: fall back
            seen={r[1] for r in rank}
            rank=rank+[r for r in sc if r[1] not in seen]
        for row in rank[:NDET]:
            tot,rk,base,panel,h,nk,ks,fc=row; chosen.add(rk)
            top=sorted(((v,k) for k,v in enumerate(h) if k),reverse=True)[:3]
            print(f"    detail it{it} rank{rk} {base[:20]} score={tot:.2f} "
                  +" ".join(f"{CN[k]}:{round(100*v)}%" for v,k in top if v>.02)
                  +f" | blobs {[CN[k] for k in ks]} | full: {fc[3]}jobs {fc[0]}curves {fc[1]}loops {fc[2]}pts")
    q=[]
    for rk,base,score,panel in pool:
        im=Image.open(f'{ROOT}/merged_dataset/img/{base}.jpg').convert('RGB')
        e={'name':base,'score':round(score,4),
           'thumb':b64(im.resize((THUMB,THUMB),Image.LANCZOS),'JPEG',quality=62),
           'mid':b64(im.resize((MID,MID),Image.LANCZOS),'JPEG',quality=58)}   # crisp fast-forward
        det_tile = rk in chosen
        fig=mpimg.imread(panel); bm=blobmask(fig); en=entropy(fig)
        gt=np.array(Image.open(f'{ROOT}/merged_dataset/mask/{base}.png').resize((S,S),Image.NEAREST))
        g112=np.array(Image.fromarray(gt).resize((112,112),Image.NEAREST)).astype('uint8')
        # every tile carries its label map and both proposal masks, so a tile the demo
        # skips can still show what that protocol would have labelled on it
        e['gtp']=b64(Image.fromarray(g112,'L'),'PNG',optimize=True)
        W = S if det_tile else 224
        if bm is not None:
            e['blob']=b64(Image.fromarray((bm*255).astype('uint8')).resize((W,W),Image.NEAREST),
                          'PNG',optimize=True)
        spm=None
        if en is not None:
            k=int(round(.05*en.size))
            idx=np.argpartition(en.ravel(),-k)[-k:]
            # store the P95 set as a mask, not a 1-in-19 sample of it: the real set
            # is jagged islands (up to ~1400px) plus speckle, and subsampling it
            # threw the islands away and left only scatter
            spm=np.zeros(en.size,bool); spm[idx]=True; spm=spm.reshape(en.shape)
            e['sparse']=b64(Image.fromarray((spm*255).astype('uint8')).resize((W,W),Image.NEAREST),
                            'PNG',optimize=True)
            e['sparse_px']=int(k)
        if det_tile and bm is not None and spm is not None:
            e.update(he=b64(im.resize((S,S),Image.LANCZOS),'JPEG',quality=74), blob_px=int(bm.sum()))
        q.append(e)
    q=[e for e in q if 'he' in e]+[e for e in q if 'he' not in e]
    iters.append({'iter':it,'queue':q,'detail':det})
    if True: print(f"  iter{it:<3} queue={len(q)} detailed={sum('he' in x for x in q)}")
out=dict(runs=sel, series=SER, iters=iters, class_names=CN, class_colors=CC, S=S, G=112)
p=os.environ.get('AL_OUT', f'{SP}/data/station.json'); json.dump(out,open(p,'w'))
print(f"\n  wrote {p}  {os.path.getsize(p)/1e6:.2f} MB")
