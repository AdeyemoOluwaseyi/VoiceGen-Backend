document.addEventListener('DOMContentLoaded', function(){
(function(){
var FC={apiKey:"AIzaSyAU32QyPM-GE6EGmKBZvzVukFI8Mn4zpkc",authDomain:"voicegen-11174.firebaseapp.com",projectId:"voicegen-11174",storageBucket:"voicegen-11174.firebasestorage.app",messagingSenderId:"823672984612",appId:"1:823672984612:web:7a3a57d0d853851ed3b4b1"};
var MK="sk-cp-bksrN1xaAxbb5PVvAFj2Eg2TbFzSH4KIS1VQiFOmBJGEm0u8-c6khKGySWKZEhp11ldbX0pf5x6NsSJfezfCkkAWmTQEMnM7NXuqGLn2HesAkuUQYpb00zM";
var BACKEND = "https://voicegen-production-0b6b.up.railway.app"; 
var userCredits = 0;
var userVirtualAccounts = [];
firebase.initializeApp(FC);
var auth=firebase.auth(),db=firebase.firestore(),prov=new firebase.auth.GoogleAuthProvider();
var VOICES=[
{id:"female-shaonv", name:"Seraphine", meta:"Calm · Female"},
{id:"male-qn-jingying", name:"Orion", meta:"Deep · Male"},
{id:"male-qn-qingse", name:"Elliot", meta:"Gentle · Male"},
{id:"female-tianmei", name:"Yuki", meta:"Bright · Female"},
{id:"female-chengshu", name:"Solène", meta:"Warm · Female"},
{id:"presenter-male", name:"Atlas", meta:"Cinematic · Male"},
{id:"audiobook-male-1", name:"Narrator", meta:"Audiobook · Male"},
{id:"radio-male", name:"Broadcast", meta:"Podcast · Male"},
{id:"female-yujie", name:"Aria", meta:"Professional · Female"},
{id:"audiobook-female-1",name:"Sophia", meta:"Audiobook · Female"},
{id:"story-male", name:"Marcus", meta:"Story · Male"},
{id:"story-female", name:"Luna", meta:"Story · Female"}
];
var user=null,selVoice=VOICES[0].id,cloned=[],history=[],lastBlob=null,stTimer;
function $(id){return document.getElementById(id);}
function showStatus(msg,type){var b=$("vg-status");b.textContent=msg;b.className="vg-status show "+(type||"");clearTimeout(stTimer);stTimer=setTimeout(function(){b.classList.remove("show");},3500);}
auth.onAuthStateChanged(function(u){
if(u){
user=u;
$("vg-land").style.display="none";
$("vg-app").style.display="block";
$("vg-uname").textContent=u.displayName||u.email;
$("vg-uemail").textContent=u.email;
if(u.photoURL)$("vg-avatar").src=u.photoURL;
renderVoices();loadHistory();
setupAccount(u);
} else {
user=null;
$("vg-land").style.display="flex";
$("vg-app").style.display="none";
}
$("vg-signinbtn").onclick=function(){auth.signInWithPopup(prov).catch(function(e){showStatus("Sign-in failed: "+e.message,"err");});};
$("vg-signout").onclick=function(){auth.signOut();};
function isMobile(){return window.innerWidth<=768;}
$("vg-hamburger").onclick=function(){
var sb=$("vg-sidebar"),ov=$("vg-overlay"),mn=$("vg-main-wrap");
var opening=!sb.classList.contains("open");
sb.classList.toggle("open");
if(!isMobile()){
document.getElementById("vg-main-wrap").classList.toggle("shifted");
} else {
ov.classList.toggle("show");
}
};
$("vg-overlay").onclick=function(){
$("vg-sidebar").classList.remove("open");
$("vg-overlay").classList.remove("show");
};
document.addEventListener("click",function(e){
var sb=$("vg-sidebar");
var hb=$("vg-hamburger");
if(sb.classList.contains("open")&&!sb.contains(e.target)&&!hb.contains(e.target)&&!isMobile()){
sb.classList.remove("open");
document.getElementById("vg-main-wrap").classList.remove("shifted");
}
});
var pageTitles={generate:["Text to Speech","Paste your script, pick a voice and generate"],clone:["Clone Voices","Upload a sample to create your own custom voice"],history:["Generation History","Your past voiceover generations"],topup:["Buy Credits with Transfer","Top up via Nigerian bank transfer"],crypto:["Buy Credits with Crypto","Pay with USDT — instant global credit top-up"],referral:["Referral Program","Earn 5% lifetime commission on every referral"]};
document.querySelectorAll(".vg-sb-item[data-tab]").forEach(function(btn){
btn.onclick=function(){
var tab=btn.dataset.tab;
document.querySelectorAll(".vg-sb-item").forEach(function(b){b.classList.remove("active");});
document.querySelectorAll(".vg-tc").forEach(function(c){c.classList.remove("active");});
btn.classList.add("active");
$("vg-tc-"+tab).classList.add("active");
var info=pageTitles[tab]||["VoiceGen",""];
$("vg-pagetitle").textContent=info[0];
$("vg-pagesub").textContent=info[1];
if(tab==="history")renderHistory();
if(tab==="clone")renderCloned();
$("vg-sidebar").classList.remove("open");
$("vg-overlay").classList.remove("show");
if(!isMobile()) document.getElementById("vg-main-wrap").classList.remove("shifted");
};
});
var previewCache = {};
var previewAudio = null;
var PREVIEW_TEXT = "Hello, my name is {name}. What would you love to create today?";
async function getToken(){
return user ? await user.getIdToken() : null;
}
async function setupAccount(u){
try {
var token = await u.getIdToken(true); 
console.log("Calling setup-account...");
var res = await fetch(BACKEND+"/api/setup-account",{
method:"POST",
headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"}
});
var data = await res.json();
console.log("Setup response:", data);
if(data.success){
userCredits = data.data.credits || 0;
userVirtualAccounts = data.data.virtualAccount || [];
renderCreditsBar();
var bc = document.getElementById("vg-big-credits");
if(bc) bc.textContent = userCredits.toLocaleString();
} else {
console.warn("Setup failed:", data);
setTimeout(function(){ setupAccount(u); }, 3000);
}
} catch(e){
console.warn("Setup error:",e);
setTimeout(function(){ setupAccount(u); }, 5000);
}
loadBalance();
}
async function loadBalance(){
try {
var token = await getToken();
var res = await fetch(BACKEND+"/api/balance",{
headers:{"Authorization":"Bearer "+token}
});
var data = await res.json();
userCredits = data.credits || 0;
userVirtualAccounts = data.virtualAccount || [];
renderCreditsBar();
var bc = document.getElementById("vg-big-credits");
if(bc) bc.textContent = userCredits.toLocaleString();
} catch(e){ console.warn("Balance error:",e); }
}
function renderCreditsBar(){
var el = document.getElementById("vg-credits-display");
if(el) el.textContent = userCredits.toLocaleString()+" credits";
var bar = document.getElementById("vg-credits-bar");
if(bar){
var pct = Math.min(100, (userCredits/500)*100);
bar.style.width = pct+"%";
}
}
function renderVoices(){
var g=$("vg-vgrid");g.innerHTML="";
var all=VOICES.concat(cloned.map(function(v){return{id:v.vid,name:v.name,meta:"Cloned · Custom"};}));
all.forEach(function(v){
var c=document.createElement("div");c.className="vg-vcard"+(v.id===selVoice?" sel":"");
var hasPreview=VOICES.some(function(bv){return bv.id===v.id;});
c.innerHTML='<div class="vg-vname">'+v.name+'</div><div class="vg-vmeta">'+v.meta+'</div>'+(hasPreview?'<button class="vg-vprev" title="Preview voice">&#9654;</button>':'')+'<div class="vg-vdot"></div>';
c.onclick=function(e){
if(e.target.classList.contains("vg-vprev"))return;
selVoice=v.id;
document.querySelectorAll(".vg-vcard").forEach(function(x){x.classList.remove("sel");});
c.classList.add("sel");
};
if(hasPreview){
c.querySelector(".vg-vprev").onclick = async function(e){
e.stopPropagation();
var btn = this;
if (previewAudio && !previewAudio.paused) {
previewAudio.pause(); previewAudio = null;
document.querySelectorAll(".vg-vprev").forEach(function(b){b.innerHTML="&#9654;";b.style.background="";b.disabled=false;});
return;
}
document.querySelectorAll(".vg-vprev").forEach(function(b){b.innerHTML="&#9654;";b.style.background="";});
if (previewCache[v.id]) {
if(previewAudio){ previewAudio.pause(); previewAudio=null; }
previewAudio = new Audio(previewCache[v.id]);
previewAudio.volume = 1.0;
previewAudio.play().catch(function(){});
btn.innerHTML = "&#9646;&#9646;"; btn.style.background = "#c9a84c";
previewAudio.onended = function(){btn.innerHTML="&#9654;";btn.style.background="";previewAudio=null;};
showStatus("Previewing " + v.name + "...", "");
return;
}
btn.innerHTML = "..."; btn.style.background = "#ddd"; btn.disabled = true;
showStatus("Loading preview for " + v.name + "...", "");
try {
var ptext = PREVIEW_TEXT.replace("{name}", v.name);
var res = await fetch("https://api.minimaxi.chat/v1/t2a_v2", {
method: "POST",
headers: {"Content-Type":"application/json","Authorization":"Bearer "+MK},
body: JSON.stringify({model:"speech-01-hd",text:ptext,stream:false,voice_setting:{voice_id:v.id,speed:1.0,vol:1.0,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:"mp3"}})
});
var data = await res.json();
if (data.data && data.data.audio) {
var dataUrl = "data:audio/mp3;base64," + data.data.audio;
previewCache[v.id] = dataUrl;
if(previewAudio){ previewAudio.pause(); previewAudio=null; }
previewAudio = new Audio(dataUrl);
previewAudio.volume = 1.0;
var playPromise = previewAudio.play();
if(playPromise !== undefined){
playPromise.then(function(){
btn.innerHTML = "&#9646;&#9646;"; btn.style.background = "#c9a84c"; btn.disabled = false;
}).catch(function(e){
console.warn("Autoplay blocked:", e);
btn.innerHTML = "&#9654;"; btn.style.background = "#c9a84c"; btn.disabled = false;
showStatus("Tap play button to hear " + v.name, "");
});
} else {
btn.innerHTML = "&#9646;&#9646;"; btn.style.background = "#c9a84c"; btn.disabled = false;
}
previewAudio.onended = function(){btn.innerHTML="&#9654;";btn.style.background="";previewAudio=null;};
} else {
throw new Error(data.base_resp&&data.base_resp.status_msg?data.base_resp.status_msg:"Preview failed");
}
} catch(err) {
btn.innerHTML = "&#9654;"; btn.style.background = ""; btn.disabled = false;
showStatus("Preview failed: " + err.message, "err");
}
};
}
g.appendChild(c);
});
}
$("vg-script").oninput=function(){$("vg-chars").textContent=this.value.length+" / 30,000";};
$("vg-speed").oninput=function(){$("vg-speedval").textContent=parseFloat(this.value).toFixed(1)+"×";};
function splitText(text, maxLen) {
maxLen = maxLen || 4800;
if (text.length <= maxLen) return [text];
var chunks = [], cur = "";
var sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*/g) || [text];
for (var i = 0; i < sentences.length; i++) {
var s = sentences[i];
if ((cur + s).length > maxLen && cur.length > 0) {
chunks.push(cur.trim());
cur = s;
} else {
cur += s;
}
}
if (cur.trim()) chunks.push(cur.trim());
return chunks;
}
async function generateChunk(text, voiceId, speed) {
var res = await fetch("https://api.minimaxi.chat/v1/t2a_v2", {
method: "POST",
headers: {"Content-Type":"application/json","Authorization":"Bearer "+MK},
body: JSON.stringify({
model: "speech-01-hd", text: text, stream: false,
voice_setting: {voice_id: voiceId, speed: speed, vol: 1.0, pitch: 0},
audio_setting: {sample_rate: 32000, bitrate: 128000, format: "mp3"}
})
});
var data = await res.json();
if (data.data && data.data.audio) {
return Uint8Array.from(atob(data.data.audio), function(c){return c.charCodeAt(0);});
}
throw new Error(data.base_resp && data.base_resp.status_msg ? data.base_resp.status_msg : "Generation failed");
}
function mergeUint8Arrays(arrays) {
var total = arrays.reduce(function(s,a){return s+a.length;}, 0);
var out = new Uint8Array(total), offset = 0;
arrays.forEach(function(a){out.set(a, offset); offset += a.length;});
return out;
}
$("vg-genbtn").onclick = async function(){
var text = $("vg-script").value.trim();
if (!text) { showStatus("Please enter some text first.", "err"); return; }
var cost = text.length;
if(userCredits < cost){
showStatus("Not enough credits. You need "+cost.toLocaleString()+" but have "+userCredits.toLocaleString()+". Please top up.", "err");
switchToTopup();
return;
}
var speed = parseFloat($("vg-speed").value);
var btn = $("vg-genbtn");
btn.disabled = true;
var chunks = splitText(text, 4800);
var audioArrays = [];
try {
for (var i = 0; i < chunks.length; i++) {
btn.innerHTML = '<span class="vg-spinner"></span> Generating part ' + (i+1) + ' of ' + chunks.length + '...';
var arr = await generateChunk(chunks[i], selVoice, speed);
audioArrays.push(arr);
}
var merged = mergeUint8Arrays(audioArrays);
lastBlob = new Blob([merged], {type:"audio/mp3"});
var url = URL.createObjectURL(lastBlob);
var pl=$("vg-player");pl.src=url;$("vg-audiores").classList.add("show");pl.load();setTimeout(function(){pl.play().catch(function(){});},300);
var vn = VOICES.concat(cloned.map(function(v){return{id:v.vid,name:v.name};})).find(function(v){return v.id===selVoice;});
await saveHistory(text, vn ? vn.name : selVoice, url);
try {
var token = await getToken();
var dr = await fetch(BACKEND+"/api/deduct-credits",{
method:"POST",
headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
body:JSON.stringify({characters:text.length, voiceName:vn?vn.name:selVoice})
});
var dd = await dr.json();
if(dd.remaining !== undefined){ userCredits = dd.remaining; renderCreditsBar(); }
} catch(e){ console.warn("Deduct error:",e); }
showStatus("Voiceover ready!", "ok");
} catch(e) {
showStatus("Error: " + e.message, "err");
} finally {
btn.disabled = false;
btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><polygon points="5,3 15,9 5,15" fill="currentColor"/></svg> Generate Voiceover';
}
};
$("vg-dlbtn").onclick=function(){if(!lastBlob)return;var a=document.createElement("a");a.href=URL.createObjectURL(lastBlob);a.download="voicegen_"+Date.now()+".mp3";a.click();};
async function saveHistory(text, vname, url){
if(!user) return;
try {
var audioData = url;
if(url && url.startsWith("blob:")){
try {
var resp = await fetch(url);
var blob = await resp.blob();
audioData = await new Promise(function(res){
var reader = new FileReader();
reader.onloadend = function(){ res(reader.result); };
reader.readAsDataURL(blob);
});
} catch(ex){ console.warn("blob convert failed:", ex); }
}
var entry = { text:text.slice(0,300), voiceName:vname, audioData:audioData, createdAt:firebase.firestore.FieldValue.serverTimestamp() };
var docRef = await db.collection("users").doc(user.uid).collection("history").add(entry);
history.unshift({ id:docRef.id, text:entry.text, voiceName:vname, audioUrl:audioData, createdAt:new Date() });
} catch(e){ console.warn("History save failed:", e); }
});history.unshift({text:text.slice(0,300),voiceName:vname,audioUrl:url,createdAt:new Date()});}
catch(e){console.warn(e);}
}
async function loadHistory(){
if(!user) return;
try {
var snap = await db.collection("users").doc(user.uid).collection("history")
.orderBy("createdAt","desc").limit(50).get();
history = snap.docs.map(function(d){
var data = d.data();
var audio = data.audioData || data.audioUrl || "";
return { id:d.id, text:data.text||"", voiceName:data.voiceName||"", audioUrl:audio, createdAt:data.createdAt&&data.createdAt.toDate?data.createdAt.toDate():new Date() };
});
} catch(e){ console.warn("History load failed:", e); }
},d.data(),{createdAt:d.data().createdAt&&d.data().createdAt.toDate?d.data().createdAt.toDate():new Date()});});}
catch(e){console.warn(e);}
}
function renderHistory(){
var list=$("vg-hlist");
if(!history.length){list.innerHTML='<div class="vg-empty"><div class="big">♪</div><p>No generations yet.</p></div>';return;}
list.innerHTML=history.map(function(item,i){
var audio = item.audioUrl || item.audioData || "";
return '<div class="vg-hitem"><div class="vg-hicon">♪</div><div class="vg-hinfo"><div class="vg-htxt">'+item.text+'</div><div class="vg-hmeta">'+item.voiceName+' · '+(item.createdAt?item.createdAt.toLocaleDateString():'Recently')+'</div></div>'+(audio?'<button class="vg-hact" onclick="vgPlay('+i+')" title="Play">▶</button><a class="vg-hact" href="'+audio+'" download="voicegen_'+i+'.mp3" title="Download">↓</a>':'')+'</div>';
}).join("");
}
async function loadTransactions(){
var el = document.getElementById("vg-txn-list");
if(!el) return;
try {
var token = await getToken();
var res = await fetch(BACKEND+"/api/transactions",{headers:{"Authorization":"Bearer "+token}});
var data = await res.json();
var txns = data.transactions || [];
if(!txns.length){
el.innerHTML = '<div style="text-align:center;color:#bbb;font-size:13px;padding:20px;">No transactions yet.</div>';
return;
}
el.innerHTML = txns.map(function(t){
var isCredit = t.type==="credit";
var date = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "";
return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f0;">'+
'<div style="width:36px;height:36px;border-radius:10px;background:'+( isCredit?"#e8f8f0":"#fff0f0")+';display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">'+( isCredit?"↑":"↓")+'</div>'+
'<div style="flex:1;overflow:hidden;">'+
'<div style="font-size:13px;font-weight:500;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+t.note+'</div>'+
'<div style="font-size:11px;color:#bbb;margin-top:2px;">'+date+'</div>'+
'</div>'+
'<div style="font-size:14px;font-weight:700;color:'+( isCredit?"#27ae60":"#e74c3c")+';flex-shrink:0;">'+( isCredit?"+":"")+Math.abs(t.amount).toLocaleString()+'</div>'+
'</div>';
}).join("");
} catch(e){ if(el) el.innerHTML='<div style="color:#bbb;font-size:13px;padding:20px;text-align:center;">Failed to load transactions.</div>'; }
}
function renderCloned(){
var list=$("vg-clonedlist");
if(!cloned.length){list.innerHTML='<div class="vg-empty"><div class="big">🎙</div><p>No cloned voices yet.<br><small style="color:#bbb;">Cloned voices appear automatically in Text to Speech.</small></p></div>';return;}
list.innerHTML=cloned.map(function(v){return'<div class="vg-cloneditem"><div style="width:36px;height:36px;background:linear-gradient(135deg,#1a1a1a,#333);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#c9a84c;font-size:16px;flex-shrink:0;">🎙</div><div class="nm">'+v.name+'<div style="font-size:11px;color:#bbb;margin-top:2px;">Cloned · Custom</div></div><button class="vg-usebtn" onclick="vgUseCloned(\''+v.vid+'\',\''+v.name+'\')">Use in TTS</button></div>';}).join("");
}
list.innerHTML=cloned.map(function(v){return'<div class="vg-cloneditem"><div class="nm">'+v.name+'</div><button class="vg-usebtn" onclick="vgUseCloned(\''+v.vid+'\',\''+v.name+'\')">Use Voice</button></div>';}).join("");
}
window.vgUseCloned=function(id,name){
selVoice=id;renderVoices();
document.querySelectorAll(".vg-sb-item").forEach(function(b){b.classList.remove("active");});
document.querySelectorAll(".vg-tc").forEach(function(c){c.classList.remove("active");});
document.querySelector('[data-tab="generate"]').classList.add("active");
$("vg-tc-generate").classList.add("active");
$("vg-pagetitle").textContent="Generate Voiceover";
$("vg-pagesub").textContent="Paste your script and pick a voice";
showStatus('Voice set to "'+name+'".','ok');
};
(function(){
var urlParams = new URLSearchParams(window.location.search);
var ref = urlParams.get("ref");
if(ref) localStorage.setItem("vg-ref", ref);
})();
var userReferralCode = "";
var userReferralEarnings = 0;
var userReferralCount = 0;
var currentCryptoPayment = null;
var selectedCryptoPkg = {usd:5, credits:50000};
var _origSetup = setupAccount;
async function setupAccount(u){
try {
var refCode = localStorage.getItem("vg-ref") || "";
var token = await u.getIdToken(true);
var res = await fetch(BACKEND+"/api/setup-account",{
method:"POST",
headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
body: JSON.stringify({ refCode })
});
var data = await res.json();
if(data.success){
userCredits = data.data.credits||0;
userVirtualAccounts = data.data.virtualAccount||[];
userReferralCode = data.data.referralCode||"";
userReferralEarnings = data.data.referralEarningsNGN||0;
userReferralCount = data.data.referralCount||0;
renderCreditsBar();
if(refCode) localStorage.removeItem("vg-ref");
} else {
setTimeout(function(){ setupAccount(u); }, 3000);
}
} catch(e){
console.warn("Setup error:",e);
setTimeout(function(){ setupAccount(u); }, 5000);
}
loadBalance();
}
async function loadBalance(){
try {
var token = await getToken();
var res = await fetch(BACKEND+"/api/balance",{headers:{"Authorization":"Bearer "+token}});
var data = await res.json();
userCredits = data.credits||0;
userVirtualAccounts = data.virtualAccount||[];
userReferralCode = data.referralCode||"";
userReferralEarnings = data.referralEarningsNGN||0;
userReferralCount = data.referralCount||0;
renderCreditsBar();
var bc = document.getElementById("vg-big-credits");
if(bc) bc.textContent = userCredits.toLocaleString();
if(!userReferralCode && user){
console.log("No referral code found, triggering setup...");
setupAccount(user);
}
var refEl = $("ref-link-display");
if(refEl && refEl.textContent !== "Loading..." && userReferralCode){
refEl.textContent = getReferralLink();
}
} catch(e){ console.warn("Balance error:",e); }
}
document.querySelectorAll(".crypto-pkg").forEach(function(pkg){
pkg.onclick = function(){
document.querySelectorAll(".crypto-pkg").forEach(function(p){
p.style.border = "1.5px solid #ebebeb";
p.style.background = "";
});
this.style.border = "2px solid #c9a84c";
this.style.background = "#fffdf7";
selectedCryptoPkg = {
usd: parseFloat(this.dataset.usd),
credits: parseInt(this.dataset.credits)
};
};
});
window.initCryptoPayment = async function(){
var btn = $("crypto-pay-btn");
btn.disabled = true;
btn.innerHTML = '<span class="vg-spinner"></span> Creating payment...';
try {
var token = await getToken();
var res = await fetch(BACKEND+"/api/create-crypto-payment",{
method:"POST",
headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
body:JSON.stringify({ amountUSD: selectedCryptoPkg.usd, creditsAmount: selectedCryptoPkg.credits })
});
var data = await res.json();
if(data.success){
currentCryptoPayment = data;
$("crypto-amount-display").textContent = data.payAmount+" "+data.payCurrency.toUpperCase();
$("crypto-address-display").textContent = data.payAddress;
$("crypto-payment-box").style.display = "block";
$("crypto-payment-box").scrollIntoView({behavior:"smooth"});
showStatus("Send exactly "+data.payAmount+" USDT to the address shown", "ok");
} else {
throw new Error(data.error||"Payment creation failed");
}
} catch(e){
showStatus("Error: "+e.message, "err");
} finally {
btn.disabled = false;
btn.innerHTML = "Pay with USDT";
}
};
window.copyCryptoAddress = function(){
var addr = $("crypto-address-display").textContent;
navigator.clipboard.writeText(addr).then(function(){
showStatus("Address copied!", "ok");
}).catch(function(){
showStatus("Copy failed — please copy manually", "err");
});
};
window.cancelCryptoPayment = function(){
currentCryptoPayment = null;
$("crypto-payment-box").style.display = "none";
};
window.checkCryptoStatus = async function(){
if(!currentCryptoPayment) return;
showStatus("Checking payment status...", "");
try {
await loadBalance();
showStatus("Balance refreshed. If payment confirmed, credits appear above.", "ok");
} catch(e){ showStatus("Check failed: "+e.message, "err"); }
};
function getReferralLink(){
var base = window.location.origin + window.location.pathname;
return base + "?ref=" + userReferralCode;
}
window.copyRefLink = function(){
var link = getReferralLink();
navigator.clipboard.writeText(link).then(function(){
showStatus("Referral link copied!", "ok");
}).catch(function(){
showStatus("Copy failed", "err");
});
};
async function renderReferralTab(){
var el = $("ref-link-display");
if(el){
if(userReferralCode){
el.textContent = getReferralLink();
el.style.color = "";
} else {
el.textContent = "Generating your link...";
el.style.color = "#bbb";
loadBalance().then(function(){
var el2 = $("ref-link-display");
if(el2) el2.textContent = userReferralCode ? getReferralLink() : "Please sign out and sign in again";
if(el2 && userReferralCode) el2.style.color = "";
});
}
}
var cnt = $("ref-count-display");
if(cnt) cnt.textContent = userReferralCount||0;
var earn = $("ref-earnings-display");
if(earn) earn.textContent = "₦"+(userReferralEarnings||0).toLocaleString();
var bal = $("ref-balance-display");
if(bal) bal.textContent = "₦"+(userReferralEarnings||0).toLocaleString();
loadReferralEarnings();
}
async function loadReferralEarnings(){
var list = $("ref-earnings-list");
if(!list) return;
try {
var token = await getToken();
var res = await fetch(BACKEND+"/api/referral-earnings",{headers:{"Authorization":"Bearer "+token}});
var data = await res.json();
var earnings = data.earnings||[];
if(!earnings.length){
list.innerHTML = '<div class="vg-empty"><div class="big">💰</div><p>No earnings yet. Share your link!</p></div>';
return;
}
list.innerHTML = earnings.map(function(e){
var date = e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "";
return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f0;">'+
'<div style="width:36px;height:36px;background:#e8f8f0;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">💰</div>'+
'<div style="flex:1;"><div style="font-size:13px;font-weight:500;color:#1a1a1a;">'+e.note+'</div><div style="font-size:11px;color:#bbb;margin-top:2px;">'+date+'</div></div>'+
'<div style="font-size:14px;font-weight:700;color:#27ae60;">+₦'+e.amountNGN.toLocaleString()+'</div></div>';
}).join("");
} catch(ex){ if(list) list.innerHTML='<div class="vg-empty"><p>Failed to load earnings.</p></div>'; }
}
var verifyTimer = null;
var accountVerified = false;
window.onBankChange = function(){
accountVerified = false;
$("wd-btn").disabled = true;
$("wd-btn").style.opacity = "0.4";
var acctNum = $("wd-acct-num").value.trim();
if(acctNum.length===10) verifyAccount();
};
window.onAccountNumberInput = function(){
accountVerified = false;
$("wd-btn").disabled = true;
$("wd-btn").style.opacity = "0.4";
$("wd-acct-name").value = "";
$("wd-acct-name-text").textContent = "Auto-filled after verification";
$("wd-acct-name-text").style.color = "#bbb";
clearTimeout(verifyTimer);
var acctNum = $("wd-acct-num").value.trim();
if(acctNum.length===10){
verifyTimer = setTimeout(verifyAccount, 800);
}
};
async function verifyAccount(){
var bankCode = $("wd-bank").value;
var acctNum = $("wd-acct-num").value.trim();
if(!bankCode){ showStatus("Please select a bank first","err"); return; }
if(acctNum.length!==10){ return; }
$("wd-verify-spinner").style.display = "inline-block";
$("wd-acct-name-text").textContent = "Verifying...";
$("wd-acct-name-text").style.color = "#888";
try {
var token = await getToken();
var res = await fetch(BACKEND+"/api/verify-account",{
method:"POST",
headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
body:JSON.stringify({ bankCode, accountNumber:acctNum })
});
var data = await res.json();
if(data.success && data.accountName){
$("wd-acct-name").value = data.accountName;
$("wd-acct-name-text").textContent = "✓ "+data.accountName;
$("wd-acct-name-text").style.color = "#27ae60";
$("wd-acct-name-display").style.borderColor = "#27ae60";
accountVerified = true;
$("wd-btn").disabled = false;
$("wd-btn").style.opacity = "1";
} else {
throw new Error(data.error||"Account not found");
}
} catch(e){
$("wd-acct-name-text").textContent = "✗ "+e.message;
$("wd-acct-name-text").style.color = "#e74c3c";
$("wd-acct-name-display").style.borderColor = "#e74c3c";
accountVerified = false;
$("wd-btn").disabled = true;
$("wd-btn").style.opacity = "0.4";
} finally {
$("wd-verify-spinner").style.display = "none";
}
}
var withdrawCurrency = "NGN";
var liveUsdRate = 0; 
async function fetchLiveRate(){
try {
var res = await fetch("https://open.er-api.com/v6/latest/USD");
var data = await res.json();
if(data.rates && data.rates.NGN){
liveUsdRate = data.rates.NGN;
var el = $("wd-rate-display");
if(el) el.textContent = "Live rate: $1 USD = ₦"+liveUsdRate.toLocaleString()+" (updated just now)";
updateUsdEquiv();
updateBalanceUsd();
}
} catch(e){
var el = $("wd-rate-display");
if(el) el.textContent = "Rate unavailable — using ₦1,600/$1 estimate";
liveUsdRate = 1600;
}
}
function updateBalanceUsd(){
var el = $("ref-balance-usd");
if(el && liveUsdRate>0){
var usd = (userReferralEarnings / liveUsdRate).toFixed(2);
el.textContent = "≈ $"+usd+" USD";
}
}
function updateUsdEquiv(){
var amtEl = $("wd-amount");
var equivEl = $("wd-amount-equiv");
if(!amtEl||!equivEl) return;
var amt = parseFloat(amtEl.value)||0;
if(withdrawCurrency==="NGN" && liveUsdRate>0 && amt>0){
equivEl.textContent = "≈ $"+(amt/liveUsdRate).toFixed(2)+" USD at live rate";
} else if(withdrawCurrency==="USD" && liveUsdRate>0 && amt>0){
equivEl.textContent = "≈ ₦"+(amt*liveUsdRate).toLocaleString()+" NGN at live rate";
} else {
equivEl.textContent = "";
}
}
window.setWithdrawCurrency = function(currency){
withdrawCurrency = currency;
var ngnBtn = $("wd-ngn-btn");
var usdBtn = $("wd-usd-btn");
var ngnFields = $("wd-ngn-fields");
var usdFields = $("wd-usd-fields");
var amtLabel = $("wd-amount-label");
var amtInput = $("wd-amount");
var noteEl = $("wd-note");
var wdBtn = $("wd-btn");
if(currency==="NGN"){
ngnBtn.style.background="#c9a84c"; ngnBtn.style.color="#111"; ngnBtn.style.borderColor="#c9a84c";
usdBtn.style.background="transparent"; usdBtn.style.color="#888"; usdBtn.style.borderColor="#ebebeb";
if(ngnFields) ngnFields.style.display="block";
if(usdFields) usdFields.style.display="none";
if(amtLabel) amtLabel.textContent="Amount (₦)";
if(amtInput) amtInput.placeholder="Min ₦10,000";
if(noteEl) noteEl.textContent="⏱ Withdrawals are processed within 20 hours. Your account name must match your registered name.";
accountVerified = false;
wdBtn.disabled=true; wdBtn.style.opacity="0.4";
} else {
usdBtn.style.background="#c9a84c"; usdBtn.style.color="#111"; usdBtn.style.borderColor="#c9a84c";
ngnBtn.style.background="transparent"; ngnBtn.style.color="#888"; ngnBtn.style.borderColor="#ebebeb";
if(ngnFields) ngnFields.style.display="none";
if(usdFields) usdFields.style.display="block";
if(amtLabel) amtLabel.textContent="Amount in Naira (converts to USDT)";
if(amtInput) amtInput.placeholder="Enter NGN amount to convert";
if(noteEl) noteEl.textContent="⏱ USDT sent to your wallet within 20 hours at live exchange rate.";
wdBtn.disabled=false; wdBtn.style.opacity="1";
}
updateUsdEquiv();
};
document.addEventListener("input", function(e){
if(e.target.id==="wd-amount") updateUsdEquiv();
});
window.requestWithdrawal = async function(){
var amount = parseFloat($("wd-amount").value);
if(!amount||amount<10000){ showStatus("Minimum withdrawal is ₦10,000","err"); return; }
if(amount>userReferralEarnings){ showStatus("Insufficient referral balance","err"); return; }
var btn = $("wd-btn");
btn.disabled=true; btn.style.opacity="0.6"; btn.textContent="Processing...";
try {
var token = await getToken();
var payload = { amount, currency: withdrawCurrency };
if(withdrawCurrency==="NGN"){
if(!accountVerified){ showStatus("Please verify your bank account first","err"); btn.disabled=false; btn.style.opacity="1"; btn.textContent="Request Withdrawal"; return; }
var bankSelect = $("wd-bank");
payload.bankName = bankSelect.options[bankSelect.selectedIndex].text;
payload.bankCode = bankSelect.value;
payload.accountNumber = $("wd-acct-num").value.trim();
payload.accountName = $("wd-acct-name").value.trim();
} else {
var wallet = $("wd-wallet").value.trim();
if(!wallet||!wallet.startsWith("T")||wallet.length<30){
showStatus("Please enter a valid USDT TRC20 wallet address (starts with T)","err");
btn.disabled=false; btn.style.opacity="1"; btn.textContent="Request Withdrawal";
return;
}
var usdAmount = liveUsdRate>0 ? (amount/liveUsdRate).toFixed(4) : null;
payload.walletAddress = wallet;
payload.usdAmount = usdAmount;
payload.rateUsed = liveUsdRate;
}
var res = await fetch(BACKEND+"/api/request-withdrawal",{
method:"POST",
headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
body:JSON.stringify(payload)
});
var data = await res.json();
if(data.success){
userReferralEarnings -= amount;
renderReferralTab();
if($("wd-bank")) $("wd-bank").value="";
if($("wd-acct-num")) $("wd-acct-num").value="";
if($("wd-acct-name")) $("wd-acct-name").value="";
if($("wd-wallet")) $("wd-wallet").value="";
$("wd-amount").value="";
$("wd-amount-equiv").textContent="";
accountVerified=false;
showStatus("Withdrawal requested! Processing within 20 hours.","ok");
} else { throw new Error(data.error||"Failed"); }
} catch(e){ showStatus("Error: "+e.message,"err"); }
finally{ btn.disabled=false; btn.style.opacity="1"; btn.textContent="Request Withdrawal"; }
};
var _origTabHandlers = document.querySelectorAll(".vg-sb-item[data-tab]");
_origTabHandlers.forEach(function(btn){
var origClick = btn.onclick;
btn.onclick = function(){
var tab = btn.dataset.tab;
document.querySelectorAll(".vg-sb-item").forEach(function(b){b.classList.remove("active");});
document.querySelectorAll(".vg-tc").forEach(function(c){c.classList.remove("active");});
btn.classList.add("active");
var tc = $("vg-tc-"+tab);
if(tc) tc.classList.add("active");
var info = pageTitles[tab]||["VoiceGen",""];
$("vg-pagetitle").textContent=info[0];
$("vg-pagesub").textContent=info[1];
if(tab==="history") renderHistory();
if(tab==="clone") renderCloned();
if(tab==="topup"){ renderTopup(); }
if(tab==="referral"){ renderReferralTab(); fetchLiveRate(); }
$("vg-sidebar").classList.remove("open");
$("vg-overlay").classList.remove("show");
if(!isMobile()) document.getElementById("vg-main-wrap").classList.remove("shifted");
};
});
var isDark = localStorage.getItem("vg-theme") === "dark";
function applyTheme(){
var wrap = document.getElementById("vg");
var btn = document.getElementById("vg-theme-btn");
var icon = document.getElementById("vg-theme-icon");
var lbl = document.getElementById("vg-theme-label");
if(isDark){
wrap.classList.add("dark-mode");
if(icon) icon.textContent = "☀️";
if(lbl) lbl.textContent = "Light";
} else {
wrap.classList.remove("dark-mode");
if(icon) icon.textContent = "🌙";
if(lbl) lbl.textContent = "Dark";
}
}
window.toggleTheme = function(){
isDark = !isDark;
localStorage.setItem("vg-theme", isDark ? "dark" : "light");
applyTheme();
renderCreditsBar();
var bc=document.getElementById("vg-big-credits");
if(bc && bc.textContent!=="—") bc.style.color = isDark?"#f0ece0":"#1a1a1a";
};
applyTheme();
})();
});
});
