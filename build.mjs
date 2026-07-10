#!/usr/bin/env node
// Build the encrypted Jambala dashboard: read the live feed -> shape it -> AES-GCM encrypt -> inject into index.html
import { readFileSync, writeFileSync } from "node:fs";
const SRC = "/Users/yash/AffyMonitor/jambala_dashboard_data.json";
const INS = "/Users/yash/AffyMonitor/jambala_insights.md";
const TPL = "/Users/yash/jambala-dashboard/template.html";
const OUT = "/Users/yash/jambala-dashboard/index.html";
const PW  = readFileSync("/Users/yash/jambala-dashboard/.pw","utf8").trim();

const raw = JSON.parse(readFileSync(SRC,"utf8"));
const num = (v)=> (v==null||isNaN(v))?null:+v;
const esc = (s)=> String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ---- windows (today / yesterday / 7d / 30d) ----
const windows = {};
for (const k of ["today","yesterday","last_7d","last_30d"]){
  const a = ((raw.windows||{})[k]||{}).account_totals || {};
  const spend=num(a.spend), pur=num(a.purchases), clk=num(a.clicks);
  windows[k] = {
    spend, purchases: pur, roas: num(a.roas),
    impressions: num(a.impressions), clicks: clk, reach: num(a.reach),
    ctr: num(a.ctr_pct),
    cpa: (pur? spend/pur : null),
    cpc: (clk? spend/clk : null),
  };
}
// ---- shopify per window ----
const sw = (raw.shopify||{}).windows || {};
const shopify = {};
for (const k of ["today","yesterday","last_7d","last_30d"]){
  const w = sw[k]||{}; shopify[k] = { orders:num(w.orders), revenue:num(w.revenue), aov:num(w.aov) };
}
// ---- daily history (last 14 days) with rolling 7d ROAS ----
const byDay = new Map();
for (const p of (raw.history||[])){
  const d = new Date(p.ts); if(isNaN(d)) continue;
  const key = d.toISOString().slice(0,10);
  // each point's spend/purchases is that day's running total -> keep the max seen
  const cur = byDay.get(key) || {spend:0,purchases:0,roas:null};
  if(num(p.spend)!=null && p.spend>=cur.spend) cur.spend=+p.spend;
  if(num(p.purchases)!=null && p.purchases>=cur.purchases) cur.purchases=+p.purchases;
  if(num(p.roas)!=null) cur.roas=+p.roas;
  byDay.set(key,cur);
}
const days = [...byDay.entries()].sort((a,b)=>a[0]<b[0]?-1:1);
const fmtT = k=>{const d=new Date(k+"T12:00:00Z");return d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});};
const hist = days.map(([k,v],i)=>{
  let p7=0; for(let j=Math.max(0,i-6);j<=i;j++){ p7+=days[j][1].purchases||0; }  // rolling 7d purchases (momentum)
  return { t:fmtT(k), spend:+(v.spend||0).toFixed(2), purchases:v.purchases||0, purch7:p7 };
}).slice(-14);

// ---- funnel ----
const f = raw.funnel_7d || {};
const funnel = [
  {stage:"Page view", count:num(f.PageView)||0},
  {stage:"View content", count:num(f.ViewContent)||0},
  {stage:"Add to cart", count:num(f.AddToCart)||0},
  {stage:"Checkout", count:num(f.InitiateCheckout)||0},
  {stage:"Purchase", count:num(f.Purchase)||0},
];
const funnel_flags = (f.flags||[]).map(esc);

// ---- insights (parse the shared insights markdown) ----
let insights=[];
try{
  const md = readFileSync(INS,"utf8").split("\n");
  for(let l of md){ l=l.trim();
    if(l.startsWith("- ")){
      let t=esc(l.slice(2)).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/`([^`]+)`/g,"$1");
      insights.push(t);
    }
  }
}catch(e){}

const DATA = {
  gen: (raw.meta||{}).generated_at_label || "",
  windows, shopify, history:hist, funnel, funnel_flags,
  alerts: (raw.alerts||[]).map(a=>({level:a.level,text:esc(a.text)})),
  insights,
  thresholds: raw.thresholds||{},
};

// ---- encrypt (AES-GCM, PBKDF2-SHA256 150k) ----
const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", enc.encode(PW), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:150000,hash:"SHA-256"}, base, {name:"AES-GCM",length:256}, false, ["encrypt"]);
const ct = await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, enc.encode(JSON.stringify(DATA)));
const b64 = u=>Buffer.from(u).toString("base64");
const blob = [b64(salt), b64(iv), b64(new Uint8Array(ct))].join(".");

const html = readFileSync(TPL,"utf8").replace("__ENC_DATA__", blob);
writeFileSync(OUT, html);
console.log(`built index.html · ${DATA.history.length} days · ${DATA.insights.length} insights · ${(html.length/1024|0)}KB · window7d ROAS ${windows.last_7d.roas}`);
