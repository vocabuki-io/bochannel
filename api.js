/* ===========================================================
   ぼちゃんねる — data layer
   Talks to the Cloudflare Worker when CONFIG.API_BASE is set.
   Falls back to a localStorage "demo board" so the site is
   fully usable before/without a backend (e.g. GitHub Pages
   preview). Same method surface either way.
   =========================================================== */
(function (global) {
  "use strict";

  // ---------------------------------------------------------
  // CONFIG — after deploying the Worker, paste its URL here
  // (or leave "" to keep running on the built-in demo store).
  //   e.g. "https://bochannel-api.yourname.workers.dev"
  // ---------------------------------------------------------
  const CONFIG = {
    API_BASE: "",          // Cloudflare Worker origin, no trailing slash
    BOARD: "vocaloid",
    BOARD_NAME: "ボーカロイド総合",
  };

  const LS_KEY = "bochannel_demo_v1";
  const usingRemote = () => !!CONFIG.API_BASE;

  // ===================== remote (Worker) =====================
  async function call(path, opts) {
    const res = await fetch(CONFIG.API_BASE + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const msg = (data && data.error) || ("通信エラー (" + res.status + ")");
      const err = new Error(msg); err.status = res.status; err.retryAfter = data && data.retryAfter;
      throw err;
    }
    return data;
  }

  // ===================== local demo store =====================
  function nowParts(d) {
    const W = ["日","月","火","水","木","金","土"];
    const p = (n) => String(n).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3,"0").slice(0,2);
    return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())}(${W[d.getDay()]}) ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms}`;
  }
  function randId() {
    const c = "ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789+/";
    let s = ""; for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random()*c.length)];
    return s;
  }
  function uid() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY)); } catch (_) {}
    if (!raw || !raw.threads) { raw = seed(); save(raw); }
    return raw;
  }
  function save(db) { try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (_) {} }

  // seed data — clean, original Vocaloid-fan flavour
  function seed() {
    const base = Date.now();
    const mk = (offsetMin, name, body, idtag) => ({
      name: name || "名無しのボカロP",
      email: "",
      body,
      date: nowParts(new Date(base - offsetMin*60000)),
      uid: idtag || randId(),
      ts: base - offsetMin*60000,
    });
    const threads = [
      {
        id: "t_miku", title: "【初音ミク】みんなの好きなミク曲を語るスレ Part.187",
        posts: [
          mk(900,"名無しのボカロP","ミクの曲で人生変わった人集まれ\nまずは語ろうぜ","M1kuLov3"),
          mk(880,"名無しのボカロP",">>1\nわかる\n中学の時に出会ってからずっと聴いてる","Aa90xQ2z"),
          mk(861,"名無しのボカロP","初期の調教も味があって好きなんだよな","kP4r0nVe"),
          mk(840,"名無しのボカロP",">>3\n今の技術で聴き慣れると逆に新鮮に感じる","Zx8mNb1L"),
          mk(700,"名無しのボカロP","ライブ行った人いる?\n生バンドのミク最高だった","r1nL3nGm"),
          mk(540,"名無しのボカロP","sageで失礼\n最近の若い子もミク知っててうれしい","Qw3eRt5y"),
          mk(300,"名無しのボカロP",">>6\n世代を超えて愛されてるの本当にすごい","Vo1c4l0d"),
          mk(120,"名無しのボカロP","結局ミクは令和でも現役なんだよなあ","mIku39ss"),
        ],
      },
      {
        id: "t_rinlen", title: "鏡音リン・レンの双子感が好きな奴ちょっと来い",
        posts: [
          mk(620,"名無しのボカロP","ハモリの掛け合いが神すぎる","R1nL3n00"),
          mk(610,"名無しのボカロP",">>1\nツインボーカルの破壊力は異常","ab12Cd34"),
          mk(480,"名無しのボカロP","リンのパワー系もレンの伸びる高音もどっちも好き","yt8Uj2Wq"),
          mk(160,"名無しのボカロP","アペンド出てから表現の幅広がったよね","Lm5nKo9p"),
        ],
      },
      {
        id: "t_dtm", title: "【DTM】ボカロP初心者だけど作曲のコツ教えて",
        posts: [
          mk(430,"名無しのボカロP","DAW買ったはいいけど何から手をつければ…","newbie01"),
          mk(420,"名無しのボカロP",">>1\nまずは好きな曲のコピーから始めるといい","s3nP4iXx"),
          mk(410,"名無しのボカロP","コード進行は王道進行覚えるだけでだいぶ変わる","komP0z3r"),
          mk(360,"名無しのボカロP",">>3\n王道進行ほんと優秀\n困ったら使ってる","Hr4mNb8c"),
          mk(200,"名無しのボカロP","調声は譜面とにらめっこする時間が一番大事","tUn3rPro"),
          mk(45,"名無しのボカロP",">>1\nとにかく1曲完成させる経験が大事だぞ\nがんばれ","ouEnc0ur"),
        ],
      },
      {
        id: "t_luka", title: "巡音ルカの大人っぽい声質好きな人いる?",
        posts: [
          mk(220,"名無しのボカロP","ルカの低音とバイリンガルさが唯一無二","Luk4S0ng"),
          mk(180,"名無しのボカロP",">>1\nジャズ系との相性が抜群なんだよな","mZ9oPq1r"),
          mk(60,"名無しのボカロP","落ち着いた曲調が増える季節に聴きたくなる","cooLvc3l"),
        ],
      },
      {
        id: "t_gumi", title: "GUMIの曲って中毒性高くない?",
        posts: [
          mk(150,"名無しのボカロP","疾走感のある曲が刺さりまくる","Gum1Lov3"),
          mk(140,"名無しのボカロP",">>1\nロック系の伸びは随一だと思う","pl9Wsx2e"),
        ],
      },
      {
        id: "t_news", title: "【雑談】最近ハマってるボカロ曲を淡々と貼るスレ",
        posts: [
          mk(95,"名無しのボカロP","作業用に無限ループしてる曲ある?","work8gm9"),
          mk(80,"名無しのボカロP",">>1\nテンポ速めのやつ作業はかどる","aZ1sW2dx"),
          mk(30,"名無しのボカロP","深夜に聴くしっとり系も捨てがたい","n1ghtvc0"),
          mk(8,"名無しのボカロP","この時間に開いてる同志おる?","l4t3n1te"),
        ],
      },
    ];
    // attach numbers + meta
    threads.forEach(t => {
      t.posts.forEach((p, i) => p.num = i + 1);
      t.createdAt = t.posts[0].ts;
      t.lastAt = t.posts[t.posts.length - 1].ts;
      t.postCount = t.posts.length;
      t.board = CONFIG.BOARD;
    });
    return { threads, lastPostAt: 0 };
  }

  function metaOf(t) {
    return { id: t.id, title: t.title, createdAt: t.createdAt, lastAt: t.lastAt,
             postCount: t.postCount, board: t.board, abone: !!t.abone };
  }

  const localApi = {
    async getThreads() {
      const db = load();
      return db.threads.filter(t => !t.abone).map(metaOf);
    },
    async getThread(id) {
      const db = load();
      const t = db.threads.find(x => x.id === id);
      if (!t) { const e = new Error("スレッドが見つかりません"); e.status = 404; throw e; }
      return { ...metaOf(t), posts: t.posts };
    },
    async createThread({ title, name, email, body }) {
      const db = load();
      checkRate(db);
      const t = {
        id: uid(), title: (title||"").trim(), board: CONFIG.BOARD,
        posts: [], createdAt: Date.now(), lastAt: Date.now(), postCount: 0,
      };
      const post = {
        num: 1, name: (name||"").trim() || "名無しのボカロP",
        email: (email||"").trim(), body: (body||"").trim(),
        date: nowParts(new Date()), uid: randId(), ts: Date.now(),
      };
      t.posts.push(post); t.postCount = 1;
      db.threads.unshift(t); db.lastPostAt = Date.now(); save(db);
      return { id: t.id, num: 1 };
    },
    async createPost({ threadId, name, email, body }) {
      const db = load();
      checkRate(db);
      const t = db.threads.find(x => x.id === threadId);
      if (!t) { const e = new Error("スレッドが見つかりません"); e.status = 404; throw e; }
      const post = {
        num: t.posts.length + 1, name: (name||"").trim() || "名無しのボカロP",
        email: (email||"").trim(), body: (body||"").trim(),
        date: nowParts(new Date()), uid: randId(), ts: Date.now(),
      };
      t.posts.push(post); t.postCount = t.posts.length;
      const isSage = /sage/i.test(post.email);
      if (!isSage) { t.lastAt = Date.now(); db.threads = [t, ...db.threads.filter(x=>x!==t)]; }
      db.lastPostAt = Date.now(); save(db);
      return { num: post.num };
    },
  };

  function checkRate(db) {
    const last = db.lastPostAt || 0;
    const wait = 8000; // demo throttle 8s
    if (Date.now() - last < wait) {
      const e = new Error("連投規制中です。少し待ってから書き込んでください");
      e.status = 429; e.retryAfter = Math.ceil((wait - (Date.now()-last))/1000); throw e;
    }
  }

  // ===================== remote wrappers =====================
  const remoteApi = {
    getThreads: () => call(`/api/threads?board=${CONFIG.BOARD}`).then(d => d.threads),
    getThread: (id) => call(`/api/thread?id=${encodeURIComponent(id)}`),
    createThread: (p) => call(`/api/thread`, { method:"POST", body: JSON.stringify({ ...p, board: CONFIG.BOARD }) }),
    createPost: (p) => call(`/api/post`, { method:"POST", body: JSON.stringify(p) }),
  };

  global.API = {
    CONFIG,
    isDemo: () => !usingRemote(),
    getThreads: (...a) => (usingRemote() ? remoteApi : localApi).getThreads(...a),
    getThread:  (...a) => (usingRemote() ? remoteApi : localApi).getThread(...a),
    createThread:(...a)=> (usingRemote() ? remoteApi : localApi).createThread(...a),
    createPost: (...a) => (usingRemote() ? remoteApi : localApi).createPost(...a),
    _resetDemo: () => { localStorage.removeItem(LS_KEY); },
  };
})(window);
