// Interpret an explicit subset of compiler-produced AST data. No eval, source
// rewriting or execution inside the renderer. A trace is exposed only when its
// output agrees with the separate, real Clang run.
export function traceC(ast, source, stdout) {
  const cells = new Map(), frames = [], scopes = [];
  let output = '', budget = 6000;
  const stop = message => { throw Error(message); };
  const pointer = value => value && typeof value === 'object' && typeof value.base === 'string';
  const boundedPointer = address => {
    const target = cells.get(address.base);
    const length = Array.isArray(target?.value) ? target.value.length : 1;
    if (target?.alive === false) stop('指针所指对象的生命周期已经结束');
    if (!target || !Number.isInteger(address.index) || address.index < 0 || address.index > length) stop('指针运算越出同一对象及其尾后范围');
    return address;
  };
  const type = n => n?.type?.qualType || '';
  const cast = (value, n) => typeof value === 'number' && /^(?:unsigned )?(?:int|short|long|char)\b/.test(type(n))
    ? Math.trunc(value) : value;
  const resolve = ref => {
    const cell = cells.get(ref.base);
    if (!cell) stop('未知变量');
    if (cell.alive === false) stop('指针引用了生命周期已经结束的对象');
    if (Array.isArray(cell.value)) {
      if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index >= cell.value.length) stop('数组越界');
      return {get: () => cell.value[ref.index], set: value => { cell.value[ref.index] = cast(value, cell.node); }};
    }
    if (ref.index !== 0) stop('指针越界');
    return {get: () => cell.value, set: value => { cell.value = cast(value, cell.node); }};
  };
  const ref = n => {
    if (['ParenExpr', 'ImplicitCastExpr', 'CStyleCastExpr'].includes(n.kind)) return ref(n.inner[0]);
    if (n.kind === 'DeclRefExpr') return {base: n.referencedDecl.id, index: 0};
    if (n.kind === 'ArraySubscriptExpr') {
      const address = expr(n.inner[0]), index = expr(n.inner[1]);
      if (!pointer(address) || !Number.isInteger(index)) stop('不支持此数组下标');
      return {base: address.base, index: address.index + index};
    }
    if (n.kind === 'UnaryOperator' && n.opcode === '*') {
      const address = expr(n.inner[0]); if (!pointer(address)) stop('不是有效指针'); return address;
    }
    stop('不支持此赋值目标');
  };
  const binary = (op, a, b, n) => {
    if (pointer(a) && ['+', '-'].includes(op) && Number.isInteger(b)) return boundedPointer({base:a.base, index:a.index + (op === '+' ? b : -b)});
    if (pointer(a) && pointer(b) && op === '-') {
      if(a.base!==b.base)stop('不同对象的指针不能相减');
      return a.index-b.index;
    }
    if (typeof a !== 'number' || typeof b !== 'number') stop('不支持此运算');
    let value;
    switch (op) {
      case '+': value=a+b; break; case '-': value=a-b; break; case '*': value=a*b; break;
      case '/': if (!b) stop('除数为零'); value=a/b; break; case '%': if(!b)stop('除数为零'); value=a%b; break;
      case '<':return +(a<b);case '<=':return +(a<=b);case '>':return +(a>b);case '>=':return +(a>=b);
      case '==':return +(a===b);case '!=':return +(a!==b);default:stop('此运算暂不支持逐步观察');
    }
    if (!Number.isFinite(value) || Math.abs(value)>2147483647) stop('数值超出逐步观察范围');
    return cast(value,n);
  };
  const expr = n => {
    if (--budget < 0) stop('程序步骤过多');
    const children=n.inner || [];
    switch (n.kind) {
      case 'IntegerLiteral':case 'FloatingLiteral':case 'CharacterLiteral':return Number(n.value);
      case 'StringLiteral':try{return JSON.parse(n.value);}catch{stop('字符串格式不支持');}break;
      case 'ParenExpr':case 'ConstantExpr':case 'CStyleCastExpr':return cast(expr(children[0]),n);
      case 'ImplicitCastExpr':
        if (n.castKind==='ArrayToPointerDecay' && children[0].kind!=='StringLiteral') return ref(children[0]);
        if (n.castKind==='FunctionToPointerDecay') return {function:children[0].referencedDecl.name};
        return cast(expr(children[0]),n);
      case 'DeclRefExpr':case 'ArraySubscriptExpr': {
        const value=resolve(ref(n)).get(); if(value===undefined)stop('变量尚未初始化'); return value;
      }
      case 'UnaryOperator': {
        const op=n.opcode;
        if(op==='&')return ref(children[0]);
        if(op==='*')return resolve(ref(n)).get();
        if(op==='++'||op==='--'){
          const target=resolve(ref(children[0])), old=target.get();
          const value=pointer(old)?boundedPointer({base:old.base,index:old.index+(op==='++'?1:-1)}):binary(op==='++'?'+':'-',old,1,n);
          target.set(value);return n.isPostfix?old:value;
        }
        const value=expr(children[0]); if(typeof value!=='number')stop('不支持此指针运算');
        if(op==='-')return -value;if(op==='+')return value;if(op==='!')return +!value;
        stop('此一元运算暂不支持');break;
      }
      case 'BinaryOperator':case 'CompoundAssignOperator': {
        const op=n.opcode;
        if(op==='&&')return +(expr(children[0]) && Boolean(expr(children[1])));
        if(op==='||')return +(expr(children[0]) || Boolean(expr(children[1])));
        if(op==='='){const value=expr(children[1]);resolve(ref(children[0])).set(value);return value;}
        if(op.endsWith('=')&&!['<=','>=','==','!='].includes(op)) {
          const target=resolve(ref(children[0])),value=binary(op.slice(0,-1),target.get(),expr(children[1]),n);target.set(value);return value;
        }
        if(op===','){expr(children[0]);return expr(children[1]);}
        return binary(op,expr(children[0]),expr(children[1]),n);
      }
      case 'ConditionalOperator':return expr(children[0])?expr(children[1]):expr(children[2]);
      case 'CallExpr': {
        const fn=expr(children[0]).function,args=children.slice(1).map(expr);let addition='';
        if(fn==='puts'&&typeof args[0]==='string')addition=args[0]+'\n';
        else if(fn==='printf'&&typeof args[0]==='string') {
          let i=1; addition=args[0].replace(/%%|%(?:\.(\d{1,2}))?([difucs])/g,(format,precision,kind)=>{
            if(format==='%%')return '%';const value=args[i++];
            if(kind==='s'&&typeof value==='string')return value;
            if(kind==='c'&&typeof value==='number')return String.fromCharCode(value);
            if(typeof value!=='number')stop('printf参数格式不支持');
            return kind==='f'?value.toFixed(precision===undefined?6:Number(precision)):String(Math.trunc(value));
          });
          if(/%(?!%)/.test(addition)||i!==args.length)stop('printf格式暂不支持');
        } else stop('此函数请查看真实运行结果，暂不提供逐步观察');
        output+=addition;if(output.length>16000)stop('输出过长');return addition.length;
      }
      default:stop('当前语法暂不支持逐步观察');
    }
  };
  const snapshot = n => {
    if(frames.length>=160)stop('轨迹超过160步');
    const offset=n.range?.begin?.offset;
    const line=typeof offset==='number'?Buffer.from(source).subarray(0,offset).toString().split('\n').length:1;
    const value=v=>pointer(v)?`→ ${cells.get(v.base)?.name || '?'}[${v.index}]`:v;
    const listed=[...cells.entries()].slice(-24),ids=new Map(listed.map(([id],i)=>[id,'m'+i]));
    const memory=listed.map(([id,cell])=>{
      const address=pointer(cell.value)?cell.value:null,target=address?cells.get(address.base):null;
      const length=Array.isArray(target?.value)?target.value.length:1;
      return {id:ids.get(id),name:cell.name,type:type(cell.node),alive:cell.alive!==false,values:(Array.isArray(cell.value)?cell.value:[cell.value]).map(v=>value(v)??'未初始化'),
        ...(address?{pointer:{target:ids.get(address.base)||'',index:address.index,onePast:address.index===length,dangling:target?.alive===false}}:/\*\s*$/.test(type(cell.node))?{pointer:{target:'',null:cell.value===0,uninitialized:cell.value===undefined}}:{})};
    });
    frames.push({line,variables:listed.map(([,cell])=>({name:cell.name,type:type(cell.node),value:Array.isArray(cell.value)?cell.value.map(value):value(cell.value)??'未初始化'})),memory,stdout:output});
  };
  const stmt = n => {
    if(!n?.kind)return;
    if(--budget<0)stop('程序步骤过多');
    const children=n.inner||[];
    switch(n.kind) {
      case 'CompoundStmt': {
        const declared=[]; scopes.push(declared);
        try { for(const child of children){const result=stmt(child);if(result)return result;} }
        finally {
          scopes.pop();for(const id of declared)cells.get(id).alive=false;
          if(scopes.length&&declared.length)snapshot({...n,range:{begin:n.range?.end}});
        }
        return;
      }
      case 'DeclStmt':
        for(const decl of children){
          if(decl.kind!=='VarDecl')stop('此声明暂不支持');
          const array=/\[(\d+)\]$/.exec(type(decl));
          let value;
          if(array){const size=Number(array[1]);if(size>24)stop('数组超过24个元素');const init=decl.inner?.[0];if(init&&init.kind!=='InitListExpr')stop('此数组初始化暂不支持');value=init?(init.inner||[]).map(expr):Array(size).fill(undefined);while(value.length<size)value.push(0);}
          else value=decl.inner?.length?expr(decl.inner.at(-1)):undefined;
          cells.set(decl.id,{name:decl.name,node:decl,value,alive:true}); scopes.at(-1)?.push(decl.id);
        }snapshot(n);return;
      case 'IfStmt':{const result=expr(children[0]);snapshot(n);return stmt(result?children[1]:children[2]);}
      case 'ForStmt': {
        stmt(children[0]);let rounds=0;
        while(!children[2]?.kind||expr(children[2])){snapshot(n);const r=stmt(children[4]);if(r?.type==='return')return r;if(r?.type==='break')break;if(children[3]?.kind){expr(children[3]);snapshot(children[3]);}if(++rounds>100)stop('循环超过100次');}return;
      }
      case 'WhileStmt':case 'DoStmt': {
        const condition=n.kind==='WhileStmt'?children[0]:children[1],body=n.kind==='WhileStmt'?children[1]:children[0];let rounds=0;
        while(n.kind==='DoStmt'&&rounds===0||expr(condition)){snapshot(condition);const r=stmt(body);if(r?.type==='return')return r;if(r?.type==='break')break;if(++rounds>100)stop('循环超过100次');}return;
      }
      case 'ReturnStmt':{const value=children[0]?expr(children[0]):0;snapshot(n);return {type:'return',value};}
      case 'BreakStmt':return {type:'break'};case 'ContinueStmt':return {type:'continue'};case 'NullStmt':return;
      default:expr(n);snapshot(n);
    }
  };
  try {
    if(!ast||ast.kind!=='FunctionDecl'||ast.name!=='main')stop('当前代码未提供可用轨迹');
    stmt(ast.inner.find(n=>n.kind==='CompoundStmt'));
    if(output!==stdout)stop('逐步观察与真实输出不一致，仅展示真实运行结果');
    return {frames,verifiedOutput:true};
  } catch(error){return {frames:[],verifiedOutput:false,message:error.message,undefinedBehavior:/越界|越出|生命周期|尚未初始化|除数为零/.test(error.message)};}
}
