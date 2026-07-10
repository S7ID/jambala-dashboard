import {readFileSync} from "node:fs";
const html=readFileSync("/Users/yash/jambala-dashboard/index.html","utf8");
const blob=html.match(/const ENC = "([^"]+)"/)[1];
const pw=readFileSync("/Users/yash/jambala-dashboard/.pw","utf8").trim();
const b64d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));   // exactly the browser path
const [s,i,c]=blob.split(".");
const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b64d(s),iterations:150000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64d(i)},key,b64d(c));
const d=JSON.parse(new TextDecoder().decode(pt));
console.log("✓ DECRYPT OK  gen:",d.gen);
console.log("  7d:",d.windows.last_7d,"\n  shopify7d:",d.shopify.last_7d);
console.log("  history days:",d.history.length,"last:",JSON.stringify(d.history[d.history.length-1]));
console.log("  funnel:",d.funnel.map(x=>x.stage+"="+x.count).join(" · "));
console.log("  alerts:",d.alerts.length," insights:",d.insights.length);
try{const k2=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b64d(s),iterations:150000,hash:"SHA-256"},await crypto.subtle.importKey("raw",new TextEncoder().encode("wrongpw"),"PBKDF2",false,["deriveKey"]),{name:"AES-GCM",length:256},false,["decrypt"]);await crypto.subtle.decrypt({name:"AES-GCM",iv:b64d(i)},k2,b64d(c));console.log("  ✗ wrong pw decrypted (BAD)");}catch(e){console.log("  ✓ wrong passphrase correctly rejected");}
