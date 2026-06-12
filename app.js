/* ===========================================================
   ぼちゃんねる — app (router + rendering)
   =========================================================== */
(function () {
  "use strict";

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  const state = { view: "list", tab: "ikioi", threads: [], thread: null, search: "" };

  const root = $("#view");
  const elBack = $("#back");
  const elBrand = $("#brand");
  const elTitle = $("#hdrTitle");
  const elTabs = $("#tabs");
  const elBanner = $("#banner");
  const elSearch = $("#searchRow");

  // ---------------------------------------------------------
  // helpers
  // ---------------------------------------------------------
  function ageDays(ts){ return Math.max((Date.now()-ts)/86400000, 1/24); }
  function ikioi(t){ return Math.round(t.postCount / ageDays(t.createdAt) * 10) / 10; }
  function ikioiClass(v){ return v>=400 ? "fire" : v>=120 ? "hot" : ""; }
  function relTime(ts){
    const s=(Date.now()-ts)/1000;
    if(s<60) return "たった今";
    if(s<3600) return Math.floor(s/60)+"分前";
    if(s<86400) return Math.floor(s/3600)+"時間前";
    return Math.floor(s/86400)+"日前";
  }

  // render a post body: >>anchors, >quotes, urls
  function renderBody(text){
    const lines = String(text).split("\n");
    return lines.map(line => {
      let out = "";
      // tokenify by anchors / urls while escaping the rest
      const re = /(>>\d+(?:-\d+)?)|((?:https?:\/\/)[^\s]+)/g;
      let last = 0, m;
      const isQuote = /^\s*>(?!>)/.test(line);
      while ((m = re.exec(line))) {
        out += esc(line.slice(last, m.index));
        if (m[1]) {
          const n = m[1].replace(/^>>/, "");
          out += `<span class="anchor" data-anchor="${esc(n)}">${esc(m[1])}</span>`;
        } else if (m[2]) {
          out += `<a class="url" href="${esc(m[2])}" target="_blank" rel="noopener nofollow">${esc(m[2])}</a>`;
        }
        last = m.index + m[0].length;
      }
      out += esc(line.slice(last));
      return isQuote ? `<span class="gt">${out}</span>` : out;
    }).join("\n");
  }

  function parseName(name){
    // tripcode display: name#trip -> name + ◆hash (already-hashed names pass through)
    const i = name.indexOf("◆");
    if (i >= 0) return `${esc(name.slice(0,i))}<span class="trip">◆${esc(name.slice(i+1))}</span>`;
    return esc(name);
  }

  // count posts per uid in current thread for "many" highlight
  function uidCounts(posts){
    const c={}; posts.forEach(p=>c[p.uid]=(c[p.uid]||0)+1); return c;
  }

  // ---------------------------------------------------------
  // ROUTER
  // ---------------------------------------------------------
  function parseHash(){
    const h = location.hash.replace(/^#/, "");
    if (h.startsWith("/thread/")) return { name:"thread", id: decodeURIComponent(h.slice(8)) };
    if (h === "/new") return { name:"new" };
    return { name:"list" };
  }
  window.addEventListener("hashchange", route);

  async function route(){
    const r = parseHash();
    if (r.name === "thread") return showThread(r.id);
    if (r.name === "new") { showList(); openComposer({mode:"thread"}); return; }
    return showList();
  }

  // ---------------------------------------------------------
  // LIST VIEW
  // ---------------------------------------------------------
  async function showList(){
    state.view = "list";
    elBack.classList.remove("show");
    elBrand.style.display = "flex";
    elTitle.style.display = "none";
    elTabs.style.display = "flex";
    elBanner.style.display = "flex";
    $("#hdrSearch").style.display = "flex";
    window.scrollTo(0,0);

    root.innerHTML = `<div class="loading"><div class="spinner"></div>スレッドを読み込み中…</div>`;
    let threads;
    try { threads = await API.getThreads(); }
    catch(e){ root.innerHTML = errorBox(e); return; }
    state.threads = threads;
    paintBanner(threads);
    paintList();
  }

  function paintBanner(threads){
    const posts = threads.reduce((a,t)=>a+t.postCount,0);
    elBanner.innerHTML = `
      <div class="banner__icon">♪</div>
      <div class="banner__txt">
        <div class="banner__name">${esc(API.CONFIG.BOARD_NAME)}</div>
        <div class="banner__desc">ボカロP・リスナーが集う総合掲示板</div>
        <div class="banner__stats">
          <span>スレッド ${threads.length}</span>
          <span>書き込み ${posts}</span>
          ${API.isDemo() ? '<span style="color:#c8631a">● DEMOモード</span>' : '<span style="color:#1f8a4c">● LIVE</span>'}
        </div>
      </div>`;
  }

  function sortedThreads(){
    let ts = state.threads.slice();
    if (state.search){
      const q = state.search.toLowerCase();
      ts = ts.filter(t => t.title.toLowerCase().includes(q));
    }
    if (state.tab === "ikioi") ts.sort((a,b)=> ikioi(b)-ikioi(a));
    else if (state.tab === "new") ts.sort((a,b)=> b.createdAt - a.createdAt);
    else ts.sort((a,b)=> b.lastAt - a.lastAt); // recent activity
    return ts;
  }

  function paintTabs(){
    elTabs.innerHTML = [
      ["ikioi","勢い順"],["update","新着レス"],["new","新規スレ"],
    ].map(([k,label])=>`
      <button class="tab" role="tab" data-tab="${k}" aria-selected="${state.tab===k}">${label}</button>
    `).join("");
  }

  function paintList(){
    paintTabs();
    const ts = sortedThreads();
    if (!ts.length){
      root.innerHTML = `<div class="empty"><div class="em">🎤</div>${state.search?"該当するスレッドがありません":"まだスレッドがありません。<br>最初のスレを立ててみよう！"}</div>` + footer();
      return;
    }
    const rows = ts.map((t,i)=>{
      const v = ikioi(t);
      const fresh = Date.now()-t.lastAt < 1000*60*60*3;
      return `
      <div class="thread" data-id="${esc(t.id)}">
        <div class="thread__rank">${i+1}</div>
        <div class="thread__body">
          <div class="thread__title">${esc(t.title)}</div>
          <div class="thread__meta">
            <span class="thread__count">💬 ${t.postCount}</span>
            <span class="momentum ${ikioiClass(v)}">勢い ${v}</span>
            <span>${relTime(t.lastAt)}</span>
            ${fresh?'<span class="thread__new">NEW</span>':""}
          </div>
        </div>
      </div>`;
    }).join("");
    root.innerHTML = `<div class="list">${rows}</div>` + footer();
  }

  // ---------------------------------------------------------
  // THREAD VIEW
  // ---------------------------------------------------------
  async function showThread(id){
    state.view = "thread";
    elBack.classList.add("show");
    elBrand.style.display = "none";
    elTitle.style.display = "block";
    elTabs.style.display = "none";
    elBanner.style.display = "none";
    elSearch.classList.remove("open");
    $("#hdrSearch").style.display = "none";
    window.scrollTo(0,0);

    root.innerHTML = `<div class="loading"><div class="spinner"></div>読み込み中…</div>`;
    let t;
    try { t = await API.getThread(id); }
    catch(e){ root.innerHTML = errorBox(e); elTitle.textContent="スレッド"; return; }
    state.thread = t;
    elTitle.textContent = t.title;

    const counts = uidCounts(t.posts);
    const postsHtml = t.posts.map(p => postHtml(p, counts)).join("");
    const created = new Date(t.createdAt);
    root.innerHTML = `
      <div class="threadhead">
        <div class="threadhead__title">${esc(t.title)}</div>
        <div class="threadhead__meta">
          <span>全 ${t.postCount} レス</span>
          <span>勢い ${ikioi(t)}</span>
          <span>${created.getFullYear()}/${String(created.getMonth()+1).padStart(2,"0")}/${String(created.getDate()).padStart(2,"0")} 開始</span>
        </div>
      </div>
      <div class="posts">${postsHtml}</div>` + footer();
  }

  function postHtml(p, counts){
    const isOp = p.num === 1;
    const sage = /sage/i.test(p.email||"");
    const n = counts[p.uid]||1;
    const idCls = n>=3 ? "many" : "";
    const idTxt = n>1 ? `ID:${esc(p.uid)} (${n})` : `ID:${esc(p.uid)}`;
    const nameDisp = sage
      ? parseName(p.name)
      : `<a href="mailto:" onclick="return false" style="color:inherit">${parseName(p.name)}</a>`;
    return `
      <div class="post ${p.abone?"abone":""}" id="p${p.num}" data-num="${p.num}">
        <div class="post__head">
          <span class="post__num ${isOp?"op":""}" data-reply="${p.num}">${p.num}</span>
          <span class="post__name">${nameDisp}</span>
          ${sage?'<span class="post__sage">sage</span>':""}
          <span class="post__date">${esc(p.date)}</span>
          <span class="post__id ${idCls}" data-uid="${esc(p.uid)}">${idTxt}</span>
        </div>
        <div class="post__body">${p.abone?"あぼ〜ん":renderBody(p.body)}</div>
        <div class="post__foot">
          <span class="post__reply" data-reply="${p.num}">↩ 返信</span>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------
  // shared chrome
  // ---------------------------------------------------------
  function footer(){
    return `<div class="foot">
      ぼちゃんねる — Vocaloid BBS<br>
      ${API.isDemo()
        ? 'デモ表示中（ブラウザ内に保存）・ <a href="admin.html">管理画面</a>'
        : '<a href="admin.html">管理画面</a>'}
    </div>`;
  }
  function errorBox(e){
    return `<div class="empty"><div class="em">⚠️</div>${esc(e.message||"エラーが発生しました")}<br>
      <span style="font-size:12px;color:#93a1a3">時間をおいて再度お試しください</span></div>`;
  }

  // ---------------------------------------------------------
  // ANCHOR POPOVER
  // ---------------------------------------------------------
  let popEl = null;
  function showPopover(num, x, y){
    if (!state.thread) return;
    const p = state.thread.posts.find(q => q.num === Number(num));
    if (!p) return;
    hidePopover();
    popEl = document.createElement("div");
    popEl.className = "popover";
    const counts = uidCounts(state.thread.posts);
    popEl.innerHTML = postHtml(p, counts).replace('class="post ', 'class="pop-inner post ');
    document.body.appendChild(popEl);
    const r = popEl.getBoundingClientRect();
    let left = Math.min(x, window.innerWidth - r.width - 10);
    let top = y + 16;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 16);
    popEl.style.left = Math.max(8,left) + "px";
    popEl.style.top = top + "px";
  }
  function hidePopover(){ if (popEl){ popEl.remove(); popEl=null; } }

  // ---------------------------------------------------------
  // COMPOSER (sheet)
  // ---------------------------------------------------------
  function openComposer(opts){
    const mode = opts.mode; // "thread" | "reply"
    const quote = opts.quote || "";
    const wrap = $("#sheetWrap");
    wrap.innerHTML = `
      <div class="sheet-backdrop" data-close></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet__grip"></div>
        <div class="sheet__title">${mode==="thread"?"🧵 新規スレッドを立てる":"✏️ レスを書き込む"}</div>
        <div class="errline" id="cErr"></div>
        ${mode==="thread" ? `
          <div class="field">
            <label>スレッドタイトル</label>
            <input id="fTitle" maxlength="80" placeholder="例）作業用に最適なボカロ曲を語るスレ" autocomplete="off">
          </div>`:""}
        <div class="field">
          <div class="row">
            <div>
              <label>名前</label>
              <input id="fName" maxlength="40" placeholder="名無しのボカロP" autocomplete="off">
            </div>
            <div>
              <label>メール</label>
              <input id="fMail" maxlength="40" placeholder="sage で下げ" autocomplete="off">
            </div>
          </div>
        </div>
        <div class="field">
          <label>本文</label>
          <textarea id="fBody" maxlength="2000" placeholder="${mode==="thread"?"スレッドの最初の書き込みを入力…":"本文を入力…  >>番号 で安価できます"}">${esc(quote)}</textarea>
          <div class="hint"><span id="cCount">0</span>/2000　・　&gt;&gt;番号 で安価、行頭 &gt; で引用</div>
        </div>
        <div class="sheet__actions">
          <button class="btn ghost" data-close>キャンセル</button>
          <button class="btn primary" id="cSubmit">${mode==="thread"?"スレを立てる":"書き込む"}</button>
        </div>
      </div>`;
    wrap.classList.add("open");
    const body = $("#fBody");
    const count = $("#cCount");
    const upd = ()=> count.textContent = body.value.length;
    body.addEventListener("input", upd); upd();
    setTimeout(()=> (mode==="thread"?$("#fTitle"):body).focus(), 60);

    wrap.querySelectorAll("[data-close]").forEach(b=> b.addEventListener("click", closeComposer));
    $("#cSubmit").addEventListener("click", ()=> submitComposer(mode));
  }
  function closeComposer(){ const w=$("#sheetWrap"); w.classList.remove("open"); w.innerHTML=""; if(location.hash==="#/new") history.replaceState(null,"",location.pathname); }

  async function submitComposer(mode){
    const err = $("#cErr");
    const show = (m)=>{ err.textContent=m; err.classList.add("show"); };
    err.classList.remove("show");
    const name = $("#fName").value, mail = $("#fMail").value, bodyV = $("#fBody").value.trim();
    if (!bodyV){ show("本文を入力してください"); return; }
    const btn = $("#cSubmit"); btn.disabled = true; btn.textContent = "送信中…";
    try{
      if (mode==="thread"){
        const title = $("#fTitle").value.trim();
        if (!title){ show("タイトルを入力してください"); btn.disabled=false; btn.textContent="スレを立てる"; return; }
        const r = await API.createThread({ title, name, email:mail, body:bodyV });
        closeComposer(); toast("スレッドを立てました🎉");
        location.hash = "#/thread/" + encodeURIComponent(r.id);
      } else {
        const r = await API.createPost({ threadId: state.thread.id, name, email:mail, body:bodyV });
        closeComposer(); toast("書き込みました");
        await showThread(state.thread.id);
        const el = $("#p"+r.num); if (el){ el.classList.add("flash"); el.scrollIntoView({block:"center"}); }
      }
    }catch(e){
      btn.disabled=false; btn.textContent = mode==="thread"?"スレを立てる":"書き込む";
      let m = e.message || "送信に失敗しました";
      if (e.status===429 && e.retryAfter) m += `（あと約${e.retryAfter}秒）`;
      show(m);
    }
  }

  // ---------------------------------------------------------
  // TOAST
  // ---------------------------------------------------------
  let toastTimer;
  function toast(msg, isErr){
    let t = $("#toast");
    if (!t){ t=document.createElement("div"); t.id="toast"; t.className="toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.toggle("err", !!isErr);
    requestAnimationFrame(()=> t.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> t.classList.remove("show"), 2400);
  }

  // ---------------------------------------------------------
  // GLOBAL EVENTS
  // ---------------------------------------------------------
  document.addEventListener("click", (e)=>{
    const thread = e.target.closest(".thread");
    if (thread){ location.hash = "#/thread/" + encodeURIComponent(thread.dataset.id); return; }

    const tab = e.target.closest(".tab");
    if (tab){ state.tab = tab.dataset.tab; paintList(); return; }

    const anchor = e.target.closest(".anchor");
    if (anchor){
      const n = anchor.dataset.anchor.split("-")[0];
      const el = $("#p"+n);
      if (el){ el.scrollIntoView({block:"center"}); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
      else showPopover(n, e.clientX, e.clientY);
      return;
    }

    const reply = e.target.closest("[data-reply]");
    if (reply && state.view==="thread"){
      openComposer({ mode:"reply", quote: ">>"+reply.dataset.reply+"\n" });
      return;
    }
    if (!e.target.closest(".popover")) hidePopover();
  });

  // hover popover on desktop
  document.addEventListener("mouseover", (e)=>{
    const a = e.target.closest(".anchor");
    if (a && state.view==="thread"){
      const n = a.dataset.anchor.split("-")[0];
      if ($("#p"+n)) return; // on-page, click scrolls
      showPopover(n, e.clientX, e.clientY);
    }
  });
  document.addEventListener("mouseout",(e)=>{ if (e.target.closest(".anchor")) setTimeout(()=>{ if(!popEl?.matches(":hover")) hidePopover(); }, 60); });

  // header buttons
  elBack.addEventListener("click", ()=>{ if (history.length>1) history.back(); else location.hash=""; });
  elBrand.addEventListener("click", ()=>{ location.hash=""; });
  $("#hdrSearch").addEventListener("click", ()=>{
    elSearch.classList.toggle("open");
    if (elSearch.classList.contains("open")) $("#searchInput").focus();
  });
  $("#searchInput").addEventListener("input", (e)=>{ state.search = e.target.value.trim(); if(state.view==="list") paintList(); });

  // composer FABs
  $("#fabNew").addEventListener("click", ()=>{
    if (state.view==="thread") openComposer({mode:"reply"});
    else openComposer({mode:"thread"});
  });
  $("#fabThread").addEventListener("click", ()=> openComposer({mode:"thread"}));

  // keep FAB label in sync per view via a small observer-ish patch
  const fabNew = $("#fabNew"), fabThread = $("#fabThread");
  function syncFab(){
    if (state.view==="thread"){ fabNew.innerHTML="✏️ 書き込む"; fabThread.style.display="flex"; fabThread.title="新規スレッド"; }
    else { fabNew.innerHTML="🧵 新規スレッド"; fabThread.style.display="none"; }
  }
  const _showThread = showThread, _showList = showList;
  showThread = async function(...a){ await _showThread.apply(null,a); syncFab(); };
  showList   = async function(...a){ await _showList.apply(null,a);   syncFab(); };

  window.addEventListener("scroll", hidePopover, { passive:true });

  // boot
  paintTabs();
  route();
})();
