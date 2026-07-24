(() => {
  'use strict';
  const STORAGE_KEY='session_presets_v1';
  const SETTINGS_KEY='session_settings_v1';
  const DEFAULT_PRESETS=[
    {id:'p45-5',focus:45,brk:5,label:'45–5'},
    {id:'p45-7',focus:45,brk:7,label:'45–7'},
    {id:'p45-10',focus:45,brk:10,label:'45–10'},
    {id:'p30-5',focus:30,brk:5,label:'30–5'},
    {id:'p30-7',focus:30,brk:7,label:'30–7'},
    {id:'p30-10',focus:30,brk:10,label:'30–10'}
  ];
  const cloneDefaults=()=>DEFAULT_PRESETS.map(p=>({...p}));
  const sanitizePreset=(p)=>{
    if(!p||typeof p!=='object')return null;
    const focus=Number.parseInt(p.focus,10),brk=Number.parseInt(p.brk,10);
    if(!Number.isFinite(focus)||!Number.isFinite(brk)||focus<1||focus>180||brk<1||brk>60)return null;
    return{id:typeof p.id==='string'&&p.id?p.id:`p${Date.now()}-${Math.random()}`,focus,brk,label:`${focus}–${brk}`};
  };
  function loadPresets(){try{const p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!Array.isArray(p))return cloneDefaults();const safe=p.map(sanitizePreset).filter(Boolean);return safe.length?safe:cloneDefaults()}catch{return cloneDefaults()}}
  function loadSettings(){try{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');const n=Number.parseInt(s.selectedSets,10);return{selectedSets:Number.isFinite(n)&&n>=1&&n<=8?n:3,activePresetId:typeof s.activePresetId==='string'?s.activePresetId:null}}catch{return{selectedSets:3,activePresetId:null}}}
  let presets=loadPresets();const settings=loadSettings();let activePresetId=presets.some(p=>p.id===settings.activePresetId)?settings.activePresetId:presets[0].id;let selectedSets=settings.selectedSets;
  const savePresets=()=>localStorage.setItem(STORAGE_KEY,JSON.stringify(presets));
  const saveSettings=()=>localStorage.setItem(SETTINGS_KEY,JSON.stringify({activePresetId,selectedSets}));
  const timer={phase:'idle',currentSet:1,totalSets:3,phaseEndAt:null,phaseDurationMs:0,remainingMsAtPause:null,paused:false};
  let tickHandle=null,wakeLock=null,audioCtx=null,activeModal=null;
  const $=id=>document.getElementById(id);
  const tabbar=$('tabbar'),setupView=$('setupView'),runView=$('runView'),runControls=$('runControls'),presetLabel=$('presetLabel'),presetDetail=$('presetDetail'),setPicker=$('setPicker'),startBtn=$('startBtn'),pauseBtn=$('pauseBtn'),stopBtn=$('stopBtn'),clockDisplay=$('clockDisplay'),runEyebrow=$('runEyebrow'),runSubline=$('runSubline'),ringFg=$('ringFg'),footerNote=$('footerNote'),body=document.body;
  const RING_CIRC=2*Math.PI*92;ringFg.style.strokeDasharray=`${RING_CIRC}`;ringFg.style.strokeDashoffset=`${RING_CIRC}`;
  const getActivePreset=()=>presets.find(p=>p.id===activePresetId)||presets[0];

  function renderTabs(){
    tabbar.replaceChildren();
    presets.forEach(p=>{
      const b=document.createElement('button');b.type='button';b.className=`tab${p.id===activePresetId?' active':''}`;b.textContent=p.label;b.setAttribute('aria-pressed',String(p.id===activePresetId));b.title=`${p.label}。長押しまたは右クリックで編集`;
      b.addEventListener('click',()=>{if(timer.phase!=='idle')return;activePresetId=p.id;saveSettings();renderTabs();renderSetup();b.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'})});
      b.addEventListener('contextmenu',e=>{e.preventDefault();if(timer.phase==='idle')openEditor(p.id)});
      let press=null,long=false;b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||timer.phase!=='idle')return;long=false;press=setTimeout(()=>{long=true;navigator.vibrate?.(30);openEditor(p.id)},550)});const clear=()=>{if(press!==null)clearTimeout(press);press=null};b.addEventListener('pointerup',e=>{clear();if(long){e.preventDefault();long=false}});b.addEventListener('pointercancel',clear);b.addEventListener('pointerleave',clear);tabbar.appendChild(b);
    });
    const add=document.createElement('button');add.type='button';add.className='tab add';add.textContent='＋';add.setAttribute('aria-label','新しいプリセットを追加');add.disabled=timer.phase!=='idle';add.addEventListener('click',()=>openEditor(null));tabbar.appendChild(add);
  }
  function renderSetup(){const p=getActivePreset();presetLabel.textContent=p.label;presetDetail.textContent=`集中 ${p.focus}分 ・ 休憩 ${p.brk}分`;setPicker.replaceChildren();for(let i=1;i<=8;i++){const b=document.createElement('button');b.type='button';b.className=`set-btn${i===selectedSets?' selected':''}`;b.textContent=String(i);b.setAttribute('aria-pressed',String(i===selectedSets));b.setAttribute('aria-label',`${i}セット`);b.addEventListener('click',()=>{selectedSets=i;saveSettings();renderSetup()});setPicker.appendChild(b)}}
  function showSetup(){runView.classList.add('hidden');runControls.classList.add('hidden');setupView.classList.remove('hidden');body.classList.remove('mode-focus','mode-break');footerNote.textContent='集中と休憩を、迷わず切り替える。';document.title='Session — Pomodoro';renderTabs();renderSetup()}
  function showRun(){setupView.classList.add('hidden');runView.classList.remove('hidden');runControls.classList.remove('hidden')}
  function setPhase(phase,minutes,base=Date.now()){timer.phase=phase;timer.phaseDurationMs=minutes*60000;timer.phaseEndAt=base+timer.phaseDurationMs;timer.remainingMsAtPause=null}
  async function primeAudio(){try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')await audioCtx.resume()}catch{}}
  async function startSession(){const p=getActivePreset();await primeAudio();timer.currentSet=1;timer.totalSets=selectedSets;timer.paused=false;setPhase('focus',p.focus);pauseBtn.textContent='一時停止';showRun();await requestWakeLock();startTicking();render()}
  function advancePhase(base=Date.now(),notify=true){const p=getActivePreset();if(timer.phase==='focus'){setPhase('break',p.brk,base);if(notify)playChime('break');return true}if(timer.phase==='break'){if(timer.currentSet>=timer.totalSets){finishSession();return false}timer.currentSet+=1;setPhase('focus',p.focus,base);if(notify)playChime('focus');return true}return false}
  function finishSession(){playChime('done');timer.phase='idle';timer.paused=false;stopTicking();releaseWakeLock();showSetup()}
  function stopSessionManually(){timer.phase='idle';timer.paused=false;stopTicking();releaseWakeLock();showSetup()}
  function togglePause(){if(timer.phase==='idle')return;if(!timer.paused){timer.paused=true;timer.remainingMsAtPause=Math.max(0,timer.phaseEndAt-Date.now());pauseBtn.textContent='再開する';footerNote.textContent='一時停止中';stopTicking();releaseWakeLock();render(timer.remainingMsAtPause)}else{timer.paused=false;timer.phaseEndAt=Date.now()+timer.remainingMsAtPause;pauseBtn.textContent='一時停止';footerNote.textContent='画面を閉じても時間は進みます。';requestWakeLock();startTicking()}}
  function startTicking(){stopTicking();tickHandle=setInterval(tick,250);tick()}
  function stopTicking(){if(tickHandle!==null)clearInterval(tickHandle);tickHandle=null}
  function catchUp(now=Date.now()){let guard=0;while(timer.phase!=='idle'&&timer.phaseEndAt<=now&&guard<50){const boundary=timer.phaseEndAt;if(!advancePhase(boundary,false))break;guard++}if(timer.phase!=='idle'&&guard>0)playChime(timer.phase==='focus'?'focus':'break')}
  function tick(){if(timer.phase==='idle'||timer.paused)return;const now=Date.now();if(timer.phaseEndAt<=now)catchUp(now);if(timer.phase!=='idle')render(Math.max(0,timer.phaseEndAt-now))}
  function render(override){if(timer.phase==='idle')return;const remaining=override??Math.max(0,timer.phaseEndAt-Date.now()),total=Math.ceil(remaining/1000),mm=Math.floor(total/60).toString().padStart(2,'0'),ss=(total%60).toString().padStart(2,'0');clockDisplay.textContent=`${mm}:${ss}`;const focus=timer.phase==='focus';runEyebrow.textContent=focus?'集中':'休憩';runEyebrow.className=`eyebrow ${focus?'state-focus':'state-break'}`;runSubline.textContent=`セット ${timer.currentSet} / ${timer.totalSets}`;body.classList.toggle('mode-focus',focus);body.classList.toggle('mode-break',!focus);footerNote.textContent=timer.paused?'一時停止中':'画面を閉じても時間は進みます。';document.title=`${mm}:${ss} ${focus?'集中':'休憩'} — Session`;const progress=timer.phaseDurationMs>0?1-remaining/timer.phaseDurationMs:0;ringFg.style.strokeDashoffset=`${RING_CIRC*(1-Math.max(0,Math.min(1,progress)))}`}
  async function requestWakeLock(){try{if('wakeLock'in navigator&&document.visibilityState==='visible'){wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener?.('release',()=>{wakeLock=null},{once:true})}}catch{wakeLock=null}}
  function releaseWakeLock(){if(wakeLock)wakeLock.release().catch(()=>{});wakeLock=null}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&timer.phase!=='idle'&&!timer.paused){catchUp();if(timer.phase!=='idle'){startTicking();requestWakeLock()}}});
  function playChime(kind){if(!kind)return;try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});const now=audioCtx.currentTime,notes=kind==='focus'?[660,880]:kind==='break'?[523,440]:[523,659,784];notes.forEach((freq,i)=>{const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,now+i*.28);gain.gain.exponentialRampToValueAtTime(.25,now+i*.28+.03);gain.gain.exponentialRampToValueAtTime(.0001,now+i*.28+.32);osc.connect(gain).connect(audioCtx.destination);osc.start(now+i*.28);osc.stop(now+i*.28+.35)});navigator.vibrate?.(kind==='done'?[120,60,120,60,200]:[80,40,80])}catch{}}
  function closeEditor(){activeModal?.remove();activeModal=null}
  function openEditor(presetId){if(timer.phase!=='idle')return;closeEditor();const editing=presetId?presets.find(p=>p.id===presetId):null,backdrop=document.createElement('div');backdrop.className='backdrop';backdrop.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="editorTitle"><button class="close" id="modalClose" type="button" aria-label="閉じる">×</button><h2 id="editorTitle">${editing?'プリセットを編集':'新しいプリセット'}</h2><div class="fields"><div class="field"><label for="focusInput">集中（分）</label><input type="number" inputmode="numeric" id="focusInput" value="${editing?editing.focus:45}" min="1" max="180"></div><div class="field"><label for="breakInput">休憩（分）</label><input type="number" inputmode="numeric" id="breakInput" value="${editing?editing.brk:5}" min="1" max="60"></div></div><p class="error" id="modalError" aria-live="polite"></p><div class="modal-actions">${editing?'<button class="modal-btn delete" id="deleteBtn" type="button">削除</button>':''}<button class="modal-btn save" id="saveBtn" type="button">保存</button></div></section>`;activeModal=backdrop;document.body.appendChild(backdrop);const focusInput=backdrop.querySelector('#focusInput'),breakInput=backdrop.querySelector('#breakInput'),error=backdrop.querySelector('#modalError');backdrop.querySelector('#modalClose').addEventListener('click',closeEditor);backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeEditor()});backdrop.querySelector('#saveBtn').addEventListener('click',()=>{const focus=Number.parseInt(focusInput.value,10),brk=Number.parseInt(breakInput.value,10);if(!Number.isFinite(focus)||focus<1||focus>180){error.textContent='集中時間は1〜180分で入力してください。';return}if(!Number.isFinite(brk)||brk<1||brk>60){error.textContent='休憩時間は1〜60分で入力してください。';return}if(editing){editing.focus=focus;editing.brk=brk;editing.label=`${focus}–${brk}`}else{const p={id:`p${Date.now()}`,focus,brk,label:`${focus}–${brk}`};presets.push(p);activePresetId=p.id}savePresets();saveSettings();renderTabs();renderSetup();closeEditor()});backdrop.querySelector('#deleteBtn')?.addEventListener('click',()=>{if(presets.length<=1){error.textContent='プリセットは最低1件必要です。';return}presets=presets.filter(p=>p.id!==presetId);if(activePresetId===presetId)activePresetId=presets[0].id;savePresets();saveSettings();renderTabs();renderSetup();closeEditor()});requestAnimationFrame(()=>focusInput.focus())}
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&activeModal)closeEditor()});
  startBtn.addEventListener('click',startSession);pauseBtn.addEventListener('click',togglePause);stopBtn.addEventListener('click',()=>{if(confirm('セッションを終了しますか？'))stopSessionManually()});
  renderTabs();renderSetup();
  if('serviceWorker'in navigator&&location.protocol!=='file:')window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
})();
