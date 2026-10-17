const D=JSON.parse(document.getElementById('d').textContent);
const S=D.S,G=D.G,CC=D.class_colors,CN=D.class_names,SER=D.series,ITS=D.iters;
const PR=[{id:'full',n:'Full feedback',c:'#c4476a',h:'zoom · draw boundary · class each side'},
          {id:'partial',n:'Partial pixels',c:'#f0a868',h:'zoom · pick class · brush pixels'},
          {id:'contour',n:'Contiguous blobs',c:'#4fd9e9',h:'zoom · confirm region · pick class'}];
const SL=D.slides||[], SLBY={}; for(const x of SL)SLBY[x.id]=x;
const POOL=D.pool||null;
const $=i=>document.getElementById(i);
const c1=$('c1'),c2=$('c2'),c3=$('c3');
const K=Math.max(1,Math.min(2.5,Math.round(devicePixelRatio||1)));  // retina backing store
[c1,c2,c3].forEach(c=>{c.width=c.height=Math.round(S*K)});
const g1=c1.getContext('2d'),g2=c2.getContext('2d'),g3=c3.getContext('2d');
const labCv=document.createElement('canvas');labCv.width=labCv.height=S;const gl=labCv.getContext('2d');
const ID=g=>g.setTransform(K,0,0,K,0,0);                            // canvas units stay S
const BG='#f6f3f6';            // glass, not black: what a scan shows where there is no tissue
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
let mode='contour',qi=0,it=ITS[0].iter,stage='select',playing=false,spd=3,sub=null,last=0,cache=new Map(),gen=0;
let view={s:1,cx:S/2,cy:S/2}, vt={s:1,cx:S/2,cy:S/2}, vTw=null, showOut=false;
/* ---------- primitives ---------- */
const lerp=(a,b,u)=>a+(b-a)*u;
const scr=(x,y)=>({x:S/2+(x-view.cx)*view.s, y:S/2+(y-view.cy)*view.s});   // world -> canvas
const load=src=>new Promise((res,rej)=>{const i=new Image();
 i.onload=()=>res(i); i.onerror=()=>rej(new Error('img '+String(src).slice(0,40))); i.src=src});
let zoomQ=[], zoomT=0;                       // discrete wheel notches, like real zoom UI
const easeOut=u=>1-Math.pow(1-u,3);          // fast start, quick settle -- how a drag feels
function goView(to,d){
 const dx=to.cx-view.cx, dy=to.cy-view.cy;
 vTw = (Math.hypot(dx,dy)<2) ? null
     : {from:{cx:view.cx,cy:view.cy},to:{cx:to.cx,cy:to.cy},t:0,d:d||Math.min(320,110+Math.hypot(dx,dy)*0.7)};
 zoomQ=[]; let z=view.s; const up=to.s>z;     // step the scale in ~1.3x wheel clicks
 let guard=0;
 while(Math.abs(z-to.s)>0.035 && guard++<12){ z = up ? Math.min(to.s,z*1.3) : Math.max(to.s,z/1.3); zoomQ.push(z) }
 zoomT=0; vt=to}
const navBusy=()=>!!vTw||zoomQ.length>0;
const fitsNow=t=>{                       // already zoomed in, and the next job is on screen
 if(!t||!t.bbox||view.s<=1.05)return false;
 const b=t.bbox;
 if((b.x1-b.x0)*view.s>S*.72||(b.y1-b.y0)*view.s>S*.72)return false;
 const p0=scr(b.x0,b.y0),p1=scr(b.x1,b.y1);
 return p1.x>6&&p0.x<S-6&&p1.y>6&&p0.y<S-6};
function panTo(b){const s=view.s;         // slide across without touching the zoom
 goView({s,cx:Math.min(S-S/(2*s),Math.max(S/(2*s),(b.x0+b.x1)/2)),
           cy:Math.min(S-S/(2*s),Math.max(S/(2*s),(b.y0+b.y1)/2))})}
const ZCAP={full:2.1,partial:3.0,contour:4.2};   // contour blobs are ~20px across
function setT(bbox,pad){ if(!bbox){goView({s:1,cx:S/2,cy:S/2},200);return}
 const w=Math.max(bbox.x1-bbox.x0,18),h=Math.max(bbox.y1-bbox.y0,18);
 const s=Math.min(ZCAP[mode]||2.1,Math.max(1.15,S/(Math.max(w,h)*(pad||2.6))));
 const cx=Math.min(S-S/(2*s),Math.max(S/(2*s),(bbox.x0+bbox.x1)/2));
 const cy=Math.min(S-S/(2*s),Math.max(S/(2*s),(bbox.y0+bbox.y1)/2));
 goView({s,cx,cy})}
const bboxOf=pts=>pts.length?{x0:Math.min(...pts.map(p=>p.x)),x1:Math.max(...pts.map(p=>p.x)),
 y0:Math.min(...pts.map(p=>p.y)),y1:Math.max(...pts.map(p=>p.y))}:null;
/* ---------- geometry ---------- */
function comps(m,min){const sn=new Uint8Array(S*S),o=[];
 for(let i=0;i<S*S;i++){if(!m[i]||sn[i])continue;const q=[i];sn[i]=1;const px=[];
  while(q.length){const p=q.pop();px.push(p);const x=p%S,y=(p/S)|0;
   if(x>0&&m[p-1]&&!sn[p-1]){sn[p-1]=1;q.push(p-1)}if(x<S-1&&m[p+1]&&!sn[p+1]){sn[p+1]=1;q.push(p+1)}
   if(y>0&&m[p-S]&&!sn[p-S]){sn[p-S]=1;q.push(p-S)}if(y<S-1&&m[p+S]&&!sn[p+S]){sn[p+S]=1;q.push(p+S)}}
  if(px.length>=min){let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,sx=0,sy=0;
   for(const p of px){const x=p%S,y=(p/S)|0;sx+=x;sy+=y;
    if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
   o.push({px,cx:sx/px.length,cy:sy/px.length,r:Math.max(9,Math.sqrt(px.length/Math.PI)),bbox:{x0,x1,y0,y1}})}}
 return o.sort((a,b)=>b.px.length-a.px.length).slice(0,10)}
const gtAt=(gt,x,y)=>gt[Math.min(G-1,(y*G/S)|0)*G+Math.min(G-1,(x*G/S)|0)];
function regionMap(gt){const lab=new Int32Array(G*G).fill(-1),R=[];
 for(let i=0;i<G*G;i++){const k=gt[i];if(lab[i]>=0||k===0)continue;
  const id=R.length,q=[i];lab[i]=id;const cl=[];
  while(q.length){const p=q.pop();cl.push(p);const x=p%G,y=(p/G)|0;
   [[x>0,-1],[x<G-1,1],[y>0,-G],[y<G-1,G]].forEach(([ok,d])=>{const n=p+d;
    if(ok&&lab[n]<0&&gt[n]===k){lab[n]=id;q.push(n)}})}
  R.push({k,cells:cl,n:cl.length})}
 return {lab,R}}
/* ---- full feedback -------------------------------------------------------
   Each interface is drawn ONCE. Work the regions largest-first; a region's
   drawing job is only the part of its border nobody has drawn yet. The tile
   frame counts as already drawn, so nobody traces the image edge.
     * first region   -> open arcs running edge to edge, splitting the tile
     * nested region  -> its loop came free with the parent's border: assign only
     * two siblings   -> the arc between them is new; drawing it closes both
   ------------------------------------------------------------------------ */
function chainCracks(edges){
 const out=new Map(),indeg=new Map(),res=[];
 for(const e of edges){const a=e.ax+','+e.ay,b=e.bx+','+e.by;
  if(!out.has(a))out.set(a,[]); out.get(a).push(e); indeg.set(b,(indeg.get(b)||0)+1)}
 const walk=k0=>{let cur=k0,pts=[k0.split(',').map(Number)],ids=[],g=0;
  while(g++<G*G*4){const arr=out.get(cur);if(!arr||!arr.length)break;
   const e=arr.pop();ids.push(e.id);pts.push([e.bx,e.by]);cur=e.bx+','+e.by;if(cur===k0)break}
  return {pts,ids,closed:cur===k0&&pts.length>2}};
 const drain=keys=>{for(const k of keys)while((out.get(k)||[]).length){
   const c=walk(k); if(c.ids.length)res.push(c)}};
 drain([...out.keys()].filter(k=>!indeg.has(k)));   // open arcs first: they have a loose end
 drain([...out.keys()]);                            // whatever is left closes on itself
 return res}
function pxOutline(px){const set=new Set(px),E=[];
 const out=(nx,ny)=>nx<0||ny<0||nx>=S||ny>=S||!set.has(ny*S+nx);
 for(const p of px){const x=p%S,y=(p/S)|0;
  if(out(x,y-1))E.push({id:p*4,  ax:x+1,ay:y,  bx:x,  by:y});
  if(out(x-1,y))E.push({id:p*4+1,ax:x,  ay:y,  bx:x,  by:y+1});
  if(out(x,y+1))E.push({id:p*4+2,ax:x,  ay:y+1,bx:x+1,by:y+1});
  if(out(x+1,y))E.push({id:p*4+3,ax:x+1,ay:y+1,bx:x+1,by:y})}
 return chainCracks(E).map(c=>simplify(c.pts.map(q=>({x:q[0],y:q[1]})),110))
                      .filter(l=>l.length>=3)}
const tracePath=(g,loops)=>{g.beginPath();
 for(const l of loops){l.forEach((p,j)=>j?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath()}};
function chainSegs(segs){const adj=new Map(),used=new Set(),K=(x,y)=>x+','+y;
 const add=(a,b,i)=>{if(!adj.has(a))adj.set(a,[]);adj.get(a).push({to:b,i})};
 segs.forEach((g,i)=>{add(K(g[0],g[1]),K(g[2],g[3]),i);add(K(g[2],g[3]),K(g[0],g[1]),i)});
 const walk=k0=>{let cur=k0,pts=[k0],g=0;
  while(g++<4000){const nx=(adj.get(cur)||[]).find(e=>!used.has(e.i));if(!nx)break;
   used.add(nx.i);pts.push(nx.to);cur=nx.to}
  return pts.map(k=>k.split(',').map(Number))};
 const res=[],open=[...adj.keys()].filter(k=>adj.get(k).length===1);
 for(const k of open.concat([...adj.keys()])){
  if((adj.get(k)||[]).every(e=>used.has(e.i)))continue;
  const pp=walk(k); if(pp.length>1)res.push(pp)}
 return res}
function simplify(pts,cap){const o=[];
 for(let i=0;i<pts.length;i++){const a=pts[i-1],b=pts[i],c=pts[i+1];
  if(!a||!c||(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)!==0)o.push(b)}
 const st=Math.max(1,Math.ceil(o.length/(cap||70)));
 return o.filter((_,i)=>i%st===0||i===o.length-1)}
function regions(gt){const {lab,R}=regionMap(gt),sc=S/G,drawn=new Set(),out=[];
 const order=R.map((r,i)=>i).filter(i=>R[i].n>=20).sort((a,b)=>R[b].n-R[a].n).slice(0,6);
 for(const i of order){const r=R[i],edges=[];
  for(const p of r.cells){const x=p%G,y=(p/G)|0;
   [[x,y-1,0],[x-1,y,1],[x,y+1,2],[x+1,y,3]].forEach(([nx,ny,d])=>{
    const inside=nx>=0&&ny>=0&&nx<G&&ny<G, q=inside?ny*G+nx:-1;
    if(inside&&lab[q]===i)return;
    if(!inside)return;                       // tile frame: pre-existing, never traced
    const id=Math.min(p,q)*G*G+Math.max(p,q);
    const g=d===0?[x+1,y,x,y]:d===1?[x,y,x,y+1]:d===2?[x,y+1,x+1,y+1]:[x+1,y+1,x+1,y];
    edges.push({id,ax:g[0],ay:g[1],bx:g[2],by:g[3]})})}
  const chains=chainCracks(edges.filter(e=>!drawn.has(e.id)));
  for(const c of chains)for(const id of c.ids)drawn.add(id);
  const cap=Math.max(12,Math.floor(230/Math.max(1,chains.length)));   // total pen time stays sane
  const strokes=chains.map(c=>({pts:simplify(c.pts.map(q=>({x:q[0]*sc,y:q[1]*sc})),cap),closed:c.closed}))
                      .filter(st=>st.pts.length>=3);
  let sx=0,sy=0,x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(const c of r.cells){const x=c%G,y=(c/G)|0;sx+=x;sy+=y;
   if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
  const mx=sx/r.cells.length,my=sy/r.cells.length;        // anchor on a cell that is really inside
  let anc=r.cells[0],bd=1e9;
  for(const c of r.cells){const d=(c%G-mx)**2+(((c/G)|0)-my)**2;if(d<bd){bd=d;anc=c}}
  out.push({t:'region',k:r.k,cells:r.cells,strokes,n:r.n,
    npts:strokes.reduce((a,st)=>a+st.pts.length,0),
    bbox:{x0:x0*sc,x1:(x1+1)*sc,y0:y0*sc,y1:(y1+1)*sc},
    x:(anc%G+.5)*sc, y:(((anc/G)|0)+.5)*sc})}
 return out}
/* A box labels EVERY proposed pixel inside it with one class, so a box is only
   legitimate when its contents are a single class. Subdivide until each cell is
   pure (or too small / too sparse to be worth a box); what is left over has to be
   clicked pixel by pixel. That leftover is the real cost of partial feedback. */
function quadBoxes(pts){const MIN=8,out=[],rest=[];
 const rec=(sub,x0,y0,x1,y1)=>{
  if(!sub.length)return;
  const c={};for(const q of sub)c[q[2]]=(c[q[2]]||0)+1;
  const ks=Object.keys(c);
  if(ks.length===1&&sub.length>=4){out.push({k:+ks[0],px:sub,bbox:bboxOf(sub.map(q=>({x:q[0],y:q[1]})))});return}
  if(x1-x0<MIN||y1-y0<MIN||sub.length<4){rest.push(...sub);return}
  const mx=(x0+x1)>>1,my=(y0+y1)>>1,
   q=(a,b,c2,d2)=>rec(sub.filter(z=>z[0]>=a&&z[0]<=c2&&z[1]>=b&&z[1]<=d2),a,b,c2,d2);
  q(x0,y0,mx,my);q(mx+1,y0,x1,my);q(x0,my+1,mx,y1);q(mx+1,my+1,x1,y1)};
 const b=bboxOf(pts.map(q=>({x:q[0],y:q[1]})));rec(pts,b.x0,b.y0,b.x1,b.y1);
 out.sort((x,y)=>y.px.length-x.px.length);return {boxes:out,rest}}
function islandTask(b,gt){
 const c={};for(const p of b.px){const k=gtAt(gt,p%S,(p/S)|0);if(k)c[k]=(c[k]||0)+1}
 const tot=Object.values(c).reduce((x,y)=>x+y,0); if(!tot)return null;
 const parts=Object.keys(c).map(Number).filter(k=>c[k]/tot>=0.12).sort((x,y)=>c[y]-c[x])
  .map(k=>{const px=b.px.filter(p=>gtAt(gt,p%S,(p/S)|0)===k);
    let sx=0,sy=0;for(const q of px){sx+=q%S;sy+=(q/S)|0}
    return {k,px,share:c[k]/tot,cx:sx/px.length,cy:sy/px.length}});
 if(!parts.length)return null;
 let strokes=[];
 if(parts.length>1){                       // separate the classes before naming them
  const cell=new Map();
  for(const q of b.px){const cx=Math.min(G-1,((q%S)*G/S)|0),cy=Math.min(G-1,(((q/S)|0)*G/S)|0);
   const ci=cy*G+cx; if(!cell.has(ci)&&gt[ci])cell.set(ci,gt[ci])}
  const segs=[];
  for(const [ci,k] of cell){const x=ci%G,y=(ci/G)|0;
   if(x<G-1&&cell.has(ci+1)&&cell.get(ci+1)!==k)segs.push([x+1,y,x+1,y+1]);
   if(y<G-1&&cell.has(ci+G)&&cell.get(ci+G)!==k)segs.push([x,y+1,x+1,y+1])}
  const sc=S/G;
  strokes=chainSegs(segs).map(ch=>({pts:simplify(ch.map(q=>({x:q[0]*sc,y:q[1]*sc})),40),closed:false}))
                         .filter(st=>st.pts.length>=2)}
 const bb=b.bbox,fill=b.px.length/Math.max(1,(bb.x1-bb.x0+1)*(bb.y1-bb.y0+1));
 return {t:'blob',x:b.cx,y:b.cy,r:b.r,bbox:b.bbox,k:parts[0].k,parts,strokes,outline:pxOutline(b.px),
         fill,boxy:parts.length===1,
         npts:strokes.reduce((n,st)=>n+st.pts.length,0)}}
/* Partial feedback proposes the top-5% entropy pixels. That set is not scatter:
   most of its mass sits in jagged islands of 100-1400px, with a few hundred loose
   pixels around them. Islands get the island treatment (outline, bulk or split);
   the loose pixels get point-and-click. */
function clusters(a){const m=a.sparse,gt=a.gt,CELL=8,by={};
 // Tasks are spatial and disjoint: each grid cell owns EVERY proposed pixel inside
 // it, dense island or lone speck alike. Earlier, islands were separate tasks whose
 // pixels were carved out of the cells they sat in -- so a box over a cell could
 // contain bright pixels that belonged to another task and never got labelled.
 for(let p=0;p<S*S;p++){if(!m[p])continue;const x=p%S,y=(p/S)|0,k=gtAt(gt,x,y);if(!k)continue;
  const key=((y/(S/CELL))|0)+','+((x/(S/CELL))|0);(by[key]=by[key]||[]).push([x,y,k])}
 const all=Object.values(by).filter(v=>v.length>=12).sort((x,y)=>y.length-x.length);
 const mk=v=>{const {boxes,rest}=quadBoxes(v),c={};for(const q of v)c[q[2]]=(c[q[2]]||0)+1;
  const d=+Object.keys(c).reduce((x,y)=>c[x]>c[y]?x:y),bb=bboxOf(v.map(q=>({x:q[0],y:q[1]})));
  return {t:'brush',pts:v,k:d,purity:c[d]/v.length,nk:Object.keys(c).length,boxes,rest,bbox:bb,
    cover:(v.length-rest.length)/v.length,pure:boxes.length===1&&!rest.length}};
 const T=all.map(mk);
 // span the range of what partial annotation costs: a clump that boxes in one
 // gesture, one that needs several tight boxes, one that is mostly clicks; then the
 // densest of what remains
 const one=T.filter(z=>z.pure).sort((x,y)=>y.pts.length-x.pts.length),
       many=T.filter(z=>!z.pure&&z.cover>=.5).sort((x,y)=>y.boxes.length-x.boxes.length),
       dots=T.filter(z=>z.cover<.5).sort((x,y)=>x.cover-y.cover);
 const pick=[];for(const g of [one,many,dots,many,one])for(const z of g){if(pick.length>=5)break;if(pick.indexOf(z)<0){pick.push(z);break}}
 for(const z of T){if(pick.length>=5)break;if(pick.indexOf(z)<0)pick.push(z)}
 return pick}
function idxMap(im,W){const c=document.createElement('canvas');c.width=c.height=W;
 const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(im,0,0,W,W);
 const d=g.getImageData(0,0,W,W).data,u=new Uint8Array(W*W);
 for(let p=0;p<W*W;p++)u[p]=d[p*4];return u}
/* What a skipped tile would have been labelled, under the protocol on screen:
   the whole mask for full feedback, the P95 pixels for partial, the post-filter
   islands for contiguous -- each painted with its real class. */
const fcache=new Map();
async function fastOverlay(t){const key=t.name+'|'+mode;
 if(fcache.has(key))return fcache.get(key);
 const gt=idxMap(await load(t.gtp),G);
 const cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');
 let painted=false;
 if(mode==='full'){const u=S/G;
  for(let i=0;i<G*G;i++){const k=gt[i];if(!k)continue;painted=true;
   g.fillStyle=`rgba(${CC[k]},.80)`;g.fillRect((i%G)*u,((i/G)|0)*u,u+.7,u+.7)}}
 else{const src=mode==='contour'?t.blob:t.sparse;
  if(src){const im=await load(src),W=im.width||224,m=idxMap(im,W),u=S/W;
   for(let p=0;p<W*W;p++){if(m[p]<128)continue;
    const x=p%W,y=(p/W)|0,k=gt[Math.min(G-1,((y*G/W)|0))*G+Math.min(G-1,((x*G/W)|0))];
    if(!k)continue;painted=true;
    g.fillStyle=`rgb(${CC[k]})`;g.fillRect(x*u,y*u,u+.6,u+.6)}}}
 cv.empty=!painted; fcache.set(key,cv);return cv}
async function assets(t){if(cache.has(t.name))return cache.get(t.name);
 const img=await load(t.he),bi=await load(t.blob),si=await load(t.sparse),gi=await load(t.gtp);
 const cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');
 const readMask=im=>{g.clearRect(0,0,S,S);g.drawImage(im,0,0,S,S);
  const d=g.getImageData(0,0,S,S).data,u=new Uint8Array(S*S);
  for(let p=0;p<S*S;p++)u[p]=d[p*4]>127?1:0;return u};
 const m=readMask(bi),sm=readMask(si);
 const scv=document.createElement('canvas');scv.width=scv.height=S;   // 10k proposals: one layer
 const sg=scv.getContext('2d'),sd=sg.createImageData(S,S);
 // a dim veil with a hole at every proposed pixel: proposals show as real tissue at
 // full brightness, everything else sits behind the veil. No colour is added, so a
 // labelled pixel is the only coloured thing on the tile.
 for(let p=0;p<S*S;p++){const o=p*4;if(sm[p]){sd.data[o+3]=0;continue}
  sd.data[o]=9;sd.data[o+1]=6;sd.data[o+2]=13;sd.data[o+3]=255}
 sg.putImageData(sd,0,0);
 const a={img,blobs:comps(m,26),gt:idxMap(gi,G),sparse:sm,sparseCv:scv,ctx:t.ctx||null,ctxImg:null};
 if(t.ctx)load(t.ctx.img).then(im=>{a.ctxImg=im}).catch(()=>{});
 a.bnds=regions(a.gt); a.clusters=clusters(a);
 cache.set(t.name,a);return a}
function tasks(a){
 if(mode==='contour')return a.blobs.map(b=>islandTask(b,a.gt)).filter(Boolean);
 if(mode==='full')return a.bnds;
 return a.clusters}
/* ---------- painting ---------- */
function paintCells(cl,k){gl.fillStyle=`rgba(${CC[k]},.78)`;const s=S/G;
 for(const c of cl)gl.fillRect((c%G)*s,((c/G)|0)*s,s+.7,s+.7)}
function paintPx(px,k){const d=gl.getImageData(0,0,S,S),C=CC[k];
 for(const p of px){const o=p*4;d.data[o]=C[0];d.data[o+1]=C[1];d.data[o+2]=C[2];d.data[o+3]=235}
 gl.putImageData(d,0,0)}
/* a labelled proposal is exactly that pixel, same footprint as the orange proposal
   it replaces -- the old r=3.6 disc painted ~3x the area and read as a blob */
function paintDot(x,y,k){gl.fillStyle=`rgb(${CC[k]})`;gl.fillRect(Math.round(x),Math.round(y),1,1)}
function drawCursor(x,y,press){g3.save();g3.beginPath();g3.moveTo(x,y);g3.lineTo(x,y+16);g3.lineTo(x+4.2,y+12.4);
 g3.lineTo(x+7.2,y+18.6);g3.lineTo(x+9.9,y+17.3);g3.lineTo(x+6.8,y+11.3);g3.lineTo(x+11.8,y+10.8);g3.closePath();
 g3.fillStyle='#fff';g3.strokeStyle='#15101c';g3.lineWidth=1.3;g3.fill();g3.stroke();
 if(press){g3.beginPath();g3.arc(x,y,13,0,7);g3.strokeStyle='rgba(255,255,255,.9)';g3.lineWidth=2;g3.stroke()}
 g3.restore()}
function drawPicker(sx,sy,hi,label){const ks=[1,2,3,4,5],rh=18,W=118,
 hd=label?15:2,H=ks.length*rh+hd+5;
 const X=Math.max(4,Math.min(S-W-4,sx+14)),Y=Math.max(4,Math.min(S-H-4,sy-H*.42));
 g3.save();g3.shadowColor='rgba(0,0,0,.6)';g3.shadowBlur=12;g3.shadowOffsetY=3;
 g3.fillStyle='rgba(18,13,25,.97)';g3.strokeStyle='rgba(255,255,255,.34)';g3.lineWidth=1;
 g3.beginPath();g3.roundRect(X,Y,W,H,7);g3.fill();g3.stroke();
 g3.shadowBlur=0;g3.shadowOffsetY=0;g3.textBaseline='middle';
 let y=Y+3;
 if(label){g3.fillStyle='rgba(255,255,255,.5)';g3.font='8px "IBM Plex Mono",monospace';g3.textAlign='left';
  g3.fillText(label.toUpperCase(),X+9,y+6);
  g3.strokeStyle='rgba(255,255,255,.14)';g3.beginPath();g3.moveTo(X+5,y+13);g3.lineTo(X+W-5,y+13);g3.stroke();
  y+=hd}
 const rows=ks.map((k,idx)=>{const ry=y+idx*rh;
  if(hi===k){g3.fillStyle='rgba(255,255,255,.17)';g3.beginPath();g3.roundRect(X+3,ry+1,W-6,rh-2,4);g3.fill()}
  g3.fillStyle=`rgb(${CC[k]})`;g3.beginPath();g3.roundRect(X+9,ry+rh/2-5,11,11,2.5);g3.fill();
  g3.fillStyle=hi===k?'#fff':'rgba(255,255,255,.78)';g3.textAlign='left';
  g3.font=(hi===k?'600 ':'')+'10px "IBM Plex Mono",monospace';g3.fillText(CN[k],X+26,ry+rh/2+.5);
  return {k,x:X+26,y:ry+rh/2}});
 g3.restore();return rows}
function render(a,task){
 if(!isFinite(view.s)||view.s<=0)view.s=1;
 if(!isFinite(view.cx))view.cx=S/2; if(!isFinite(view.cy))view.cy=S/2;
 const T=(g)=>{g.setTransform(view.s*K,0,0,view.s*K,K*(S/2-view.cx*view.s),K*(S/2-view.cy*view.s))};
 ID(g1);g1.clearRect(0,0,S,S);g1.fillStyle=BG;g1.fillRect(0,0,S,S);
 const src=(a&&a.img)||(sub&&sub.mid);
 if(a&&a.ctx&&a.ctxImg){T(g1);const k=S/1024,c=a.ctx;g1.imageSmoothingEnabled=true;
  g1.drawImage(a.ctxImg,c.ox*k,c.oy*k,c.w*k,c.h*k)}
 if(src){T(g1);g1.imageSmoothingEnabled=true;g1.drawImage(src,0,0,S,S);
  if(mode==='partial'&&a&&a.sparseCv){g1.save();g1.globalAlpha=showOut?0.28:0.6;g1.imageSmoothingEnabled=false;
   g1.drawImage(a.sparseCv,0,0,S,S);g1.restore()}}
 ID(g2);g2.clearRect(0,0,S,S);
 if(!showOut&&task&&task.t==='blob'&&task.outline&&task.outline.length){
  g2.save();g2.fillStyle='rgba(9,6,13,.5)';g2.fillRect(0,0,S,S);
  g2.globalCompositeOperation='destination-out';T(g2);
  tracePath(g2,task.outline);g2.fill();g2.restore()}
 else if(!showOut&&mode!=='full'&&task&&task.bbox){   // focus only where proposals are sparse
  const b=task.bbox,p0=scr(b.x0,b.y0),p1=scr(b.x1,b.y1),pad=28;
  const x=p0.x-pad,y=p0.y-pad,w=(p1.x-p0.x)+pad*2,h=(p1.y-p0.y)+pad*2,r=Math.min(28,w/2,h/2);
  g2.save();g2.fillStyle='rgba(9,6,13,.52)';g2.fillRect(0,0,S,S);
  g2.globalCompositeOperation='destination-out';
  const gr=g2.createRadialGradient(x+w/2,y+h/2,Math.max(8,Math.min(w,h)*.34),x+w/2,y+h/2,Math.max(w,h)*.70);
  gr.addColorStop(0,'rgba(0,0,0,1)');gr.addColorStop(.75,'rgba(0,0,0,.95)');gr.addColorStop(1,'rgba(0,0,0,0)');
  g2.fillStyle=gr;g2.beginPath();g2.roundRect(x-24,y-24,w+48,h+48,r+18);g2.fill();
  g2.restore();
  g2.save();g2.strokeStyle='rgba(255,255,255,.22)';g2.lineWidth=1;g2.setLineDash([5,4]);
  g2.beginPath();g2.roundRect(x,y,w,h,r);g2.stroke();g2.restore();}
 T(g2);g2.imageSmoothingEnabled=false;g2.drawImage(labCv,0,0,S,S);g2.imageSmoothingEnabled=true;
 ID(g3);g3.clearRect(0,0,S,S);
 if(!a||!sub||!sub.list)return;
 T(g3);g3.lineWidth=2/view.s;
 if(mode==='contour'){g3.save();g3.strokeStyle='rgba(79,217,233,.55)';g3.setLineDash([4/view.s,4/view.s]);
  for(let i=sub.ti+1;i<sub.list.length;i++){const b=sub.list[i];g3.beginPath();g3.arc(b.x,b.y,b.r,0,7);g3.stroke()}
  g3.restore();
  if(task&&task.outline&&task.outline.length){
   g3.save();g3.lineJoin='round';
   g3.strokeStyle='rgba(8,5,12,.85)';g3.lineWidth=3.4/view.s;tracePath(g3,task.outline);g3.stroke();
   g3.strokeStyle='rgba(79,217,233,.95)';g3.lineWidth=1.7/view.s;tracePath(g3,task.outline);g3.stroke();
   g3.restore()}}
 else if(mode==='partial'){
  if(task&&task.t==='brush'&&sub.marq){const m=sub.marq;      // rubber-band selection
   g3.save();g3.setLineDash([6/view.s,4/view.s]);g3.strokeStyle='#fff';g3.lineWidth=1.6/view.s;
   g3.strokeRect(m.x0,m.y0,m.x1-m.x0,m.y1-m.y0);
   g3.fillStyle='rgba(255,255,255,.12)';g3.fillRect(m.x0,m.y0,m.x1-m.x0,m.y1-m.y0);g3.restore()}}
 else{g3.save();g3.setLineDash([5/view.s,5/view.s]);g3.strokeStyle='rgba(196,71,106,.42)';
  for(let i=sub.ti+1;i<sub.list.length;i++)for(const st of (sub.list[i].strokes||[])){
   g3.beginPath();st.pts.forEach((p,j)=>j?g3.lineTo(p.x,p.y):g3.moveTo(p.x,p.y));
   if(st.closed)g3.closePath();g3.stroke()}
  g3.restore()}
 if(task&&(task.t==='region'||task.t==='blob')){    // every curve this tile has already acquired
  g3.save();g3.strokeStyle='rgba(255,255,255,.34)';g3.lineWidth=1.6/view.s;
  for(let i=0;i<sub.ti;i++)for(const st of (sub.list[i].strokes||[])){
   g3.beginPath();st.pts.forEach((p,j)=>j?g3.lineTo(p.x,p.y):g3.moveTo(p.x,p.y));
   if(st.closed)g3.closePath();g3.stroke()}
  g3.restore();
  if(sub.trace>0){g3.strokeStyle='#fff';g3.lineWidth=2.6/view.s;let n=sub.trace;
   for(const st of task.strokes){const m=Math.min(n,st.pts.length);if(m<=0)break;
    g3.beginPath();st.pts.slice(0,m).forEach((p,j)=>j?g3.lineTo(p.x,p.y):g3.moveTo(p.x,p.y));
    if(st.closed&&m>=st.pts.length)g3.closePath();
    g3.stroke();n-=st.pts.length;if(n<=0)break}}}
 ID(g3);
 const qt=sub&&stage==='annotate'?ITS[qi].queue[sub.k]:null;
 if(qt&&qt.slide&&sub.navd&&sub.ph!=='nav')crumb(qt.slide,qt);
 drawPanels()}
/* ---------- pool & slide levels -------------------------------------------
   One main stage, three zoom levels. The pool (105 slides) and the slide (its
   grid of regions) are shown on the SAME canvases as the region, only during
   select and during the camera moves between regions; while a region is being
   annotated a small navigator in the top-right corner keeps the slide in view.
   Cells: cyan = picked this round, white = picked in an earlier round,
   dim = in the pool, grey+hatched = held-out validation tile (never selectable).
   Test tiles never appear: the test split shares no slide with the pool. */
let camSlide=null;                       // slide the camera is currently inside, or null = pool
const imgs=new Map();
function img(key,src){ if(imgs.has(key))return imgs.get(key);
 imgs.set(key,null); if(src)load(src).then(im=>imgs.set(key,im)).catch(()=>{}); return null}
const lerpR=(a,b,u)=>({x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,w:a.w+(b.w-a.w)*u,h:a.h+(b.h-a.h)*u});
const FULL={x:0,y:0,w:S,h:S};
function fitIn(R,cols,rows,pad){const ar=cols/rows;let w=R.w-pad*2,h=w/ar;
 if(h>R.h-pad*2){h=R.h-pad*2;w=h*ar} return {x:R.x+(R.w-w)/2,y:R.y+(R.h-h)/2,w,h}}
function wallFit(R){if(!POOL)return null;const sc=Math.min(R.w/POOL.w,R.h/POOL.h);
 return {sc,ox:R.x+(R.w-POOL.w*sc)/2,oy:R.y+(R.h-POOL.h*sc)/2}}
function cellRect(sid,R){const s=SLBY[sid],f=wallFit(R);if(!s||!f||!s.cell)return null;
 return {x:f.ox+s.cell[0]*f.sc,y:f.oy+s.cell[1]*f.sc,w:s.cell[2]*f.sc,h:s.cell[3]*f.sc}}
function history(sid,upto){const cur=new Set(),past=new Set();
 for(const I of ITS){if(I.iter>upto)break;for(const p of (I.picks||[]))if(p.slide===sid)(I.iter===upto?cur:past).add(p.r+','+p.c)}
 return {cur,past}}
function hatch(g,x,y,w,h){const sp=Math.max(4,Math.min(w,h)/4);g.save();g.beginPath();g.rect(x,y,w,h);g.clip();
 g.strokeStyle='rgba(255,255,255,.16)';g.lineWidth=1;g.beginPath();
 for(let k=-h;k<w;k+=sp){g.moveTo(x+k,y+h);g.lineTo(x+k+h,y)}g.stroke();g.restore()}
function drawWall(g,R,hot,alpha){const f=wallFit(R);if(!f)return;
 const im=img('wall',POOL.img);
 g.save();g.globalAlpha=alpha==null?1:alpha;
 g.fillStyle=BG;g.fillRect(R.x,R.y,R.w,R.h);
 if(im)g.drawImage(im,f.ox,f.oy,POOL.w*f.sc,POOL.h*f.sc);
 for(const s of SL){if(!s.cell||!(hot&&hot[s.id]))continue;          // picked slides: outline only
  const [ox,oy,w,h]=s.cell;
  g.strokeStyle='rgba(79,217,233,.95)';g.lineWidth=2;
  g.strokeRect(f.ox+ox*f.sc-1.5,f.oy+oy*f.sc-1.5,w*f.sc+3,h*f.sc+3)}
 g.restore()}
function drawSlideGrid(g,R,sid,active,opts){const s=SLBY[sid];if(!s)return null;opts=opts||{};
 const F=fitIn(R,s.cols,s.rows,opts.pad==null?8:opts.pad), tw=F.w/s.cols, th=F.h/s.rows;
 const im=img('m:'+sid,s.mid);
 g.save();
 g.fillStyle=BG;g.fillRect(R.x,R.y,R.w,R.h);
 if(im)g.drawImage(im,F.x,F.y,F.w,F.h);
 else{const c=cellRect(sid,FULL),w=img('wall',POOL&&POOL.img);          // wall crop until the mosaic lands
  if(w&&c&&POOL){const f=wallFit(FULL);g.drawImage(w,(c.x-f.ox)/f.sc,(c.y-f.oy)/f.sc,c.w/f.sc,c.h/f.sc,F.x,F.y,F.w,F.h)}}
 const {cur,past}=history(sid,it), thin=opts.thin||1;
 for(const [r,c,n,v] of s.tiles){const x=F.x+c*tw,y=F.y+r*th,k=r+','+c;
  if(past.has(k)&&!cur.has(k)){g.strokeStyle='rgba(255,255,255,.7)';g.lineWidth=1.4*thin;g.strokeRect(x+.7,y+.7,tw-1.4,th-1.4)}
  if(cur.has(k)){g.strokeStyle='rgba(79,217,233,.95)';g.lineWidth=2.2*thin;g.strokeRect(x+1.1,y+1.1,tw-2.2,th-2.2)}
  if(active&&n===active){g.strokeStyle='#fff';g.lineWidth=2.8*thin;g.strokeRect(x+1.4,y+1.4,tw-2.8,th-2.8)}}
 g.strokeStyle='rgba(28,23,34,.18)';g.lineWidth=1;g.strokeRect(F.x+.5,F.y+.5,F.w-1,F.h-1);
 g.restore();
 return {F,tw,th,cur,past}}
function regionRect(sid,r,c,R){const s=SLBY[sid];if(!s)return null;const F=fitIn(R,s.cols,s.rows,8);
 return {x:F.x+c*F.w/s.cols,y:F.y+r*F.h/s.rows,w:F.w/s.cols,h:F.h/s.rows}}
/* navigator column: pool (small) above slide (medium). Each canvas keeps a
   device-pixel backing store; drawing happens in CSS px. */
function ctxOf(id){const c=$(id);if(!c)return null;const g=c.getContext('2d');return {c,g,w:0,h:0}}
const NP=ctxOf('cp'), NS=ctxOf('cs');
function sized(n){if(!n)return null;const w=n.c.clientWidth||220,h=n.c.clientHeight||(n===NP?150:220);
 if(w!==n.w||h!==n.h){n.w=w;n.h=h;n.c.width=Math.round(w*K);n.c.height=Math.round(h*K)}
 n.g.setTransform(K,0,0,K,0,0);return n}
let pulse=0;                                        // shared highlight pulse
function drawPanels(){pulse=(pulse+1)%1000;
 const qt=sub&&stage==='annotate'?ITS[qi].queue[sub.k]:null;
 const reveal=stage==='select'&&sub?Math.min(10,Math.floor(sub.t/95)):10;
 const picks=(ITS[qi].picks||[]).slice(0,reveal), hot={};
 for(const p of picks)hot[p.slide]=(hot[p.slide]||0)+1;
 const here=camSlide||(qt&&qt.slide)||null;
 // --- pool ---
 const P=sized(NP); if(P){const R={x:0,y:0,w:P.w,h:P.h};
  P.g.clearRect(0,0,P.w,P.h);drawWall(P.g,R,hot,1);
  if(here){const c=cellRect(here,R);if(c){P.g.save();P.g.strokeStyle='#fff';P.g.lineWidth=2.2;
   P.g.strokeRect(c.x-2,c.y-2,c.w+4,c.h+4);P.g.restore()}}
  $('pli').textContent=stage==='select'?`${reveal}/10 picked · ${Object.keys(hot).length} slides`
    :`${SL.length} slides · ${Object.keys(hot).length} in this round`}
 // --- slide ---
 const Sn=sized(NS); if(Sn){const R={x:0,y:0,w:Sn.w,h:Sn.h};
  Sn.g.clearRect(0,0,Sn.w,Sn.h);
  if(!here){Sn.g.fillStyle=BG;Sn.g.fillRect(0,0,Sn.w,Sn.h);
   Sn.g.fillStyle='rgba(28,23,34,.45)';Sn.g.font='10px "IBM Plex Mono",monospace';Sn.g.textAlign='center';
   Sn.g.fillText(stage==='select'?'choosing regions…':'—',Sn.w/2,Sn.h/2+4);
   $('slh').textContent='Slide';$('sli').textContent='—';return}
  const act=qt&&qt.slide===here?qt.name:null;
  const res=drawSlideGrid(Sn.g,R,here,act,{pad:5});
  if(res&&act&&sub&&sub.ph==='nav'){                // pulse the region we are about to open
   const rr=regionRect(here,qt.r,qt.c,R),a=.35+.45*Math.abs(Math.sin(pulse/6));
   Sn.g.save();Sn.g.strokeStyle=`rgba(255,255,255,${a})`;Sn.g.lineWidth=4;Sn.g.strokeRect(rr.x-2,rr.y-2,rr.w+4,rr.h+4);Sn.g.restore()}
  const sl=SLBY[here];
  $('slh').textContent=here.replace(/-DX1$/,'');
  $('sli').textContent=`${sl.rows}×${sl.cols} · ${sl.n} regions`+(res?` · ${res.cur.size} now`+(res.past.size?` · ${res.past.size} earlier`:''):'')}}
/* select stage: the main stage keeps the last region, dimmed, with a caption */
function dimStage(cap){ID(g2);g2.clearRect(0,0,S,S);g2.fillStyle='rgba(9,6,13,.62)';g2.fillRect(0,0,S,S);
 ID(g3);g3.clearRect(0,0,S,S);if(cap){g3.save();g3.fillStyle='rgba(255,255,255,.72)';
 g3.font='500 12px "IBM Plex Mono",monospace';g3.textAlign='center';g3.fillText(cap,S/2,S/2+4);g3.restore()}}
/* handoff into the next region: the new tile scales in on the main stage while
   the navigator highlights where it is. No pool or slide on the main stage. */
function navPlan(from,to,fast){return [{n:'handoff',d:fast?300:560}]}
function drawNav(step,u,t){const e=easeOut(Math.min(1,u));
 ID(g1);ID(g2);ID(g3);g1.clearRect(0,0,S,S);g1.fillStyle=BG;g1.fillRect(0,0,S,S);
 g2.clearRect(0,0,S,S);g3.clearRect(0,0,S,S);
 const im=sub.navMid;
 if(im){const k=.86+.14*e,w=S*k,x=(S-w)/2;g1.save();g1.globalAlpha=Math.min(1,.15+e);
  g1.drawImage(im,x,x,w,w);g1.restore();
  g3.save();g3.strokeStyle=`rgba(255,255,255,${.9*(1-e)})`;g3.lineWidth=2;g3.strokeRect(x,x,w,w);g3.restore()}
 crumb(t.slide,t);
 status(`opening region r${t.r+1}·c${t.c+1} of ${t.slide.replace(/-DX1$/,'')}`);
 drawPanels()}
function crumb(sid,tile){const el=$('crumb');if(!el)return;
 const pool=`<b>pool</b> · ${SL.length} slides`;
 if(!sid){el.innerHTML=pool;return}
 const s=SLBY[sid],{cur,past}=history(sid,it);
 el.innerHTML=`${pool} <span class="sep">▸</span> <b>${sid}</b> · <i>${cur.size} this round</i>`
  +(past.size?` · ${past.size} earlier`:'')}
/* ---------- panel ---------- */
function curve(up){const c=$('curve'),dpr=devicePixelRatio||1,W=c.clientWidth,H=c.clientHeight;
 c.width=W*dpr;c.height=H*dpr;const g=c.getContext('2d');g.scale(dpr,dpr);
 const cs=getComputedStyle(document.documentElement),i3=cs.getPropertyValue('--ink3').trim(),
  ed=cs.getPropertyValue('--edge').trim(),ac=cs.getPropertyValue('--accent').trim(),am=cs.getPropertyValue('--amber').trim();
 const SRS=SER[mode],L=30,R=8,T=9,B=18,lo=.45,hi=.68;
 const X=i=>L+(W-L-R)*(SRS[i].images-25)/290,Y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
 g.clearRect(0,0,W,H);g.font='9px "IBM Plex Mono",monospace';g.strokeStyle=ed;g.fillStyle=i3;g.lineWidth=1;
 [.45,.55,.65].forEach(v=>{const y=Y(v);g.beginPath();g.moveTo(L,y);g.lineTo(W-R,y);g.stroke();
  g.textAlign='right';g.fillText(v.toFixed(2),L-4,y+3)});
 g.textAlign='center';g.fillText('25',L,H-5);g.fillText('315 regions',W-R-24,H-5);
 const ln=(key,col)=>{g.strokeStyle=col;g.lineWidth=1.8;g.beginPath();
  for(let i=0;i<=up;i++){const x=X(i),y=Y(SRS[i][key]);i?g.lineTo(x,y):g.moveTo(x,y)}g.stroke();
  g.fillStyle=col;g.beginPath();g.arc(X(up),Y(SRS[up][key]),3,0,7);g.fill()};
 if(up>=0){ln('test',am);ln('val',ac)}}
function panel(i){const d=SER[mode][i];
 $('mv').textContent=d.val.toFixed(4);$('mt').textContent=d.test.toFixed(4);
 $('mi').textContent=`${d.images} / 325`;$('mp').textContent=d.pct.toFixed(2)+'%';
 $('mb').style.width=Math.min(100,d.pct)+'%';
 $('mv').className=i>0&&d.val>SER[mode][i-1].val?'up':'';
 $('mt').className=i>0&&d.test>SER[mode][i-1].test?'up':'';curve(i)}
const setStage=s=>{stage=s;document.querySelectorAll('.sg').forEach(e=>e.classList.toggle('on',e.dataset.s===s))};
const status=t=>$('status').textContent=t;
function queue(i){$('queue').innerHTML=ITS[i].queue.map((t,j)=>
  `<div class="q" data-j="${j}"><img src="${t.thumb}" alt="queued tile ${j+1}"></div>`).join('');
 $('qi').textContent=`${ITS[i].queue.length} tiles · entropy-selected · ${ITS[i].detail?'tile-by-tile':'fast-forward'}`}
function enter(s){setStage(s);gen++;const my=gen;
 if(s!=='train')$('train').classList.remove('on');
 if(s==='select'){queue(qi);$('chip').textContent=`iteration ${it} / 29`;
  gl.clearRect(0,0,S,S);view={s:1,cx:S/2,cy:S/2};vt={...view};render(null,null);
  camSlide=null;crumb(null,null);dimStage('scoring 1720 unlabelled regions');drawPanels();
  status(`scoring the unlabelled pool · selecting ${ITS[qi].queue.length} most-uncertain regions`);
  sub={t:0,d:1250,gen:my}}
 else if(s==='annotate'){gl.clearRect(0,0,S,S);view={s:1,cx:S/2,cy:S/2};vt={...view};render(null,null);
  camSlide=null;
  sub={k:0,t:0,ph:'open',a:null,list:[],ti:0,bi:0,cx:S/2,cy:S*.4,tx:S/2,ty:S*.4,pk:null,trace:0,
       gen:my,guard:0,side:0,kA:0,kB:0,zset:false};status('annotating')}
 else if(s==='train'){$('train').classList.add('on');
  $('tsub').textContent=`10 epochs · ${SER[mode][it].images} images · ${SER[mode][it].pct.toFixed(2)}% pixels`;
  status('fine-tuning adapters on the expanded labelled set');sub={t:0,d:1400,gen:my}}
 else{status(`evaluating · val ${SER[mode][it].val.toFixed(4)} · test ${SER[mode][it].test.toFixed(4)}`);
  panel(it);sub={t:0,d:850,gen:my}}}
function adv(){const o=['select','annotate','train','evaluate'],n=o[(o.indexOf(stage)+1)%4];
 if(n==='select'){if(qi>=ITS.length-1){playing=false;$('play').textContent='▶ Replay';
   status(`run complete · 30 iterations, ${ITS.length} shown`);return}
  qi++;it=ITS[qi].iter}
 enter(n)}
function nextTask(){sub.ti++;sub.ph='zoomin';sub.t=0;sub.trace=0;sub.pk=null;sub.guard=0;sub.side=0;sub.bi=0;sub.zset=false;sub.plist=null;sub.pi=0;sub.bx=0;sub.panOnly=false}
function tick(dt){if(!sub)return;const sc=[0,2.4,1.6,1,.68,.45,.3][spd];sub.t+=dt/sc;
 if(zoomQ.length){zoomT+=dt/sc;if(zoomT>=95){view.s=zoomQ.shift();zoomT=0}}
 if(vTw){vTw.t+=dt/sc;const u=Math.min(1,vTw.t/vTw.d),e=easeOut(u);
   view.cx=lerp(vTw.from.cx,vTw.to.cx,e);view.cy=lerp(vTw.from.cy,vTw.to.cy,e);
   if(u>=1)vTw=null}
 if(stage==='select'){const q=document.querySelectorAll('.q'),n=Math.min(q.length,Math.floor(sub.t/95));
  q.forEach((e,j)=>e.style.opacity=j<n?'1':'.16');
  const hot={};for(const p of (ITS[qi].picks||[]).slice(0,n))hot[p.slide]=(hot[p.slide]||0)+1;
  const ns=Object.keys(hot).length;
  $('crumb').innerHTML=`<b>pool</b> · ${SL.length} slides · ${n}/10 regions selected`+(ns?` across <i>${ns} slides</i>`:'');
  drawPanels();
  if(sub.t>=sub.d){q.forEach(e=>e.style.opacity='');adv()}return}
 if(stage==='train'){$('tp').style.width=Math.min(100,100*sub.t/sub.d)+'%';if(sub.t>=sub.d)adv();return}
 if(stage==='evaluate'){if(sub.t>=sub.d)adv();return}
 const Q=ITS[qi].queue,t=Q[sub.k],qs=document.querySelectorAll('.q');
 if(!t){adv();return}
 qs.forEach((e,j)=>e.classList.toggle('active',j===sub.k));
 sub.guard=(sub.guard||0)+dt/sc;
 if(sub.guard>12000){qs[sub.k]?.classList.add('done');sub.k++;sub.navd=false;sub.ph='open';sub.a=null;sub.t=0;
  sub.guard=0;sub.ti=0;sub.bi=0;sub.trace=0;sub.pk=null;sub.zset=false;sub.plist=null;sub.pi=0;goView({s:1,cx:S/2,cy:S/2},380);
  status('skipped a slow tile');return}
 if(sub.ph==='open'&&!sub.navd&&t.slide&&SLBY[t.slide]){const my=sub.gen;
  sub.navd=true;sub.ph='nav';sub.t=0;sub.navMid=null;
  sub.navFrom=camSlide; sub.navPrev=sub.k>0?ITS[qi].queue[sub.k-1]:null; sub.navPrevMid=sub.mid||null;
  sub.nav=navPlan(camSlide,t.slide,!t.he);
  load(t.mid).then(im=>{if(sub&&sub.gen===my)sub.navMid=im}).catch(()=>{});
  return}
 if(sub.ph==='nav'){const steps=sub.nav||[];let acc=0,i=0;
  while(i<steps.length&&sub.t>=acc+steps[i].d){acc+=steps[i].d;i++}
  if(i>=steps.length){camSlide=t.slide;sub.ph='open';sub.t=0;return}
  const st=steps[i];camSlide=t.slide;
  drawNav(st.n,(sub.t-acc)/st.d,t);return}
 if(sub.ph==='open'){const my=sub.gen;gl.clearRect(0,0,S,S);sub.zset=false;sub.plist=null;
  goView({s:1,cx:S/2,cy:S/2},200);
  sub.mid=null; load(t.mid).then(im=>{if(sub&&sub.gen===my)sub.mid=im}).catch(()=>{});   // preview always
  if(t.he){sub.ph='load';assets(t).then(a=>{if(sub&&sub.gen===my&&sub.ph==='load'){
    sub.a=a;sub.list=tasks(a);sub.ti=0;sub.ph='show';sub.t=0;sub.guard=0}})
    .catch(()=>{if(sub&&sub.gen===my){sub.ph='fast';sub.t=0;sub.ov=null;
      fastOverlay(t).then(cv=>{if(sub&&sub.gen===my)sub.ov=cv}).catch(()=>{})}})}
  else{sub.ph='fast';sub.t=0;sub.ov=null;
   fastOverlay(t).then(cv=>{if(sub&&sub.gen===my)sub.ov=cv}).catch(()=>{})}
  return}
 if(sub.ph==='load'){
  ID(g1);ID(g2);ID(g3);
  g1.clearRect(0,0,S,S);g1.fillStyle=BG;g1.fillRect(0,0,S,S);
  if(sub.mid)g1.drawImage(sub.mid,0,0,S,S);
  g2.clearRect(0,0,S,S);g3.clearRect(0,0,S,S); {const qt=ITS[qi].queue[sub.k];if(qt&&qt.slide&&sub.navd)crumb(qt.slide,qt);drawPanels()}
  status('loading tile…');return}
 if(sub.ph==='fast'){const WIPE=160;
  ID(g1);ID(g2);ID(g3);
  g1.clearRect(0,0,S,S);g1.fillStyle=BG;g1.fillRect(0,0,S,S);
  if(sub.mid)g1.drawImage(sub.mid,0,0,S,S);
  g2.clearRect(0,0,S,S);
  const h=Math.min(S,S*sub.t/WIPE);
  if(sub.ov){g2.save();g2.beginPath();g2.rect(0,0,S,h);g2.clip();
   g2.imageSmoothingEnabled=false;g2.drawImage(sub.ov,0,0,S,S);g2.restore()}
  if(h<S){g2.fillStyle='rgba(79,217,233,.7)';g2.fillRect(0,Math.max(0,h-1.5),S,1.5)}
  g3.clearRect(0,0,S,S); {const qt=ITS[qi].queue[sub.k];if(qt&&qt.slide&&sub.navd)crumb(qt.slide,qt);drawPanels()}
  const none=sub.ov&&sub.ov.empty;
  if(none){g3.save();g3.fillStyle='rgba(255,255,255,.78)';g3.font='500 12px "IBM Plex Mono",monospace';g3.textAlign='center';
   g3.fillText(mode==='contour'?'no island survived the thin-island filter':'nothing proposed on this tile',S/2,S/2-4);
   g3.fillStyle='rgba(255,255,255,.5)';g3.font='11px "IBM Plex Mono",monospace';g3.fillText('0 px labelled this round',S/2,S/2+14);g3.restore()}
  status(`fast-forward ${Math.min(sub.k+1,Q.length)}/${Q.length} · `
   +(none?(mode==='contour'?'no contiguous region passed the filter · nothing to label':'nothing to label')
     :mode==='full'?'every region labelled':mode==='partial'?'uncertain pixels labelled':'all islands labelled'));
  if(sub.t>WIPE+110){qs[sub.k]?.classList.add('done');sub.k++;sub.navd=false;sub.ph='open';sub.t=0;sub.guard=0}
  return}
 if(sub.ph==='show'){const L=sub.list.length;
  status(`tile ${sub.k+1}/${Q.length} · ${mode==='full'?L+' boundaries to draw':mode==='partial'?L+' pixel clusters':L+' proposed regions'}`);
  sub.ph='zoomin';sub.t=0;sub.guard=0;sub.zset=false;return}
 const task=sub.list[sub.ti];
 if(!task){qs[sub.k]?.classList.add('done');sub.k++;sub.navd=false;sub.ph='open';sub.a=null;sub.t=0;
  sub.zset=false;goView({s:1,cx:S/2,cy:S/2},200);return}
 const a=sub.a;
 /* --- zoom & pan to the work area, like any imaging tool --- */
 if(sub.ph==='zoomin'){
  if(!sub.zset){                                      // once, not per frame
   sub.panOnly=fitsNow(task);
   if(sub.panOnly)panTo(task.bbox); else setT(task.bbox, mode==='partial'?2.4:2.0);
   sub.zset=true}
  const c=(task.npts&&task.strokes&&task.strokes.length)?task.strokes[0].pts[0]
              :{x:task.x??task.pts[0][0],y:task.y??task.pts[0][1]};
  sub.tx=c.x;sub.ty=c.y;
  sub.cx=lerp(sub.cx,sub.tx,Math.min(1,dt/135));sub.cy=lerp(sub.cy,sub.ty,Math.min(1,dt/135));
  render(a,task);const p=scr(sub.cx,sub.cy);drawCursor(p.x,p.y,false);
  status(task.t==='brush'
   ?`cluster ${sub.ti+1}/${sub.list.length} · ${task.pts.length} px · ${task.boxes.length} single-class box${task.boxes.length===1?'':'es'}`
     +(task.rest.length?` · ${task.rest.length} px too mixed to box`:'')
   :`${sub.panOnly?'panning to':'zooming to'} ${task.t==='region'?'region':task.t==='blob'?'island':'proposed region'} ${sub.ti+1}/${sub.list.length}`);
  if(!navBusy()&&sub.t>220){sub.trace=0;
   sub.bx=0;
   sub.ph=task.npts?'trace':task.t==='brush'?(task.boxes.length?'marquee':'ptmove'):'pick';
   sub.t=0;sub.guard=0;sub.pk=null;sub.marq=null;sub.plist=null;sub.pi=0}
  return}
 /* --- draw the closed outline of the region, pen first, class after --- */
 if(sub.ph==='trace'){const N=task.npts,DUR=460+N*21;
  sub.trace=Math.min(N,Math.max(1,Math.ceil(N*sub.t/DUR)));
  let n=sub.trace,pen=null,si=0;
  for(const st of task.strokes){if(n<=st.pts.length){pen=st.pts[Math.max(0,n-1)];break}n-=st.pts.length;si++}
  if(pen){sub.cx=pen.x;sub.cy=pen.y;
   if(view.s>1.05&&!navBusy()){const v=scr(pen.x,pen.y);   // pan to keep the pen in frame
    if(v.x<S*.28||v.x>S*.72||v.y<S*.28||v.y>S*.72)goView({s:view.s,cx:pen.x,cy:pen.y},430)}}
  render(a,task);const q=scr(sub.cx,sub.cy);drawCursor(q.x,q.y,true);
  const cur=task.strokes[Math.min(si,task.strokes.length-1)];
  const nth=task.strokes.length>1?` · curve ${si+1}/${task.strokes.length}`:'';
  status(`${cur&&cur.closed?'tracing a closed outline'
    :task.t==='blob'?`splitting the island · ${task.parts.length} classes inside`
    :'drawing the dividing boundary'}${nth} · ${Math.round(100*sub.trace/N)}%`);
  if(sub.trace>=N&&sub.t>DUR+260){sub.ph='pick';sub.t=0;sub.pk=null;sub.side=0;sub.guard=0}
  return}
 /* --- choose the class (for a boundary: one side then the other) --- */
 if(sub.ph==='marquee'){const bx=task.boxes&&task.boxes.length?task.boxes[sub.bx||0]:null;
  const b=bx?bx.bbox:task.bbox,pad=bx?0.5:5;
  const u=Math.min(1,sub.t/420);
  sub.marq={x0:b.x0-pad,y0:b.y0-pad,x1:b.x0-pad+(b.x1-b.x0+pad*2)*u,y1:b.y0-pad+(b.y1-b.y0+pad*2)*u};
  sub.cx=sub.marq.x1;sub.cy=sub.marq.y1;
  render(a,task);const q=scr(sub.cx,sub.cy);drawCursor(q.x,q.y,true);
  const SHOWB=5,nb=task.boxes?task.boxes.length:0;
  status(bx?`tight box ${(sub.bx||0)+1}/${Math.min(nb,SHOWB)} · ${bx.px.length} px · all ${CN[bx.k]}`+(nb>SHOWB?` · ${nb-SHOWB} more alike`:'')
           :`box-selecting ${task.parts[0].px.length} px · ${CN[task.k]}`);
  if(u>=1&&sub.t>520){sub.ph='pick';sub.t=0;sub.pk=null;sub.guard=0}
  return}
 if(sub.ph==='pick'){
  const part  = task.t==='blob' ? task.parts[sub.pi||0] : null;
  const multi = !!part && task.parts.length>1;
  const wantK = part ? part.k : task.k;
  const anchor = part ? {x:part.cx,y:part.cy} : {x:task.x??task.pts[0][0], y:task.y??task.pts[0][1]};
  const sa=scr(anchor.x,anchor.y);
  render(a,task);
  const chips=drawPicker(sa.x,sa.y,sub.t>200?wantK:null,
     multi?`part ${(sub.pi||0)+1}/${task.parts.length} · ${Math.round(part.share*100)}% of island`
     :task.t==='region'?(task.npts?'class for the enclosed area':'class · already enclosed'):'tissue class');
  if(!sub.pk){const c=chips.find(c=>c.k===wantK)||chips[0];sub.pk=c;sub.scrTarget=c}
  const cp=scr(sub.cx,sub.cy);
  const dx=sub.pk.x-cp.x, dy=sub.pk.y-cp.y;
  sub.cx+= (dx/view.s)*Math.min(1,dt/125); sub.cy+= (dy/view.s)*Math.min(1,dt/125);
  const cp2=scr(sub.cx,sub.cy);drawCursor(cp2.x,cp2.y,sub.t>200);
  status(multi?`island spans ${task.parts.length} classes · ${CN[wantK]} for part ${(sub.pi||0)+1}`
              :`selecting class · ${CN[wantK]}`);
  if(sub.t>620||(Math.hypot(sub.pk.x-cp2.x,sub.pk.y-cp2.y)<7&&sub.t>430)){
    if(task.t==='region'){paintCells(task.cells,task.k);sub.ph='confirm';sub.t=0}
    else if(task.t==='blob'){paintPx(part.px,part.k);
      if((sub.pi||0)+1<task.parts.length){sub.pi=(sub.pi||0)+1;sub.pk=null;sub.t=0}
      else{sub.pi=0;sub.ph='confirm';sub.t=0}}
    else if(task.boxes&&task.boxes.length){const SHOWB=5,bx=task.boxes[sub.bx||0];
      for(const q of bx.px)paintDot(q[0],q[1],bx.k);
      sub.marq=null;
      if((sub.bx||0)+1<Math.min(task.boxes.length,SHOWB)){sub.bx=(sub.bx||0)+1;sub.pk=null;sub.ph='marquee';sub.t=0}
      else{for(const b of task.boxes.slice(SHOWB))for(const q of b.px)paintDot(q[0],q[1],b.k);   // same gesture, repeated
        if(task.rest.length){sub.plist=task.rest.slice(0,5);sub.bi=0;sub.ph='ptmove';sub.t=0}
        else{sub.ph='confirm';sub.t=0}}}
    sub.guard=0}
  return}
 /* --- mixed clump: point at one pixel, pick that pixel's own class, repeat --- */
 if(sub.ph==='ptmove'||sub.ph==='ptpick'){
  if(!sub.plist){sub.plist=(task.rest&&task.rest.length?task.rest:task.pts).slice(0,5);sub.bi=0}
  const L=sub.plist;
  if(sub.bi>=L.length){const all=task.rest&&task.rest.length?task.rest:task.pts;
   for(const q of all.slice(L.length))paintDot(q[0],q[1],q[2]);          // each with its own class
   sub.plist=null;sub.ph='confirm';sub.t=0;sub.guard=0;return}
  const tgt=L[sub.bi],tk=tgt[2],sp=scr(tgt[0],tgt[1]);
  const ring=()=>{g3.save();g3.strokeStyle='rgba(255,255,255,.92)';g3.lineWidth=1.5;
   g3.beginPath();g3.arc(sp.x,sp.y,8,0,7);g3.stroke();g3.restore()};
  if(sub.ph==='ptmove'){
   sub.cx=lerp(sub.cx,tgt[0],Math.min(1,dt/95));sub.cy=lerp(sub.cy,tgt[1],Math.min(1,dt/95));
   const hit=Math.hypot(sub.cx-tgt[0],sub.cy-tgt[1])<2/view.s+1.2;
   render(a,task);ring();const q=scr(sub.cx,sub.cy);drawCursor(q.x,q.y,hit);
   {const all=task.rest&&task.rest.length?task.rest:task.pts,more=all.length-L.length;
   status(`click ${sub.bi+1}/${L.length}${more>0?` (+${more} more)`:''} · neighbours differ in class, so no box fits`)}
   if(hit&&sub.t>150){sub.ph='ptpick';sub.t=0;sub.pk=null;sub.guard=0}
   return}
  render(a,task);ring();
  const chips=drawPicker(sp.x,sp.y,sub.t>180?tk:null,`pixel ${sub.bi+1}/${L.length} · class`);
  if(!sub.pk)sub.pk=chips.find(c=>c.k===tk)||chips[0];
  const cp=scr(sub.cx,sub.cy);
  sub.cx+=((sub.pk.x-cp.x)/view.s)*Math.min(1,dt/110);
  sub.cy+=((sub.pk.y-cp.y)/view.s)*Math.min(1,dt/110);
  const cp2=scr(sub.cx,sub.cy);drawCursor(cp2.x,cp2.y,sub.t>180);
  status(`assigning ${CN[tk]} to pixel ${sub.bi+1}/${L.length}`);
  if(sub.t>580||(Math.hypot(sub.pk.x-cp2.x,sub.pk.y-cp2.y)<7&&sub.t>400)){
   paintDot(tgt[0],tgt[1],tk);sub.bi++;sub.ph='ptmove';sub.t=0;sub.pk=null;sub.guard=0}
  return}
 /* --- stay put and look at the label that was just applied --- */
 if(sub.ph==='confirm'){sub.trace=0;render(a,null);
  const pulse=.40+.45*Math.abs(Math.sin(sub.t/230));
  if(task.bbox){const b=task.bbox,p0=scr(b.x0,b.y0),p1=scr(b.x1,b.y1),pad=10;
   g3.save();g3.setLineDash([7,5]);g3.lineWidth=2.2;g3.strokeStyle=`rgba(${CC[task.k]},${pulse})`;
   g3.strokeRect(p0.x-pad,p0.y-pad,(p1.x-p0.x)+pad*2,(p1.y-p0.y)+pad*2);g3.restore()}
  const p=scr(sub.cx,sub.cy);drawCursor(p.x,p.y,false);
  status(task.t==='brush'
   ?`${task.pts.length} px labelled · ${task.boxes.length} box${task.boxes.length===1?'':'es'}`+(task.rest.length?` + ${task.rest.length} individual clicks`:'')
   :`${CN[task.k]} applied · reviewing before moving on`);
  if(sub.t>1150){sub.ph='zoomout';sub.t=0;sub.guard=0}
  return}
 /* --- zoom back out before moving on --- */
 if(sub.ph==='zoomout'){sub.marq=null;
  const stay=fitsNow(sub.list&&sub.list[sub.ti+1]);
  if(!stay&&view.s>1.02&&!navBusy())goView({s:1,cx:S/2,cy:S/2},260);
  render(a,null);const p=scr(sub.cx,sub.cy);drawCursor(p.x,p.y,false);
  status(stay?'next region already in view · staying at this magnification'
             :'zooming back out to check the label');
  if(!navBusy()&&sub.t>120){sub.ph='review';sub.t=0;sub.guard=0}
  return}
 /* --- hold on the finished label before moving on --- */
 if(sub.ph==='review'){render(a,null);
  const col=`${CC[task.k]}`;
  const pulse=.45+.4*Math.abs(Math.sin(sub.t/190));
  const b=task.bbox;
  if(b){const p0=scr(b.x0,b.y0),p1=scr(b.x1,b.y1),pad=12;
   g3.save();g3.setLineDash([6,4]);g3.lineWidth=2;g3.strokeStyle=`rgba(${col},${pulse})`;
   g3.strokeRect(p0.x-pad,p0.y-pad,(p1.x-p0.x)+pad*2,(p1.y-p0.y)+pad*2);g3.restore()}
  const nm=(task.parts&&task.parts.length>1)?`${task.parts.length} classes in one island`:CN[task.k];
  status(`labelled ${nm} · region ${sub.ti+1}/${sub.list.length} complete`);
  if(sub.t>900)nextTask();
  return}
}
function loop(ts){if(!last)last=ts;const dt=Math.min(60,ts-last);last=ts;
 try{if(playing)tick(dt)}catch(e){console.error('tick',e);
   if(sub){sub.ph='open';sub.a=null;sub.t=0;sub.guard=0}}
 requestAnimationFrame(loop)}
$('protos').innerHTML=PR.map(p=>`<button class="proto" type="button" data-m="${p.id}" aria-pressed="${p.id===mode}"
 title="${p.id==='partial'?'pixel set reconstructed from the saved entropy figure':'proposals recovered from the run\'s saved masks'}">
 <i style="background:${p.c}"></i>${p.n}</button>`).join('');
document.querySelectorAll('.proto').forEach(b=>b.onclick=()=>{mode=b.dataset.m;
 document.querySelectorAll('.proto').forEach(x=>x.setAttribute('aria-pressed',x.dataset.m===mode));
 $('tt').textContent='annotation-station — '+PR.find(p=>p.id===mode).h;
 cache.clear();fcache.clear();playing=true;$('play').textContent='⏸ Pause';panel(it);enter('annotate')});
$('lg').innerHTML=Object.keys(CN).filter(k=>k!=='0').map(k=>
 `<span><i style="background:rgb(${CC[k]})"></i>${CN[k]}</span>`).join('');
$('play').onclick=()=>{if(qi>=ITS.length-1&&stage==='evaluate'&&!playing){qi=0;it=ITS[0].iter;enter('select')}
 playing=!playing;$('play').textContent=playing?'⏸ Pause':'▶ Play'};
$('step').onclick=()=>{playing=false;$('play').textContent='▶ Play';adv()};
$('rst').onclick=()=>{qi=0;it=ITS[0].iter;cache.clear();panel(it);enter('select');playing=false;$('play').textContent='▶ Play'};
$('spd').oninput=e=>spd=+e.target.value;
$('outside').onchange=e=>{showOut=e.target.checked};
$('theme').onclick=()=>{const r=document.documentElement,
 c=r.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
 r.setAttribute('data-theme',c==='dark'?'light':'dark');curve(it)};
addEventListener('resize',()=>{curve(it);drawPanels()});
$('tt').textContent='annotation-station — '+PR.find(p=>p.id===mode).h;
panel(it);enter('select');requestAnimationFrame(loop);
if(!reduce){playing=true;$('play').textContent='⏸ Pause'}
/* ?debug=1 -> live readout of the loop state, bottom-left. For diagnosing a frozen page. */
{const dbg=document.createElement('div');dbg.hidden=true;
 addEventListener('keydown',e=>{if(e.key==='d'||e.key==='D')dbg.hidden=!dbg.hidden});
 dbg.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99;font:11px/1.45 ui-monospace,monospace;background:rgba(0,0,0,.86);color:#9fe9f3;padding:7px 9px;border-radius:6px;white-space:pre;pointer-events:none';
 document.body.appendChild(dbg);
 let rafN=0;const _r=window.requestAnimationFrame.bind(window);
 window.requestAnimationFrame=cb=>_r(ts=>{rafN++;cb(ts)});
 const errs=[];addEventListener('error',e=>errs.push(e.message+' @'+e.lineno));
 const _ce=console.error;console.error=function(){errs.push([...arguments].map(x=>x&&x.message||String(x)).join(' '));_ce.apply(console,arguments)};
 setInterval(()=>{const t=sub&&stage==='annotate'?ITS[qi].queue[sub.k]:null;
  dbg.textContent=`playing=${playing}  reduce-motion=${reduce}  frames=${rafN}\n`
   +`stage=${stage}  phase=${sub?sub.ph:'-'}  t=${sub?Math.round(sub.t):'-'}  tile#=${sub&&sub.k!=null?sub.k:'-'}\n`
   +`camera=${camSlide||'pool'}  tile=${t?t.name.slice(0,22):'-'}\n`
   +`loaded: wall=${!!imgs.get('wall')}  slide=${camSlide?!!imgs.get('m:'+camSlide):'-'}  preview=${sub?!!(sub.navMid||sub.mid):'-'}\n`
   +`last error: ${errs.length?errs[errs.length-1].slice(0,90):'none'}`},250)}
