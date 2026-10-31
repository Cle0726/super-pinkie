(() => {
  'use strict';
  if(window.__pinkieLearningPractice)return;
  const labels={c_program:'C语言',memory_lab:'指针内存图',circuit_lab:'电路',network_lab:'网络',math_check:'数学',english_reading:'英语阅读',english_writing:'英语写作',review_queue:'错题复习'};
  // 专升本整卷与单科卷：题目和答案由服务器从本机题库抽取（2027 考纲题型）。
  const papers={pro:'专业综合 300 分',ee:'电工电子卷',c:'C语言卷',net:'计网卷',math:'数学卷',en:'英语卷'};
  // 和碧琪在消息里自动放的是同一套实验，这里方便自己挑着打开。
  const concept=name=>['concept_lab',{concept:name}];
  const labs=[
    ['电工电子',[['欧姆定律',concept('ohm')],['串联分压',concept('series_divider')],['并联分流',concept('parallel_divider')],['RC 暂态',concept('rc_transient')],['RL 暂态',concept('rl_transient')],['正弦量',concept('sine_ac')],['RLC 谐振',concept('rlc_series')],['整流滤波',concept('rectifier')],['三极管工作点',concept('bjt_bias')],['比例运放',concept('opamp')],['逻辑函数',['logic_lab',{expression:"AB + A'C + BC"}]],['JK 触发器',['timing_lab',{device:'jk'}]],['计数器',['timing_lab',{device:'counter',bits:3,clocks:10}]]]],
    ['高数',[['重要极限',concept('limit')],['导数与切线',concept('derivative')],['定积分',concept('integral')],['微分方程',concept('ode')]]],
    ['计算机网络',[['子网划分',concept('subnet')],['三次握手',['sequence_lab',{template:'tcp_handshake'}]],['四次挥手',['sequence_lab',{template:'tcp_close'}]],['DNS 解析',['sequence_lab',{template:'dns_query'}]],['访问网页',['sequence_lab',{template:'http_request'}]]]],
  ];
  const wordCount=value=>(value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[]).length;
  const rpc=(method,params)=>window.__laolaoSidebar?.gwRequest?.(method,params,22000) || Promise.reject(Error('学习服务正在连接'));
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const action=(label,fn)=>{const n=el('button','pinkie-il-button',label);n.type='button';n.addEventListener('click',fn);return n;};
  let dialog;
  function cleanup(view){clearTimeout(view.practiceTimer);view.practiceTimer=0;}
  function render(view,h) {
    const {node,button,call,preserve,uid,mergeState}=h,body=view.body,record=view.data.visual,{kind,definition:d}=record;
    let state=record.state;
    const redraw=()=>{if(!view.disposed&&view.visible&&view.expanded&&view.element.isConnected)preserve(view.element,()=>view.renderContent());};
    const update=(patch,refresh=false)=>{
      state=view.data.visual.state=mergeState(view.data.visual.state,patch);
      if (((kind==='c_program'||kind==='memory_lab') && ('code' in patch || 'stdin' in patch))
        || (kind==='math_check' && ['operation','expression','answer','point'].some(key=>key in patch))) {
        state.result=null;
        for (const old of body.querySelectorAll('[data-practice-computed]')) old.hidden=true;
      }
      view.enqueue('visual',{state:patch});
      if(refresh)void view.flush().then(ok=>{if(ok)redraw();});
    };
    const apply=async patch=>{update(patch);if(!await view.flush())return false;redraw();return true;};
    const note=text=>body.append(node('p','pinkie-il-source',text));
    const field=(label,value,change,{type='text',options,rows=2,placeholder='',commit=false}={})=>{
      const wrap=node('label','pinkie-practice-field'),caption=node('span','',label);
      let input;
      if(options){input=node('select','pinkie-il-answer');for(const [id,title] of options) {const o=node('option','',title);o.value=id;input.append(o);}input.value=String(value);input.addEventListener('change',()=>change(input.value));}
      else if(type==='textarea'){input=node('textarea','pinkie-il-answer');input.rows=rows;input.maxLength=(kind==='c_program'||kind==='memory_lab')?16000:8000;input.value=value;input.addEventListener('input',()=>change(input.value));}
      else {input=node('input','pinkie-il-answer');input.type=type;input.value=value;input.addEventListener(type==='number'||commit?'change':'input',()=>change(type==='number'?Number(input.value):input.value));}
      input.setAttribute('aria-label',label);input.placeholder=placeholder;wrap.append(caption,input);body.append(wrap);return input;
    };
    const controls=node('div','pinkie-practice-controls');
    const check=()=>body.append(button('核对预测',()=>{void apply({check:true});},'pinkie-il-primary'));
    const requestTeacher=async(message,btn)=>{
      if(btn)btn.disabled=true;
      try{if(!await view.flush())return;await call('chat.send',{sessionKey:view.ref.sessionKey,idempotencyKey:uid(),message});view.say('已交给碧琪，讲解会回到这段对话');}
      catch(error){view.say(error.message,true);}finally{if(btn)btn.disabled=false;}
    };
    const table=(headers,rows)=>{
      const wrap=node('div','pinkie-practice-table-wrap'),t=node('table','pinkie-practice-table'),head=node('tr');
      for(const label of headers)head.append(node('th','',label));const thead=node('thead');thead.append(head);t.append(thead);
      const tbody=node('tbody');for(const row of rows){const tr=node('tr');for(const value of row)tr.append(node('td','',Array.isArray(value)?JSON.stringify(value):String(value??'')));tbody.append(tr);}t.append(tbody);wrap.append(t);body.append(wrap);return wrap;
    };
    const run=()=>{
      const go=button('运行核验',async()=>{
        go.disabled=true;
        try{
          if(!await view.flush())return;
          view.say('正在运行…');
          const revision=view.data.visual.revision;
          const result=await call('pinkie.learning.practice.run',{sessionKey:view.ref.sessionKey,id:view.ref.id,revision});
          if(view.disposed)return;
          // A response cannot overwrite input typed while the compiler worked.
          view.data.visual=result.visual;
          for(const pending of view.pending.values())if(pending.state)view.data.visual.state=mergeState(view.data.visual.state,pending.state);
          if(view.pending.size){view.data.visual.state.result=null;view.say('输入已修改，请重新运行');}
          else {view.say('核验完成');redraw();}
        }catch(error){view.say(error.message,true);}finally{go.disabled=false;}
      },'pinkie-il-primary');body.append(go);
    };
    if((kind==='c_program'||kind==='memory_lab')){
      note(kind==='memory_lab'?(state.result?'按步骤观察代码与指针关系，点击内存格可查看当前值。本次真实运行的状态见下方；修改后可重新运行。':'代码尚未完成真实运行。展开原代码并点击“运行核验”后，再观察内存关系。'):'先预测输出，再用真实Clang运行。逐步观察支持主函数中的基础分支、循环、数值数组及指针；其他语法仍可查看真实运行结果。');
      const beforeEditor=new Set(body.children);
      const code=field('C代码',state.code,value=>update({code:value}),{type:'textarea',rows:11});code.spellcheck=false;code.classList.add('pinkie-practice-code-editor');
      field('标准输入',state.stdin,value=>update({stdin:value}),{type:'textarea'});
      if(kind!=='memory_lab')field('我预测的输出',state.prediction,value=>update({prediction:value}));
      run();
      const result=state.result;
      if(kind==='memory_lab'){
        const editor=node('details','pld-details'),summary=node('summary','','查看或修改原代码');editor.append(summary);editor.open=!result?.trace?.verifiedOutput;
        for(const element of [...body.children])if(!beforeEditor.has(element))editor.append(element);
        body.append(editor);
      }
      if(result){
        const previous=new Set(body.children);
        if(result.trace?.undefinedBehavior)note('检测到未定义行为：本次输出不能当作标准答案，请先修正代码。');
        body.append(node('p','pinkie-il-verdict',!result.compiled?'编译未通过':result.timedOut?'运行超时':result.exitCode===0?'运行完成':`运行未正常结束（${result.exitCode}）`));
        if(result.stdout&&(kind!=='memory_lab'||!result.trace?.verifiedOutput))body.append(node('pre','pinkie-practice-output',result.stdout));
        if(result.stderr)body.append(node('pre','pinkie-practice-output pinkie-il-error',result.stderr));
        if(result.truncated)note('输出较长，已按运行上限截取。');
        if(result.exitCode===0&&state.prediction.trim())note(state.prediction.trim()===result.stdout.trim()?'预测与真实输出一致；继续解释每一步为什么这样变化。':'预测与真实输出不同，可以逐步找出差异。');
        const trace=result.trace;
        if(trace?.verifiedOutput&&trace.frames.length){
          view.traceIndex=Math.min(kind==='memory_lab'?(state.traceStep||0):(view.traceIndex||0),trace.frames.length-1);const frame=trace.frames[view.traceIndex];
          const nav=node('div','pinkie-il-actions'),prev=button('上一步',()=>{view.traceIndex=Math.max(0,view.traceIndex-1);if(kind==='memory_lab')update({traceStep:view.traceIndex});redraw();}),next=button('下一步',()=>{view.traceIndex=Math.min(trace.frames.length-1,view.traceIndex+1);if(kind==='memory_lab')update({traceStep:view.traceIndex});redraw();});prev.disabled=view.traceIndex===0;next.disabled=view.traceIndex===trace.frames.length-1;nav.append(prev,node('span','',`${view.traceIndex+1}/${trace.frames.length}步 · 第${frame.line}行`),next);body.append(nav);
          const lines=node('pre','pinkie-practice-code');for(const [index,line] of state.code.split('\n').entries()){const row=node('span','',`${index+1}  ${line}\n`);if(index+1===frame.line)row.dataset.active='true';lines.append(row);}body.append(lines);
          if(frame.memory?.length&&window.__pinkieLearningDevices)window.__pinkieLearningDevices.renderMemory(body,frame.memory,h,view);
          if(kind!=='memory_lab')table(['变量','类型','当前值'],frame.variables.map(v=>[v.name,v.type,v.value]));
          else {
            const diagram=body.querySelector('.pld-memory'),layout=node('div','pld-memory-trace-layout');
            if(diagram){lines.before(layout);layout.append(lines,diagram);}
          }
          if(frame.stdout)body.append(node('pre','pinkie-practice-output',frame.stdout));
          note('逐步观察来自受限AST解释器，并已与本次真实标准输出核对；不等同于完整C调试器。');
        }else if(trace?.message)note(trace.message);
        for(const added of body.children)if(!previous.has(added))added.dataset.practiceComputed='1';
      }
    }else if(kind==='math_check'){
      field('核验类型',state.operation,value=>update({operation:value},true),{options:[['derivative','求导'],['integral','不定积分'],['limit','双侧极限'],['simplify','化简']]});
      field('表达式',state.expression,value=>update({expression:value}),{placeholder:'例如 sin(x)/x，乘法写成 *'});
      if(state.operation==='limit')field('x趋近于',state.point,value=>update({point:value}));
      field('我的结果（可选）',state.answer,value=>update({answer:value}),{placeholder:'积分填写一个原函数，无需写+C'});run();
      note('支持x、pi、e、四则运算、乘方、sin/cos/tan/exp/log/sqrt/abs。');
      if(state.result){const previous=new Set(body.children);const r=state.result;body.append(node('pre','pinkie-practice-output',r.result||r.message));if(r.matches!==null&&r.matches!==undefined)note(r.matches?'符号计算与所填结果一致。':'所填结果未通过符号核验，请检查步骤和适用条件。');if(r.left!==undefined)note(`左极限 ${r.left}；右极限 ${r.right}`);if(r.result)note(r.message);for(const added of body.children)if(!previous.has(added))added.dataset.practiceComputed='1';}
    }else if(kind==='circuit_lab'||kind==='network_lab'){
      const p=state.parameters;
      const parameter=(key,label,options)=>field(label,p[key],value=>update({parameters:{[key]:value}},true),options?{options}:{type:typeof p[key]==='number'?'number':'text',commit:true});
      if(kind==='circuit_lab'){
        parameter('circuit','电路',[['series','电阻串联'],['parallel','电阻并联'],['rc','RC充电'],['inverting','反相运放'],['noninverting','同相运放'],['logic','逻辑门']]);
        if(p.circuit==='logic'){parameter('logic','逻辑门',[['and','AND'],['or','OR'],['xor','XOR'],['nand','NAND']]);for(const key of ['a','b'])field(`输入${key.toUpperCase()}`,p[key],value=>update({parameters:{[key]:Number(value)}},true),{options:[['0','0'],['1','1']]});}
        else {parameter('voltage','电源/输入电压（V）');parameter('r1',p.circuit.includes('inverting')?'Rin/Rg（Ω）':'R1（Ω）');if(p.circuit!=='rc')parameter('r2',p.circuit.includes('inverting')?'Rf（Ω）':'R2（Ω）');if(p.circuit==='rc'){parameter('capacitance','电容（μF）');parameter('time','观察时刻（秒）');}if(p.circuit.includes('inverting'))parameter('supply','双电源轨 ±V');}
        const diagram=node('div','pinkie-practice-diagram',p.circuit==='logic'?`A=${p.a} ─┐\n      ${p.logic.toUpperCase()} ─ 输出\nB=${p.b} ─┘`:p.circuit==='parallel'?`           ┌─ R1=${p.r1}Ω ─┐\nU=${p.voltage}V ─┤               ├─ 回路\n           └─ R2=${p.r2}Ω ─┘`:p.circuit==='rc'?`U=${p.voltage}V ─ R=${p.r1}Ω ─ C=${p.capacitance}μF ─ 回路`:(p.circuit==='inverting'||p.circuit==='noninverting')?`输入 ${p.voltage}V → ${p.circuit==='inverting'?'反相':'同相'}放大器 → 输出\nRin/Rg=${p.r1}Ω；Rf=${p.r2}Ω`:`U=${p.voltage}V ─ R1=${p.r1}Ω ─ R2=${p.r2}Ω ─ 回路`);body.append(diagram);
      }else{
        parameter('mode','练习',[['subnet','子网划分'],['troubleshoot','网络排障']]);parameter('ip','本机IPv4');parameter('prefix','前缀长度');
        if(p.mode==='troubleshoot'){
          parameter('peer','目标主机IPv4');parameter('gateway','默认网关');parameter('clientVlan','本机VLAN');parameter('peerVlan','目标VLAN');parameter('destination','访问目标',[['peer','同一教学拓扑主机'],['internet','外网IP'],['website','外网域名']]);
          for(const [key,label] of [['trunk','交换机间链路允许当前VLAN'],['dhcp','DHCP成功分配当前IP'],['dns','DNS可用']]){
            const wrap=node('label','pinkie-practice-check'),input=node('input');input.type='checkbox';input.checked=p[key];input.addEventListener('change',()=>update({parameters:{[key]:input.checked}},true));wrap.append(input,node('span','',label));body.append(wrap);
          }
          body.append(node('div','pinkie-practice-diagram','PC → 接入交换机 → 交换机间链路 → 目标/网关 → 外网'));
        }
      }
      field(kind==='circuit_lab'?'预测电流/输出电压/逻辑电平':'预测网络地址，或写下排障判断',state.prediction,value=>update({prediction:value}));check();
      if(record.analysis&&state.checked){const r=record.analysis;
        if(kind==='circuit_lab'){
          body.append(node('p','pinkie-il-verdict',`${Number(r.value.toPrecision(7))} ${r.unit}`),node('p','',r.formula));
          if(r.resistance!==undefined)note(`等效电阻 ${Number(r.resistance.toPrecision(7))}Ω`);if(r.gain!==undefined)note(`线性区增益 ${r.gain}；理想线性输出 ${r.ideal}V`);if(r.tau!==undefined)note(`时间常数 τ=${r.tau}s`);
          if(r.samples)plotSamples(body,r.samples,h);
        }else {
          table(['项目','计算结果'],[['网络地址',r.network],['掩码',r.mask],['广播地址',r.broadcast],['普通主机范围',`${r.first} – ${r.last}`],['可用主机数',r.hosts]]);
          if(p.mode==='troubleshoot'){body.append(node('p','pinkie-il-verdict',r.reachable?'当前教学拓扑可达':r.issue));const steps=node('nav','pinkie-il-flow');for(const [i,label] of r.path.entries())steps.append(button(`${i+1}. ${label}`,()=>update({step:i},true)));body.append(steps);note(`当前查看：${r.path[Math.min(state.step,r.path.length-1)]}。${r.issue||'各检查项在当前假设下通过。'}`);}
        }
        note(r.note);note(`你的预测：${state.prediction}。实验操作本身不计为已掌握。`);
      }
    }else if(kind==='english_reading'){
      note('先选答案，再点选支持答案的原文句子。');
      const passage=node('div','pinkie-practice-passage');
      for(const [index,sentence] of d.sentences.entries()){
        const pick=button(sentence,()=>{if(state.checked)return;const evidence=state.evidence.includes(index)?state.evidence.filter(i=>i!==index):[...state.evidence,index];update({evidence});pick.setAttribute('aria-pressed',String(evidence.includes(index)));});pick.disabled=state.checked;pick.setAttribute('aria-pressed',String(state.evidence.includes(index)));pick.dataset.sentence=String(index);passage.append(pick);
      }body.append(passage,node('h3','',d.question.question));
      for(const option of d.question.options){const pick=button(`${option.id}. ${option.label}`,()=>{update({answer:option.id});for(const n of body.querySelectorAll('[data-reading-answer]'))n.setAttribute('aria-pressed',String(n.dataset.readingAnswer===option.id));});pick.dataset.readingAnswer=option.id;pick.disabled=state.checked;pick.setAttribute('aria-pressed',String(state.answer===option.id));controls.append(pick);}body.append(controls);
      if(!state.checked)body.append(button('核对答案与证据',()=>{void apply({check:true});},'pinkie-il-primary'));
      else {const r=record.analysis;body.append(node('p','pinkie-il-verdict',r.correct?'答案正确':'再检查答案'),node('p','',r.evidenceCorrect?'证据与参考解析一致。':'证据与参考解析不同，请回看原句。'),node('p','',r.explanation));body.append(button('重新练习',()=>{void apply({reset:true});}));}
    }else if(kind==='english_writing'){
      body.append(node('p','pinkie-il-problem',d.prompt));const counter=node('p','pinkie-il-source',`${wordCount(state.draft)}词 · 目标${d.minWords}–${d.maxWords}词`);
      field('我的作文',state.draft,value=>{update({draft:value});counter.textContent=`${wordCount(value)}词 · 目标${d.minWords}–${d.maxWords}词`;},{type:'textarea',rows:8});body.append(counter);
      const ask=button('请碧琪批改',async()=>{
        if(!await apply({requestFeedback:true}))return;
        const current=view.data.visual;
        await requestTeacher(`请批改这张英语写作卡。activity_id: ${view.ref.id}\n题目：${d.prompt}\n原稿：${current.state.draft}\n用learning_activity action=feedback回填，draft逐字使用这份原稿，changes只引用真实片段。检查内容、结构、语法，给参考建议并保留原意，不给确定考试分数。`,ask);
      },'pinkie-il-primary');body.append(ask);
      if(state.feedback){note('碧琪参考建议');body.append(node('p','',state.feedback.summary));for(const change of state.feedback.changes){const item=node('div','pinkie-il-comparison-row');item.append(node('blockquote','',change.quote),node('p','',`建议：${change.proposal}`),node('p','',change.reason));body.append(item);}}
    }else if(kind==='mock_exam'){
      note(d.origin);const total=d.questions.reduce((sum,q)=>sum+q.points,0);
      if(state.phase==='ready'){
        note(`${d.questions.length}题 · ${total}分 · ${d.durationMinutes}分钟。开始后服务器计时，关闭卡片仍继续计时。`);
        body.append(button('开始模拟',()=>{void apply({start:true});},'pinkie-il-primary'));return;
      }
      const results=state.results||[],selected=d.questions.find(q=>q.id===state.selected)||d.questions[0];
      if(state.phase==='running'){
        const clock=node('div','pinkie-il-verdict');body.append(clock);
        const tick=()=>{
          if(view.disposed||!view.visible||!view.expanded||document.hidden)return;
          const seconds=Math.max(0,Math.ceil((state.deadline-Date.now())/1000));clock.textContent=`剩余 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
          if(!seconds){void apply({submit:true}).then(ok=>{if(!ok)void view.load(true);});return;}
          view.practiceTimer=setTimeout(tick,1000);
        };tick();
      }else {const a=record.analysis;body.append(node('p','pinkie-il-verdict',a.pending?`已确定 ${a.earned}分；${a.pending}道主观题（${a.pendingPoints}分）待评`:`${a.earned} / ${a.total}分`));if(results.some(r=>r.gradeSource==='model-reference'))note('主观题为模型参考评分，非正式阅卷。');}
      const nav=node('nav','pinkie-il-items');nav.setAttribute('aria-label','模拟卷题号');
      for(const [index,q] of d.questions.entries()){const tab=button(`${index+1}${state.answers[q.id]?' ✓':''}${state.flags[q.id]?' ⚑':''}`,()=>{
        if(state.phase==='submitted'){view.data.visual.state.selected=q.id;redraw();}else update({selected:q.id},true);
      });tab.setAttribute('aria-current',String(q.id===selected.id));nav.append(tab);}body.append(nav);
      body.append(node('h3','',`第 ${d.questions.indexOf(selected)+1} 题${selected.subject?' · '+selected.subject:''}（${selected.points}分）`),node('p','pinkie-il-problem',selected.question));
      if(state.phase==='running'){
        if(selected.options.length){for(const o of selected.options){const btn=button(`${o.id}. ${o.label}`,()=>{update({answers:{[selected.id]:o.id}});for(const entry of controls.children)entry.setAttribute('aria-pressed',String(entry.dataset.option===o.id));});btn.dataset.option=o.id;btn.setAttribute('aria-pressed',String(state.answers[selected.id]===o.id));controls.append(btn);}body.append(controls);}
        else field('本题答案',state.answers[selected.id]||'',value=>update({answers:{[selected.id]:value}}),{type:'textarea',rows:selected.kind==='short_answer'?4:2});
        const actions=node('div','pinkie-il-actions');actions.append(button(state.flags[selected.id]?'取消标记':'标记待检查',()=>update({flags:{[selected.id]:!state.flags[selected.id]}},true)),button('交卷',()=>{void apply({submit:true});},'pinkie-il-primary'));body.append(actions);
      }else {
        // Choice answers are option ids; show the option text so the result reads like the paper.
        const r=results.find(r=>r.id===selected.id),optionText=id=>{const o=selected.options.find(o=>o.id===id);return o?`${o.id}. ${o.label}`:id;};
        body.append(node('p','',`你的答案：${r?.answer?optionText(r.answer):'未作答'}`),node('p','',r?.pending?'待批改':`本题 ${r?.score??0} / ${selected.points}分`),node('p','',r?.feedback||r?.explanation||''));if(r?.reference)note(`参考答案：${optionText(r.reference)}`);
        if(record.analysis.pending){const ask=button('请碧琪批改主观题',async()=>{if(!await apply({requestFeedback:true}))return;await requestTeacher(`请批改已交卷模拟卷中的待评主观题。activity_id: ${view.ref.id}\n${JSON.stringify(d.questions.filter(q=>results.find(r=>r.id===q.id)?.pending).map(q=>({id:q.id,question:q.question,points:q.points,answer:state.answers[q.id],reference:q.answer||q.explanation})))}\n使用learning_activity action=feedback和item_results逐题回填item_id、原始answer、score、feedback。保持客观评分不变，说明是参考评分。`,ask);});body.append(ask);}
      }
    }else if(kind==='review_queue'){
      const r=record.analysis;note(`当前会话：${r.total}道待巩固，${r.due}道到期。只有隔天独立复测通过才确认巩固。`);
      body.append(button(state.dueOnly?'查看全部错题':'只看到期错题',()=>update({dueOnly:!state.dueOnly},true)),button('刷新',()=>{void view.load(true);}));
      if(!r.items.length)note(state.dueOnly?'当前没有到期错题，可以查看全部错题提前练习。':'当前还没有待巩固错题。');
      for(const item of r.items){const row=node('article','pinkie-practice-review');row.append(node('strong','',item.question),node('p','',`原答：${item.answerText}`),node('p','',`错因：${item.errorType||item.result?.feedback||'待进一步分析'}`),node('small','',`${item.hintUsed?'用过提示':'未用提示'} · ${item.practicePassedBy?'已同日练过，等待延迟复测':'待练习'} · ${item.nextRetestAt?new Date(item.nextRetestAt).toLocaleString():'未安排'}`));
        const retry=button('换题复测',async()=>{await requestTeacher(`我选择复测这道错题，请出一道检验同一错因的新题，不直接重复答案。原作答ID: ${item.id}\n原题: ${item.question}\n真实原答: ${item.answerText}\n错因: ${item.errorType||item.result?.feedback||''}\n请用learning_activity present，retry_of=${item.id}，先让我独立作答，记录是否用提示。`,retry);});row.append(retry);body.append(row);}
      if(r.hasMore)note('本次显示最早的30道；完成复测后刷新继续。');
    }
  }
  function plotSamples(body,samples,{node}){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 400 150');svg.setAttribute('role','img');svg.setAttribute('aria-label','RC充电曲线，横轴时间、纵轴电容电压');svg.classList.add('pinkie-practice-wave');
    const maxx=samples.at(-1).x||1,maxy=Math.max(1,...samples.map(p=>Math.abs(p.y)));
    const path=document.createElementNS(ns,'path');path.setAttribute('d',samples.map((p,i)=>`${i?'L':'M'}${30+p.x/maxx*350},${75-p.y/maxy*60}`).join(' '));path.setAttribute('class','pinkie-il-curve');svg.append(path);body.append(svg,node('p','pinkie-il-source',`0 – ${maxx.toPrecision(4)}秒 · 电压范围±${maxy.toPrecision(4)}V`));
  }
  async function open(sessionKey){
    if(!/^agent:learning:/.test(sessionKey||''))throw Error('请先进入学习会话');
    if(dialog?.isConnected){dialog.focus();return;}
    const focus=document.activeElement;
    dialog=el('dialog','pinkie-practice-dialog');const currentDialog=dialog,head=el('header','pinkie-il-header'),status=el('p','pinkie-il-source'),tabs=el('nav','pinkie-il-items'),slot=el('div');
    head.append(el('strong','','练习与实验'),action('关闭',()=>dialog.close()));dialog.append(head,tabs,status,slot);document.body.append(dialog);
    let generation=0;
    const show=async(kind,ref,visual)=>{
      const gen=++generation;status.textContent='正在准备…';
      try{
        const data=ref?{inline:ref}:await rpc('pinkie.learning.practice.open',{sessionKey,kind,...(visual?{visual}:{})});
        if(gen!==generation||!currentDialog.isConnected)return;
        if(!window.__pinkieLearningInline?.mount)throw Error('题卡组件尚未就绪');
        window.__pinkieLearningInline.mount(data.inline,slot);status.textContent='操作和草稿会保存在本机会话中';
      }catch(error){if(gen===generation)status.textContent=error.message;}
    };
    for(const [kind,label] of Object.entries(labels))tabs.append(action(label,()=>{void show(kind);}));
    for(const [group,items] of labs){
      const nav=el('nav','pinkie-il-items pinkie-practice-labs');nav.setAttribute('aria-label',group+'实验');nav.append(el('span','pinkie-practice-group',group));
      for(const [label,[kind,visual]] of items)nav.append(action(label,()=>{void show(kind,null,visual);}));
      dialog.insertBefore(nav,status);
    }
    const paperTabs=el('nav','pinkie-il-items');paperTabs.setAttribute('aria-label','专升本模拟卷');
    for(const [paper,label] of Object.entries(papers))paperTabs.append(action(label,()=>{void show('mock_exam',null,{bank:{paper}});}));
    dialog.insertBefore(paperTabs,status);
    const recent=el('select','pinkie-il-answer');recent.setAttribute('aria-label','恢复最近练习');const placeholder=el('option','','恢复最近练习…');placeholder.value='';recent.append(placeholder);dialog.insertBefore(recent,slot);
    let references=[];recent.addEventListener('change',()=>{const ref=references.find(r=>r.id===recent.value);if(ref)void show(ref.kind,ref);});
    dialog.addEventListener('close',()=>{generation++;currentDialog.remove();if(dialog===currentDialog)dialog=null;if(focus?.isConnected)focus.focus({preventScroll:true});},{once:true});
    dialog.addEventListener('click',event=>{if(event.target===currentDialog){const r=currentDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)currentDialog.close();}});
    dialog.showModal();
    void rpc('pinkie.learning.practice.list',{sessionKey}).then(result=>{if(!currentDialog.isConnected)return;references=result.items||[];for(const r of references){const option=el('option','',r.title);option.value=r.id;recent.append(option);}}).catch(()=>{});
    status.textContent='选择练习类型，或恢复最近练习';
  }
  window.__pinkieLearningPractice={render,cleanup,open,wordCount};
})();
