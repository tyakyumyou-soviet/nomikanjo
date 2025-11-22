(() => {
  const qs = s => document.querySelector(s);
  const qsa = s => Array.from(document.querySelectorAll(s));
  const getCSRF = () => window.CSRF_TOKEN || '';

  // simple fetch wrapper that returns parsed json (or throws)
  function fetchJSON(url, method='GET', body=null){
    const opts = { method, headers: {'Accept': 'application/json'} };
    if(method !== 'GET' && method !== 'HEAD'){
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-CSRFToken'] = getCSRF();
      opts.body = body !== null ? JSON.stringify(body) : '{}';
    }
    return fetch(url, opts).then(async r => {
      if(!r.ok){
        const txt = await r.text().catch(()=>null);
        throw new Error(txt || r.statusText);
      }
      // some endpoints may return 204
      if(r.status === 204) return {};
      return r.json();
    });
  }

  /* ---------- modal helpers ---------- */
  const overlay = qs('#overlay');
  const modal = qs('#modal');
  const slideUp = qs('#slideUp');

  // Helper: control visibility of floating share button (mobile)
  function setFloatingShareVisible(visible){
    const fb = qs('#openShareFloating');
    if(!fb) return;
    // use display rather than visibility so it doesn't intercept pointer events
    fb.style.display = visible ? 'inline-block' : 'none';
  }

  function showModal(html){
    // hide floating share button to avoid z-index / pointer interception issues on mobile
    setFloatingShareVisible(false); // <-- 追加: モーダル表示時は浮遊ボタン隠す

    if(overlay) overlay.classList.remove('hidden');
    if(modal){ modal.innerHTML = html; modal.classList.remove('hidden'); }
    return modal;
  }
  function showSlideUp(html){
    // slideUp is used on mobile; still hide floating share button so it doesn't remain on top
    setFloatingShareVisible(false); // <-- 追加

    if(slideUp){ slideUp.innerHTML = html; slideUp.classList.remove('hidden'); }
    if(overlay) overlay.classList.add('hidden');
    return slideUp;
  }
  function closeAllModals(){
    if(overlay) overlay.classList.add('hidden');
    if(modal){ modal.innerHTML = ''; modal.classList.add('hidden'); }
    if(slideUp){ slideUp.innerHTML = ''; slideUp.classList.add('hidden'); }

    // restore floating share button visibility after modal closed
    setFloatingShareVisible(true); // <-- 追加
  }

  /* ---------- Home: 新規セッション ---------- */
  const openCreateSessionBtn = qs('#openCreateSession');
  if(openCreateSessionBtn){
    openCreateSessionBtn.addEventListener('click', () => {
      const html = `
        <h3>新規セッション作成</h3>
        <div class="form-row"><input id="sessionName" class="input" placeholder="セッション名（必須）" /></div>
        <div class="form-row"><input id="storeName" class="input" placeholder="店名（任意）" /></div>
        <div class="form-row"><input id="sessionPassword" class="input" placeholder="合言葉（任意）" /></div>
        <div class="form-row"><label><input type="checkbox" id="wantLoc"> 店の位置情報を保存する</label></div>
        <div class="actions"><button class="btn secondary" id="cancelModal">キャンセル</button><button class="btn primary" id="saveSession">作成</button></div>
      `;
      const m = showModal(html);
      if(!m) return;
      m.querySelector('#cancelModal').addEventListener('click', closeAllModals);
      m.querySelector('#saveSession').addEventListener('click', async () => {
        const name = (m.querySelector('#sessionName')?.value || '').trim();
        if(!name) return alert('セッション名を入力してください');
        const store = (m.querySelector('#storeName')?.value || '').trim();
        const pw = (m.querySelector('#sessionPassword')?.value || '').trim();
        const wantLoc = !!(m.querySelector('#wantLoc')?.checked);
        if(wantLoc && navigator.geolocation){
          navigator.geolocation.getCurrentPosition(async pos => {
            try {
              const res = await fetchJSON('/api/sessions/', 'POST', { name, store_name: store, password: pw, want_loc: true, lat: pos.coords.latitude, lng: pos.coords.longitude });
              if(res && res.url) window.location.href = res.url;
            } catch(err){ alert('作成に失敗しました: ' + err.message); }
          }, async err => {
            try {
              const res = await fetchJSON('/api/sessions/', 'POST', { name, store_name: store, password: pw, want_loc: false });
              if(res && res.url) window.location.href = res.url;
            } catch(e){ alert('作成に失敗しました: ' + e.message); }
          }, { timeout:5000 });
        } else {
          try {
            const res = await fetchJSON('/api/sessions/', 'POST', { name, store_name: store, password: pw, want_loc: false });
            if(res && res.url) window.location.href = res.url;
          } catch(err){ alert('作成に失敗しました: ' + err.message); }
        }
      });
    });
  }

  /* ---------- Home: open session with password prompt on Home ---------- */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('.open-btn[data-id]');
    if(!btn) return;
    e.preventDefault();
    const sessionId = btn.getAttribute('data-id');
    if(!sessionId) return;
    try {
      // fetch minimal session detail (returns has_password)
      const s = await fetchJSON(`/api/sessions/${sessionId}/`);
      // If there's a password, prompt on home
      if(s.has_password){
        const PW_STORAGE_KEY = `party_pw_${sessionId}`;
        const stored = localStorage.getItem(PW_STORAGE_KEY) || '';
        if(stored){
          // validate stored via server
          try {
            const chk = await fetchJSON(`/api/sessions/${sessionId}/check_password/`, 'POST', { password: stored });
            if(chk && chk.ok){
              window.location.href = `/session/${sessionId}/`;
              return;
            } else {
              // stored invalid -> remove and prompt
              localStorage.removeItem(PW_STORAGE_KEY);
            }
          } catch(err){
            // validation error -> fallback to prompt
            console.warn('password validation failed', err);
          }
        }
        // ask for pw modal (home) — **always show centered modal, even on mobile**
        const html = `<h3>合言葉を入力してください</h3>
          <div class="form-row"><input id="pwInputHome" class="input" placeholder="合言葉"></div>
          <div class="actions"><button class="btn secondary" id="cancelModalHome">キャンセル</button><button class="btn primary" id="checkPwHome">入室</button></div>`;
        const container = showModal(html); // always center
        if(!container) return;
        const cancel = container.querySelector('#cancelModalHome');
        const check = container.querySelector('#checkPwHome');
        if(cancel) cancel.addEventListener('click', () => { closeAllModals(); });
        if(check) check.addEventListener('click', async () => {
          const val = (container.querySelector('#pwInputHome')?.value || '').trim();
          try {
            const res = await fetchJSON(`/api/sessions/${sessionId}/check_password/`, 'POST', { password: val });
            if(res && res.ok){
              localStorage.setItem(PW_STORAGE_KEY, val);
              closeAllModals();
              window.location.href = `/session/${sessionId}/`;
            } else {
              alert('合言葉が違います');
            }
          } catch(err){
            alert('合言葉の検証に失敗しました: ' + err.message);
          }
        });
      } else {
        // no pw -> just go
        window.location.href = `/session/${sessionId}/`;
      }
    } catch(err){
      console.error(err);
      alert('セッションを開けませんでした: ' + err.message);
    }
  });

  /* ---------- Session detail page logic ---------- */
  const sessionRoot = qs('[data-session-id]');
  if(sessionRoot){
    const sessionId = sessionRoot.getAttribute('data-session-id');
    const membersStrip = qs('#membersStrip');
    const ordersList = qs('#ordersList');
    const discountType = qs('#discountType');
    const discountValue = qs('#discountValue');
    const taxRate = qs('#taxRate');
    const totalAmountEl = qs('#totalAmount');
    const appliedInfo = qs('#appliedInfo');
    const openMobileControlsBtn = qs('#openMobileControls');
    const openReceiptViewBtn = qs('#openReceiptView');

    let sessionData = null;
    const PW_STORAGE_KEY = `party_pw_${sessionId}`;

    // Polling control vars
    let pollInterval = null;
    let isPolling = false;
    const POLL_MS = 2500; // ポーリング間隔（ミリ秒）

    function formatInt(v){ return Number(v).toLocaleString('ja-JP'); }
    function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

    // hide settings button on desktop (JS extra safety)
    function updateSettingsButtonVisibility(){
      if(!openMobileControlsBtn) return;
      if(window.innerWidth >= 900){
        openMobileControlsBtn.style.display = 'none';
      } else {
        openMobileControlsBtn.style.display = '';
      }
    }
    window.addEventListener('resize', updateSettingsButtonVisibility);
    updateSettingsButtonVisibility();

    // ask for password modal (used inside session page if needed)
    function askForPasswordAndValidate(){
      return new Promise((resolve, reject) => {
        const html = `<h3>合言葉を入力してください</h3>
          <div class="form-row"><input id="pwInput" class="input" placeholder="合言葉"></div>
          <div class="actions"><button class="btn secondary" id="cancelModal">キャンセル</button><button class="btn primary" id="checkPw">入室</button></div>`;
        const container = showModal(html); // always center
        if(!container) { reject(new Error('modal failed')); return; }
        const cancel = container.querySelector('#cancelModal');
        const check = container.querySelector('#checkPw');
        if(cancel) cancel.addEventListener('click', () => { closeAllModals(); reject(new Error('cancel')); });
        if(check) check.addEventListener('click', async () => {
          const val = (container.querySelector('#pwInput')?.value || '').trim();
          try {
            const res = await fetchJSON(`/api/sessions/${sessionId}/check_password/`, 'POST', { password: val });
            if(res && res.ok){
              localStorage.setItem(PW_STORAGE_KEY, val);
              closeAllModals();
              resolve();
            } else {
              alert('合言葉が違います');
            }
          } catch(err){
            alert('合言葉の検証に失敗しました: ' + err.message);
          }
        });
      });
    }

    // initial load (do password check once here)
    async function loadSession(){
      try {
        const json = await fetchJSON(`/api/sessions/${sessionId}/`);
        sessionData = json;
        // require password if session has password
        if(sessionData.has_password){
          const stored = localStorage.getItem(PW_STORAGE_KEY) || '';
          if(stored){
            try {
              const chk = await fetchJSON(`/api/sessions/${sessionId}/check_password/`, 'POST', { password: stored });
              if(!(chk && chk.ok)){
                // stored invalid -> remove and request input
                localStorage.removeItem(PW_STORAGE_KEY);
                await askForPasswordAndValidate();
              }
            } catch(err){
              // server check failed -> ask user for pw interactively
              try {
                await askForPasswordAndValidate();
              } catch(e){
                // user cancelled -> go home
                alert('合言葉が必要です。ホームに戻ります。');
                window.location.href = '/';
                return;
              }
            }
          } else {
            // no stored pw -> ask
            try {
              await askForPasswordAndValidate();
            } catch(e){
              alert('合言葉が必要です。ホームに戻ります。');
              window.location.href = '/';
              return;
            }
          }
        }
        // after password validated (or not required), render and start polling
        renderSession();
        startPolling(); // ← 初回成功後にポーリングを開始
      } catch(err){
        console.error(err);
        alert('セッション取得に失敗しました');
      }
    }

    // lightweight polling fetch that DOES NOT trigger password prompts
    async function pollSession(){
      if(isPolling) return;
      isPolling = true;
      try {
        const json = await fetchJSON(`/api/sessions/${sessionId}/`);
        // quick shallow compare: if orders length or members length changed, update
        let changed = false;
        if(!sessionData){
          changed = true;
        } else {
          const prevOrdersLen = (sessionData.orders || []).length;
          const prevMembersLen = (sessionData.members || []).length;
          const newOrdersLen = (json.orders || []).length;
          const newMembersLen = (json.members || []).length;
          if(prevOrdersLen !== newOrdersLen || prevMembersLen !== newMembersLen){
            changed = true;
          } else {
            // deeper check: compare last order id or timestamp if available
            const prevLast = (sessionData.orders || [])[ (sessionData.orders||[]).length -1 ];
            const newLast = (json.orders || [])[ (json.orders||[]).length -1 ];
            if((prevLast && newLast && prevLast.id !== newLast.id) || (!prevLast && newLast) || (prevLast && !newLast)){
              changed = true;
            }
          }
        }
        // always update sessionData reference (so UI controls reflect latest config)
        sessionData = json;
        if(changed){
          renderSession(); // re-render when changed
        } else {
          // even if not changed, still refresh receipt totals (discount/tax may have changed)
          try {
            const t = await fetchJSON(`/api/sessions/${sessionId}/receipt/`);
            const final = Math.ceil(Number(t.final_total || 0));
            if(totalAmountEl) totalAmountEl.textContent = '¥' + formatInt(final);
            if(appliedInfo) appliedInfo.textContent = `割引:${t.discount_text} ・ 税表示:${sessionData.tax_mode==='exclusive' ? '税抜' : '税込'}`;
          } catch(e){
            // ignore receipt fetch errors during polling
            console.warn('receipt poll error', e);
          }
        }
      } catch(err){
        console.warn('poll failed', err);
      } finally {
        isPolling = false;
      }
    }

    function startPolling(){
      if(pollInterval) clearInterval(pollInterval);
      // run immediately once then set interval
      pollSession();
      pollInterval = setInterval(pollSession, POLL_MS);
    }
    function stopPolling(){
      if(pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      isPolling = false;
    }

    // pause/resume on visibility change to reduce load
    document.addEventListener('visibilitychange', () => {
      if(document.hidden){
        stopPolling();
      } else {
        startPolling();
      }
    });

    // clear on unload
    window.addEventListener('beforeunload', () => {
      stopPolling();
    });

    // Display quantity for allocations in UI (integer-friendly)
    function displayAllocQty(orderQty, allocationsLen, allocQty){
      const qtyNum = Number(allocQty) || 0;
      // If 1 item split among multiple people -> display 1 for each participant with >0 share
      if(Number(orderQty) === 1 && allocationsLen > 1 && qtyNum > 0) return 1;
      const rounded = Math.round(qtyNum);
      if(rounded === 0 && qtyNum > 0) return 1;
      return rounded;
    }

    function renderSession(){
  if(!sessionData) return;
  // members
  if(membersStrip) membersStrip.innerHTML = '';

  // --- メンバーループ（既存コード） ---
  (sessionData.members || []).forEach(m => {
    const el = document.createElement('div');
    el.className = 'member-card';

    // member に割り当てられた合計金額を算出
    // 各注文の allocations を見て、その member_id が一致するものを qty * price で加算
    let totalForMember = 0;
    (sessionData.orders || []).forEach(o => {
      (o.allocations || []).forEach(a => {
        if(String(a.member_id) === String(m.id)) {
          totalForMember += Number(a.qty || 0) * Number(o.price || 0);
        }
      });
    });

    // 整数表示にする（四捨五入）。必要なら Math.ceil / Math.floor に変更可。
    const totalRounded = Math.round(totalForMember);

    el.innerHTML = `
      <div style="font-weight:700">${escapeHtml(m.name)}</div>
      <div class="sum">¥${formatInt(totalRounded)}</div>
      <div class="small muted"> <br> </div>
    `;
    if(membersStrip) membersStrip.appendChild(el);
  });
  // --- メンバー描画ここまで ---

  // === ここに「参加者追加」カードを追加します（以下をそのまま挿入） ===
  const add = document.createElement('div');
  add.className = 'member-card member-add';
  add.innerHTML = '<div>＋ 参加者追加</div>';
  add.addEventListener('click', () => {
    const html = `<h3>参加者追加</h3>
      <div class="form-row"><input id="memberName" class="input" placeholder="名前を入力" /></div>
      <div class="actions"><button class="btn secondary" id="cancelModal">キャンセル</button><button class="btn primary" id="saveMember">追加</button></div>`;
    const c = showModal(html);
    if(!c) return;
    c.querySelector('#cancelModal').addEventListener('click', closeAllModals);
    c.querySelector('#saveMember').addEventListener('click', async () => {
      const name = (c.querySelector('#memberName')?.value || '').trim();
      if(!name) return alert('名前を入力してください');
      try {
        await fetchJSON(`/api/sessions/${sessionId}/members/`, 'POST', { name });
        closeAllModals();
        await loadSession();
      } catch(err){
        alert('参加者追加に失敗しました: ' + err.message);
      }
    });
  });
  if(membersStrip) membersStrip.appendChild(add);

      // orders
      ordersList.innerHTML = '';
      if(!sessionData.orders || sessionData.orders.length === 0){
        ordersList.innerHTML = `<div class="muted">注文がまだありません。フッターの＋で追加してください。</div>`;
      } else {
        sessionData.orders.forEach(o => {
          const card = document.createElement('div'); 
          card.className = 'order-card';

          const left = document.createElement('div'); 
          left.className = 'order-left';

          // 割り当てテキストを生成
          const allocText = (o.allocations || []).map(a => {
          const mem = sessionData.members.find(m => m.id == a.member_id);
          const qtyDisplay = displayAllocQty(o.qty, (o.allocations || []).length, a.qty);
          return (mem ? mem.name : '?') + ' x' + qtyDisplay;
        }).join(', ');

          left.innerHTML = `
            <div class="badge">x${o.qty}</div>
            <div>
              <div class="item-title">${escapeHtml(o.item)}</div>
              <div class="item-meta">¥${formatInt(o.price)} ・ ${escapeHtml(allocText)}</div>
            </div>`;

          // --- 👇 修正版 一人あたり金額ロジック ---
          const total = (o.allocations || []).reduce((acc, a) => acc + (a.qty * o.price), 0);
          const sharedCount = (o.allocations || []).length;
          const perPerson = sharedCount > 0 ? Math.ceil(total / sharedCount) : total;

          const rightWrap = document.createElement('div');
          rightWrap.style.display = 'flex';
          rightWrap.style.alignItems = 'center';
          rightWrap.style.gap = '8px';

          const rightHtml = document.createElement('div');
          // 割り勘ラベルは参加者が2人以上のときだけ表示する
          const isShared = (sharedCount > 1);

          rightHtml.innerHTML = `
            <div style="font-weight:800">¥${formatInt(Math.ceil(total))}</div>
            ${isShared ? `<div style="margin-top:6px;font-size:12px;opacity:0.85">[割り勘]</div>` : ''}
            <div class="small muted" style="margin-top:6px">¥${formatInt(perPerson)}/人</div>
          `;
          const delBtn = document.createElement('button'); 
          delBtn.className = 'order-delete'; 
          delBtn.textContent = '削除';
          delBtn.addEventListener('click', async () => {
            if(!confirm('この注文を削除しますか？')) return;
            try {
              await fetch(`/api/sessions/${sessionId}/orders/${o.id}/`, { method: 'DELETE', headers: {'X-CSRFToken': getCSRF()}});
              await loadSession();
            } catch(err){ alert('削除失敗: ' + err.message); }
          });

          rightWrap.appendChild(rightHtml);
          rightWrap.appendChild(delBtn);
          card.appendChild(left); 
          card.appendChild(rightWrap);
          ordersList.appendChild(card);
        });
      }

      // totals via receipt API
      fetchJSON(`/api/sessions/${sessionId}/receipt/`).then(t => {
        // ensure integer display (rounded up)
        const final = Math.ceil(Number(t.final_total || 0));
        const raw = Math.ceil(Number(t.raw_total || 0));
        if(totalAmountEl) totalAmountEl.textContent = '¥' + formatInt(final);
        if(appliedInfo) appliedInfo.textContent = `割引:${t.discount_text} ・ 税表示:${sessionData.tax_mode==='exclusive' ? '税抜' : '税込'}`;
        // additionally update per-member sums display in members strip if desired (not requested here)
        // ... (left as future improvement)
      }).catch(e=>{ console.warn('receipt fetch error', e); });

      // set controls
      if(discountType) discountType.value = sessionData.discount_type || 'none';
      if(discountValue) discountValue.value = sessionData.discount_value || 0;
      if(taxRate) taxRate.value = sessionData.tax_rate || 10;
      qsa('input[name="taxMode"]').forEach(r => r.checked = (sessionData.tax_mode === 'inclusive' ? (r.value === 'inclusive') : (r.value === 'exclusive')));
    }

    // settings modal (mobile)
    async function showSettingsModal(){
      const html = `
        <div class="drag-bar"></div>
        <h3>設定（割引 / 税）</h3>
        <div class="form-row"><label class="small muted">割引タイプ</label></div>
        <div class="form-row"><select id="m_discountType" class="input"><option value="none">なし</option><option value="yen">円引き</option><option value="percent">%引き</option></select></div>
        <div class="form-row"><label class="small muted">割引値</label></div>
        <div class="form-row"><input id="m_discountValue" class="input" type="number" placeholder="値" /></div>
        <div class="form-row"><label class="small muted">税表示</label></div>
        <div class="form-row" style="align-items:center;gap:8px">
          <label class="label-inline"><input type="radio" name="m_taxMode" value="inclusive"> 税込</label>
          <label class="label-inline"><input type="radio" name="m_taxMode" value="exclusive"> 税抜</label>
          <input id="m_taxRate" class="input small-input" type="number" /> %
        </div>
        <div style="height:8px"></div>
        <div class="actions"><button class="btn secondary" id="cancelModal">キャンセル</button><button class="btn primary" id="applySettings">適用</button></div>
      `;
      const container = (window.innerWidth >= 900) ? showModal(html) : showSlideUp(html);
      if(!container) return;
      container.querySelector('#m_discountType').value = sessionData.discount_type || 'none';
      container.querySelector('#m_discountValue').value = sessionData.discount_value || 0;
      container.querySelector('#m_taxRate').value = sessionData.tax_rate || 10;
      const mode = sessionData.tax_mode || 'inclusive';
      Array.from(container.querySelectorAll('input[name="m_taxMode"]')).forEach(r => r.checked = (r.value === mode));
      container.querySelector('#cancelModal').addEventListener('click', closeAllModals);
      container.querySelector('#applySettings').addEventListener('click', async () => {
        const stype = container.querySelector('#m_discountType').value;
        const svalue = Number(container.querySelector('#m_discountValue').value) || 0;
        const smode = Array.from(container.querySelectorAll('input[name="m_taxMode"]')).find(x=>x.checked).value;
        const srate = Number(container.querySelector('#m_taxRate').value) || 0;
        try {
          await fetchJSON(`/api/sessions/${sessionId}/settings/`, 'POST', { discount_type: stype, discount_value: svalue, tax_mode: smode, tax_rate: srate });
          closeAllModals();
          await loadSession();
        } catch(err){ alert('設定の保存に失敗しました: ' + err.message); }
      }, { once: true });
    }

    if(openMobileControlsBtn){
      openMobileControlsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if(!sessionData) return;
        showSettingsModal();
      });
    }

    // settings auto-save handlers (desktop footer)
    if(discountType) discountType.addEventListener('change', () => applySettings());
    if(discountValue) discountValue.addEventListener('input', () => applySettings());
    if(taxRate) taxRate.addEventListener('change', () => applySettings());
    qsa('input[name="taxMode"]').forEach(r => r.addEventListener('change', ()=> applySettings()));

    async function applySettings(){
      const stype = discountType.value;
      const svalue = Number(discountValue.value) || 0;
      const smode = qsa('input[name="taxMode"]').find(x=>x.checked).value;
      const srate = Number(taxRate.value) || 0;
      try {
        await fetchJSON(`/api/sessions/${sessionId}/settings/`, 'POST', { discount_type: stype, discount_value: svalue, tax_mode: smode, tax_rate: srate });
        await loadSession();
      } catch(err){ console.error(err); alert('設定の保存に失敗しました'); }
    }

    /* ---------- Order modal (add-to-history immediate update) ---------- */
    const openAddOrder = qs('#openAddOrder');

    // --- Robust insertion of "共有" button so it appears on PC and mobile ---
    (function ensureShareButton(){
      try {
        // don't duplicate
        if(qs('#openShare')) return;

        // create button
        const shareBtn = document.createElement('button');
        shareBtn.id = 'openShare';
        shareBtn.className = 'btn secondary';
        shareBtn.type = 'button';
        shareBtn.textContent = '共有';
        shareBtn.style.display = 'inline-block';
        shareBtn.style.marginRight = '8px';
        shareBtn.style.minWidth = '64px';
        shareBtn.style.boxSizing = 'border-box';
        shareBtn.addEventListener('click', (e) => { e.preventDefault(); showShareModal(); });

        // Try to insert before openAddOrder (preferred)
        let inserted = false;
        if(openAddOrder && openAddOrder.parentNode){
          openAddOrder.parentNode.insertBefore(shareBtn, openAddOrder);
          inserted = true;
        } else {
          const candidates = [
            qs('.footer-controls'),
            qs('#footer'),
            qs('footer'),
            qs('.mobile-footer'),
            qs('#mobileFooter'),
            qs('.bottom-bar')
          ];
          for(const c of candidates){
            if(c && c.appendChild){
              c.appendChild(shareBtn);
              inserted = true;
              break;
            }
          }
        }
        if(!inserted){
          document.body.appendChild(shareBtn);
          inserted = true;
        }

        // Mobile floating clone logic with dynamic positioning relative to openAddOrder
        function ensureMobileVisibility(){
          const btn = qs('#openShare');
          if(!btn) return;
          const isSmall = window.innerWidth < 900;
          const computed = window.getComputedStyle(btn);
          const isHidden = (computed.display === 'none' || computed.visibility === 'hidden' || btn.offsetParent === null);
          // if mobile viewport AND original is hidden/overflowed, create/update floating button positioned next to openAddOrder
          if(isSmall){
            // ensure floating exists
            let floatBtn = qs('#openShareFloating');
            if(!floatBtn){
              floatBtn = btn.cloneNode(true);
              floatBtn.id = 'openShareFloating';
              floatBtn.style.position = 'fixed';
              floatBtn.style.zIndex = '12000';
              floatBtn.style.display = 'inline-block';
              floatBtn.style.marginRight = '0';
              // style fallback for appearance
              floatBtn.style.boxSizing = 'border-box';
              floatBtn.addEventListener('click', (e) => { e.preventDefault(); showShareModal(); });
              document.body.appendChild(floatBtn);
            }
            positionFloatingShare(floatBtn);
          } else {
            // remove floating if exists
            const fb = qs('#openShareFloating');
            if(fb) fb.parentNode.removeChild(fb);
            btn.style.display = 'inline-block';
          }
        }

        // Positions floating share button to be immediately left of openAddOrder with 10px gap.
        function positionFloatingShare(floatBtn){
          // fallback default values
          let targetLeft = 12;
          let targetBottom = 76;
          try {
            const target = openAddOrder || qs('#openAddOrder') || qs('.add-order') || null;
            if(target){
              const rect = target.getBoundingClientRect();
              // ensure floatBtn has been laid out to get width
              floatBtn.style.visibility = 'hidden';
              floatBtn.style.left = '0px';
              floatBtn.style.bottom = '0px';
              // small delay to ensure width available
              requestAnimationFrame(() => {
                const btnWidth = floatBtn.offsetWidth || 64;
                // compute left: place to the left of the target with 10px gap
                let left = Math.round(rect.left - btnWidth - 10);
                // constrain to minimal 12px from left edge
                if(left < 12) left = 12;
                // compute bottom relative to viewport: distance from bottom so that vertical center aligns roughly
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                // choose bottom such that float button bottom aligns with target bottom + small offset
                const bottom = Math.round(viewportHeight - rect.bottom + 8); // 8px offset to visually align
                floatBtn.style.left = left + 'px';
                floatBtn.style.bottom = (bottom >= 12 ? bottom : 12) + 'px';
                floatBtn.style.visibility = 'visible';
              });
            } else {
              // no target -> fallback fixed left/bottom
              floatBtn.style.left = targetLeft + 'px';
              floatBtn.style.bottom = targetBottom + 'px';
            }
          } catch(err){
            // fallback safe position
            floatBtn.style.left = targetLeft + 'px';
            floatBtn.style.bottom = targetBottom + 'px';
          }
        }

        // run initially and on resize/orientation change
        ensureMobileVisibility();
        window.addEventListener('resize', ensureMobileVisibility);
        window.addEventListener('orientationchange', ensureMobileVisibility);
        // Also try to reposition periodically for dynamic layouts (once in a short interval) to handle transitions
        let repositionTimeout = null;
        function scheduleReposition(){
          if(repositionTimeout) clearTimeout(repositionTimeout);
          repositionTimeout = setTimeout(() => {
            const fb = qs('#openShareFloating');
            if(fb) positionFloatingShare(fb);
          }, 120);
        }
        window.addEventListener('resize', scheduleReposition);
        window.addEventListener('orientationchange', scheduleReposition);
        document.addEventListener('transitionend', scheduleReposition);
        document.addEventListener('animationend', scheduleReposition);

      } catch(err){
        console.warn('share button insertion failed', err);
      }
    })();

    // show share modal
    function showShareModal(){
      const currentUrl = window.location.href;
      const safeUrl = escapeHtml(currentUrl);
      // use public QR generation API; size 300x300; encode URL
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentUrl)}`;
      const html = `
        <h3>セッション共有</h3>
        <div class="form-row"><label class="small muted">このURLを共有してください</label></div>
        <div class="form-row"><input id="shareUrl" class="input" readonly value="${safeUrl}" /></div>
        <div style="text-align:center;margin:12px"><img id="shareQr" src="${qrUrl}" alt="QRコード" style="max-width:100%;height:auto;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.08)"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button class="btn secondary" id="closeShare">閉じる</button>
          <button class="btn" id="copyShare">URLをコピー</button>
          ${navigator.share ? '<button class="btn primary" id="nativeShare">共有</button>' : '<button class="btn primary" id="openInNew">新しいタブで開く</button>'}
        </div>
      `;
      const container = showModal(html);
      if(!container) return;
      const input = container.querySelector('#shareUrl');
      const copyBtn = container.querySelector('#copyShare');
      const closeBtn = container.querySelector('#closeShare');
      const nativeBtn = container.querySelector('#nativeShare');
      const openInNewBtn = container.querySelector('#openInNew');

      if(closeBtn) closeBtn.addEventListener('click', closeAllModals);
      if(copyBtn) copyBtn.addEventListener('click', async () => {
        const txt = input.value || currentUrl;
        if(navigator.clipboard && navigator.clipboard.writeText){
          try {
            await navigator.clipboard.writeText(txt);
            alert('URLをコピーしました');
          } catch(err){
            fallbackCopy(txt);
          }
        } else {
          fallbackCopy(txt);
        }
      });

      if(nativeBtn){
        nativeBtn.addEventListener('click', async () => {
          try {
            await navigator.share({ title: document.title || 'セッション', text: 'セッションに参加してください', url: currentUrl });
          } catch(err){
            // ユーザキャンセル等は無視
            console.warn('native share failed', err);
          }
        });
      }
      if(openInNewBtn){
        openInNewBtn.addEventListener('click', () => {
          window.open(currentUrl, '_blank');
        });
      }

      // helper fallback copy
      function fallbackCopy(text){
        try {
          input.select();
          input.setSelectionRange(0, 99999);
          document.execCommand('copy');
          alert('URLをコピーしました');
        } catch(e){
          alert('コピーに失敗しました。URLを手動で選択してください。');
        }
      }
    }

    // existing openAddOrder behavior (unchanged)
    if(openAddOrder) openAddOrder.addEventListener('click', async () => {
      const html = `
        <div class="drag-bar"></div>
        <h3>注文（複数追加可）</h3>
        <div class="form-row"><input id="itemName" class="input" placeholder="品名（手入力 or 履歴から選択）" /></div>
        <div class="form-row"><input id="itemPrice" class="input" type="number" placeholder="価格" /></div>
        <div class="form-row" style="align-items:center">
          <button class="btn secondary" id="decQty">-</button>
          <input id="itemQty" class="input" value="1" type="number" style="width:64px;text-align:center" step="1" />
          <button class="btn secondary" id="incQty">+</button>
          <label style="margin-left:12px;display:flex;align-items:center;gap:8px"><input type="checkbox" id="isShared"> 割り勘</label>
        </div>
        <div class="form-row" style="flex-direction:column;align-items:flex-start;">
          <div class="small muted">参加者を選択（割り勘オフ時はセレクトで支払者を選択）</div>
          <div id="memberSelector" style="margin-top:8px"></div>
        </div>
        <div style="margin:8px 0" class="small muted">履歴から: <span id="histBtns"></span></div>
        <div style="margin-top:8px"><button class="btn secondary" id="addLineBtn">この内容を下に追加</button></div>
        <div class="pending-list" id="pendingList"><div class="small-ghost">まだ追加された商品はありません。</div></div>
        <div style="height:10px"></div>
        <div class="actions"><button class="btn secondary" id="cancelModal">キャンセル</button><button class="btn primary" id="finalizeOrder">確定して追加</button></div>
      `;
      const container = (window.innerWidth >= 900) ? showModal(html) : showSlideUp(html);
      if(!container) return;

      // history buttons
      const histBtns = container.querySelector('#histBtns');
      const renderHistBtns = () => {
        const list = (sessionData.history || []).slice(0, 200);
        if(histBtns) histBtns.innerHTML = list.slice(0,8).map(h => `<button type="button" data-item="${escapeHtml(h.item)}" data-price="${h.price}" class="btn secondary histBtn">${escapeHtml(h.item)} ¥${formatInt(h.price)}</button>`).join(' ');
        container.querySelectorAll('.histBtn').forEach(b => {
          b.removeEventListener('click', b._histHandler);
        });
        container.querySelectorAll('.histBtn').forEach(b => {
          const handler = () => {
            const it = b.getAttribute('data-item'); const pr = b.getAttribute('data-price');
            container.querySelector('#itemName').value = it;
            container.querySelector('#itemPrice').value = pr;
          };
          b._histHandler = handler;
          b.addEventListener('click', handler);
        });
      };
      renderHistBtns();

      // qty helpers
      const inc = container.querySelector('#incQty'), dec = container.querySelector('#decQty');
      if(inc) inc.addEventListener('click', ()=> container.querySelector('#itemQty').value = Number(container.querySelector('#itemQty').value||1)+1);
      if(dec) dec.addEventListener('click', ()=> container.querySelector('#itemQty').value = Math.max(1, Number(container.querySelector('#itemQty').value||1)-1));

      // member selector
      function renderMemberSelector(isShared){
        const el = container.querySelector('#memberSelector');
        if(!sessionData.members || sessionData.members.length === 0){
          el.innerHTML = '<div class="muted">参加者がいません。まず参加者を追加してください。</div>';
          return;
        }
        if(isShared){
          el.innerHTML = sessionData.members.map(m => `<label style="display:inline-flex;align-items:center;margin-right:8px"><input type="checkbox" class="memberInput" value="${m.id}"> ${escapeHtml(m.name)}</label>`).join('');
        } else {
          el.innerHTML = `<select id="payerSelect" class="input">${sessionData.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>`;
        }
      }
      const isSharedInput = container.querySelector('#isShared');
      renderMemberSelector(!!isSharedInput?.checked);
      if(isSharedInput) isSharedInput.addEventListener('change', ()=> renderMemberSelector(isSharedInput.checked));

      // pending list
      const pending = [];
      const pendingListEl = container.querySelector('#pendingList');
      function renderPending(){
        if(pending.length === 0){ if(pendingListEl) pendingListEl.innerHTML = `<div class="small-ghost">まだ追加された商品はありません。</div>`; return; }
        if(pendingListEl) pendingListEl.innerHTML = pending.map((p, idx) => `<div class="pending-item"><div>${escapeHtml(p.item)} x${p.qty} ・ ¥${formatInt(p.price)} ・ ${p.allocations.map(a=> (sessionData.members.find(m=>m.id==a.member_id)||{name:'?'}).name+'×'+displayAllocQty(p.qty, p.allocations.length, a.qty)).join(', ')}</div><div><button class="btn secondary removeLine" data-idx="${idx}">削除</button></div></div>`).join('');
        pendingListEl.querySelectorAll('.removeLine').forEach(b => {
          b.addEventListener('click', () => { const idx = Number(b.getAttribute('data-idx')); pending.splice(idx,1); renderPending(); });
        });
      }

      // add line -> push to pending and also add to sessionData.history & server history (best-effort)
      container.querySelector('#addLineBtn').addEventListener('click', async () => {
        const item = (container.querySelector('#itemName')?.value || '').trim();
        const price = Math.max(0, parseFloat(container.querySelector('#itemPrice')?.value) || 0);
        const qty = Math.max(1, parseFloat(container.querySelector('#itemQty')?.value) || 1);
        const isShared = !!(container.querySelector('#isShared')?.checked);
        if(!item){ alert('品名を入力してください'); return; }

        if(isShared){
          const memberInputs = Array.from(container.querySelectorAll('.memberInput'));
          const checked = memberInputs.filter(ch => ch.checked).map(ch => Number(ch.value));
          if(checked.length === 0){ alert('割り勘時は少なくとも1人選択してください'); return; }
          const perShare = qty / checked.length;
          const allocations = checked.map(id => ({ member_id: id, qty: Number(perShare) }));
          pending.push({ item, price, qty, allocations });
        } else {
          const payerSel = container.querySelector('#payerSelect');
          if(!payerSel){ alert('支払う人を選択してください'); return; }
          const payer = Number(payerSel.value);
          const allocations = [{ member_id: payer, qty: Number(qty) }];
          pending.push({ item, price, qty, allocations });
        }

        // update local history (shown in this dialog immediately)
        if(!Array.isArray(sessionData.history)) sessionData.history = [];
        if(!sessionData.history.find(h => h.item === item && Number(h.price) === Number(price))){
          sessionData.history.unshift({ item, price });
          if(sessionData.history.length > 200) sessionData.history.length = 200;
        }

        // try to persist to server history endpoint if available (best-effort; ignore errors)
        (async () => {
          try {
            await fetchJSON(`/api/sessions/${sessionId}/history/`, 'POST', { item, price });
          } catch(err){
            // ignore
          }
        })();

        renderPending();
        renderHistBtns(); // update history buttons immediately
        container.querySelector('#itemName').value = '';
        container.querySelector('#itemPrice').value = '';
        container.querySelector('#itemQty').value = 1;
        if(container.querySelector('#isShared')) container.querySelector('#isShared').checked = false;
        renderMemberSelector(false);
      });

      // finalize: send pending list (server will create orders and history)
      container.querySelector('#finalizeOrder').addEventListener('click', async () => {
        if(pending.length === 0){ alert('追加する注文がありません'); return; }
        try {
          await fetchJSON(`/api/sessions/${sessionId}/orders/`, 'POST', pending);
          closeAllModals();
          await loadSession();
        } catch(err){
          alert('注文追加に失敗しました: ' + err.message);
        }
      });

      // cancel
      const cancelBtn = container.querySelector('#cancelModal');
      if(cancelBtn) cancelBtn.addEventListener('click', closeAllModals);
    });

    /* ---------- Receipt view & image generation (improved per-user breakdown) ---------- */
    const receiptModal = qs('#receiptModal');
    const receiptContainer = qs('#receiptContainer');
    if(openReceiptViewBtn){
      openReceiptViewBtn.addEventListener('click', async () => {
        try {
          const r = await fetchJSON(`/api/sessions/${sessionId}/receipt/`);
          // Build per-person blocks: server returns members with 'lines' where each line has item, qty, amount
          let membersHtml = '';
          (r.members || []).forEach(m => {
            const linesHtml = (m.lines || []).map(l => {
              const isShared = !!l.shared;
              const displayQty = (Number(l.qty) < 1 && Number(l.qty) > 0) ? 1 : Math.round(Number(l.qty));
              const sharedLabel = isShared ? `<small style="margin-left:6px;color:var(--muted)">[割り勘]</small>` : '';
              return `<div style="display:flex;justify-content:space-between;padding:6px 0;align-items:center"><div style="display:flex;gap:8px;align-items:center"><div>${escapeHtml(l.item)} x${displayQty}${sharedLabel}</div></div><div>¥${formatInt(Math.round(l.amount))}</div></div>`;
            }).join('');
            membersHtml += `
              <div class="person" style="border-top:1px dashed rgba(255,255,255,0.03);padding:8px 0">
                <div style="font-weight:700;display:flex;justify-content:space-between;align-items:center">
                  <div>${escapeHtml(m.name)}</div>
                  <div style="font-weight:800">¥${formatInt(Math.round(m.total))}</div>
                </div>
                <div class="person-list" style="margin-top:8px">${linesHtml}</div>
              </div>
            `;
          });

          const html = `
            <div id="receipt">
              <h2>${escapeHtml(r.session.name)}</h2>
              <div class="small muted">${escapeHtml(r.session.store_name||'')} ・ ${new Date(r.session.created_at).toLocaleString()}</div>
              <div class="receipt-list" style="margin-top:8px; max-height:60vh; overflow:auto;">${membersHtml}</div>
              <div style="height:10px"></div>
              <div style="border-top:1px solid rgba(255,255,255,0.04);padding-top:8px">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px"><div class="muted">合計</div><div>¥${formatInt(Math.round(r.raw_total))}</div></div>
                <div style="display:flex;justify-content:space-between;margin-bottom:6px"><div class="muted">割引</div><div>-${r.discount_text}</div></div>
                <div style="display:flex;justify-content:space-between;font-weight:700"><div class="muted">請求合計</div><div>¥${formatInt(Math.round(r.final_total))}</div></div>
              </div>
              <div style="height:12px"></div>
              <div class="small muted">この画面を画像化して保存してください</div>
              <div style="height:10px"></div>
              <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
                <button class="btn secondary" id="closeReceipt">閉じる</button>
                <button class="btn primary" id="exportReceipt">画像生成</button>
              </div>
            </div>
          `;
          if(receiptContainer) receiptContainer.innerHTML = html;
          if(receiptModal) receiptModal.classList.remove('hidden');

          const closeBtn = receiptContainer.querySelector('#closeReceipt');
          if(closeBtn) closeBtn.addEventListener('click', () => receiptModal.classList.add('hidden'));

          const exportBtn = receiptContainer.querySelector('#exportReceipt');
          if(exportBtn){
            exportBtn.addEventListener('click', async () => {
              const node = document.getElementById('receipt');
              if(!node) return alert('対象が見つかりません');
              // clone and expand lists for capture
              const clone = node.cloneNode(true);
              clone.querySelectorAll('.receipt-list').forEach(el => { el.style.maxHeight = 'none'; el.style.overflow = 'visible'; });
              clone.querySelectorAll('.person-list').forEach(el => { el.style.maxHeight = 'none'; el.style.overflow = 'visible'; });
              const wrapper = document.createElement('div');
              wrapper.style.position = 'fixed'; wrapper.style.left = '-10000px'; wrapper.style.top = '0'; wrapper.style.zIndex = '99999';
              wrapper.appendChild(clone); document.body.appendChild(wrapper);
              try {
                const canvas = await html2canvas(clone, { backgroundColor: null, scale: 2 });
                const url = canvas.toDataURL('image/png');
                const w = window.open('about:blank', '_blank');
                w.document.write(`<img src="${url}" style="max-width:100%"><p class="muted small">長押しまたは右クリックで保存してください</p>`);
              } catch(err){
                console.error(err); alert('画像生成に失敗しました');
              } finally {
                document.body.removeChild(wrapper);
              }
            }, { once: true });
          }
        } catch(err){
          console.error(err);
          alert('会計データ取得に失敗しました: ' + err.message);
        }
      });
    }

    // initial load
    loadSession();
  } // end if sessionRoot

})();
