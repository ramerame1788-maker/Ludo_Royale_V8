const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT)||3000;
const HOST=process.env.HOST||'0.0.0.0';
const ROOT=path.join(__dirname,'public');
const DB_FILE=path.join(__dirname,'data.json');
const colors=['red','green','yellow','blue'],starts={red:0,green:13,yellow:26,blue:39};
const safe=new Set([0,8,13,21,26,34,39,47]);
const rewards={start:100,daily:50,roll6:5,capture:25,win:250};
const rooms=new Map();
function loadDB(){try{return JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}catch{return {users:{}}}}
const db=loadDB();
function saveDB(){fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))}
function hash(p,s=crypto.randomBytes(16).toString('hex')){return {salt:s,hash:crypto.scryptSync(p,s,64).toString('hex')}}
function verify(p,u){try{return crypto.timingSafeEqual(Buffer.from(hash(p,u.salt).hash,'hex'),Buffer.from(u.hash,'hex'))}catch{return false}}
function id(){return crypto.randomBytes(4).toString('hex').toUpperCase()}
function send(ws,msg){if(ws.readyState===1)ws.send(JSON.stringify(msg))}
function broadcast(room,msg){room.players.forEach(p=>send(p.ws,msg))}
function publicState(room){return {type:'state',room:room.code,players:room.players.map(p=>({name:p.name,username:p.username,color:p.color,ready:p.ready,coins:p.coins})),host:room.players[0]?.name||null,game:room.game?{started:room.game.started,turn:room.game.turn,color:room.players[room.game.turn]?.color||null,dice:room.game.dice,winner:room.game.winner,pieces:Object.fromEntries(room.players.map(p=>[p.color,p.pieces]))}:null}}
function globalPos(c,pos){if(pos<0||pos>51)return null;return(starts[c]+pos)%52}
function canMove(p,i,d){const x=p.pieces[i];if(x===57)return false;if(x===-1)return d===6;return x+d<=57}
function hasMove(p,d){return p.pieces.some((_,i)=>canMove(p,i,d))}
function startGame(r){r.game={started:true,turn:0,dice:null,winner:null};r.players.forEach(p=>p.pieces=[-1,-1,-1,-1])}
function next(r,extra){r.game.dice=null;if(!extra)r.game.turn=(r.game.turn+1)%r.players.length}
function userFor(ws){return ws.user&&db.users[ws.user]}
function updateWallet(p,delta){p.coins+=delta;const u=db.users[p.username];u.coins=p.coins;u.stats=u.stats||{games:0,wins:0,captures:0};saveDB()}
const server=http.createServer((req,res)=>{
  let urlPath=(req.url||'/').split('?')[0]; let f=urlPath==='/'?'/index.html':urlPath;
  const full=path.normalize(path.join(ROOT,f));
  if(urlPath==='/health'){
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    return res.end(JSON.stringify({ok:true,service:'ludo-royale-v8'}));
  }
  if(!full.startsWith(ROOT))return res.writeHead(403).end();
  fs.readFile(full,(e,d)=>{if(e)return res.writeHead(404).end('Not found');
    const ext=path.extname(full);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});res.end(d)
  })
});
const wss=new WebSocket.Server({server});
const heartbeat=setInterval(()=>{
  wss.clients.forEach(ws=>{
    if(ws.isAlive===false)return ws.terminate();
    ws.isAlive=true;
    ws.ping();
  });
},30000);
wss.on('connection',ws=>{
  ws.isAlive=true;
  ws.on('pong',()=>{ws.isAlive=true});

 ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==='register'||m.type==='login'){
    const username=String(m.username||'').trim().toLowerCase(),password=String(m.password||'');
    if(!/^[a-z0-9_]{3,18}$/.test(username)||password.length<6)return send(ws,{type:'error',scope:'auth',message:'اسم المستخدم 3-18 حرفاً إنجليزياً/رقماً، وكلمة المرور 6 أحرف على الأقل'});
    if(m.type==='register'){
      if(db.users[username])return send(ws,{type:'error',scope:'auth',message:'اسم المستخدم مستخدم مسبقاً'});
      const h=hash(password);db.users[username]={username,...h,coins:rewards.start,lastDaily:null,inventory:[],stats:{games:0,wins:0,captures:0}};saveDB()
    }else if(!db.users[username]||!verify(password,db.users[username]))return send(ws,{type:'error',scope:'auth',message:'بيانات الدخول غير صحيحة'});
    ws.user=username;send(ws,{type:'auth',username,coins:db.users[username].coins,stats:db.users[username].stats||{games:0,wins:0,captures:0}});return
  }
  if(m.type==='leaderboard'){
    const list=Object.values(db.users).sort((a,b)=>(b.stats?.wins||0)-(a.stats?.wins||0)||b.coins-a.coins).slice(0,20).map(u=>({username:u.username,coins:u.coins,wins:u.stats?.wins||0,games:u.stats?.games||0}));
    return send(ws,{type:'leaderboard',list})
  }
  if(m.type==='daily'&&ws.user){const u=userFor(ws),today=new Date().toISOString().slice(0,10);if(u.lastDaily===today)return send(ws,{type:'error',scope:'daily',message:'استلمت المكافأة اليومية اليوم'});u.lastDaily=today;u.coins+=rewards.daily;saveDB();send(ws,{type:'reward',coins:rewards.daily,reason:'🎁 المكافأة اليومية'});send(ws,{type:'auth',username:u.username,coins:u.coins,stats:u.stats});return}
  if(m.type==='shop'&&ws.user){const u=userFor(ws),cost=Number(m.cost),item=String(m.item||'').slice(0,30);if(!Number.isFinite(cost)||cost<1||cost>u.coins)return send(ws,{type:'error',scope:'shop',message:'رصيد العملات غير كافٍ'});u.coins-=cost;u.inventory=u.inventory||[];u.inventory.push(item);saveDB();send(ws,{type:'purchase',item,coins:u.coins});return}
  if(m.type==='create'&&ws.user){if(ws.room)return send(ws,{type:'error',message:'أنت داخل غرفة بالفعل'});let code=id();while(rooms.has(code))code=id();let r={code,players:[],game:null};rooms.set(code,r);let u=userFor(ws);let p={ws,username:u.username,name:String(m.name||u.username).trim().slice(0,18)||u.username,color:'red',ready:false,pieces:[-1,-1,-1,-1],coins:u.coins};r.players.push(p);ws.room=r;ws.player=p;send(ws,{type:'joined',code,color:p.color});broadcast(r,publicState(r));return}
  if(m.type==='join'&&ws.user){if(ws.room)return send(ws,{type:'error',message:'أنت داخل غرفة بالفعل'});let r=rooms.get(String(m.code||'').trim().toUpperCase());if(!r||r.players.length>=4)return send(ws,{type:'error',message:'الغرفة غير موجودة أو ممتلئة'});if(r.game?.started)return send(ws,{type:'error',message:'اللعبة بدأت بالفعل'});let u=userFor(ws),color=colors[r.players.length],p={ws,username:u.username,name:String(m.name||u.username).trim().slice(0,18)||u.username,color,ready:false,pieces:[-1,-1,-1,-1],coins:u.coins};r.players.push(p);ws.room=r;ws.player=p;send(ws,{type:'joined',code:r.code,color});broadcast(r,publicState(r));return}
  if(m.type==='leave'&&ws.player){const r=ws.room;r.players=r.players.filter(p=>p.ws!==ws);if(!r.players.length)rooms.delete(r.code);else{r.game=null;r.players.forEach((p,i)=>{p.color=colors[i];p.ready=false;p.pieces=[-1,-1,-1,-1]});broadcast(r,{type:'message',text:'🚪 غادر لاعب الغرفة'});broadcast(r,publicState(r))}ws.room=null;ws.player=null;return send(ws,{type:'left'})}
  if(m.type==='ready'&&ws.player){ws.player.ready=!!m.value;broadcast(ws.room,publicState(ws.room));return}
  if(m.type==='start'&&ws.player){let r=ws.room;if(r.players.length>=2&&r.players.every(p=>p.ready)){startGame(r);r.players.forEach(p=>{db.users[p.username].stats.games=(db.users[p.username].stats.games||0)+1});saveDB();broadcast(r,{type:'message',text:'🚀 بدأت المباراة! دور '+r.players[0].name});broadcast(r,publicState(r))}else send(ws,{type:'error',message:'يجب أن يكون هناك لاعبان على الأقل والجميع جاهز'});return}
  if(m.type==='roll'&&ws.player){let r=ws.room,g=r.game;if(!g?.started||g.winner||r.players[g.turn]!==ws.player||g.dice!==null)return;const d=Math.floor(Math.random()*6)+1;g.dice=d;if(d===6){updateWallet(ws.player,rewards.roll6);send(ws,{type:'reward',coins:rewards.roll6,reason:'🎲 رمية 6'})}if(!hasMove(ws.player,d)){const extra=d===6;setTimeout(()=>{if(r.game===g&&!g.winner){next(r,extra);broadcast(r,publicState(r))}},700)}broadcast(r,publicState(r));return}
  if(m.type==='move'&&ws.player){let r=ws.room,g=r.game,p=ws.player;if(!g?.started||g.winner||r.players[g.turn]!==p||g.dice===null)return;const i=Number(m.index);if(!Number.isInteger(i)||i<0||i>3||!canMove(p,i,g.dice))return;const d=g.dice;p.pieces[i]=p.pieces[i]===-1?0:p.pieces[i]+d;const gp=globalPos(p.color,p.pieces[i]);if(gp!==null&&!safe.has(gp)){r.players.forEach(q=>{if(q===p)return;let hit=false;q.pieces=q.pieces.map(v=>{if(globalPos(q.color,v)===gp){hit=true;return -1}return v});if(hit){updateWallet(p,rewards.capture);db.users[p.username].stats.captures=(db.users[p.username].stats.captures||0)+1;saveDB();send(p.ws,{type:'reward',coins:rewards.capture,reason:'💥 أكل قطعة'})}})}if(p.pieces.every(v=>v===57)){g.winner=p.color;g.dice=null;updateWallet(p,rewards.win);db.users[p.username].stats.wins=(db.users[p.username].stats.wins||0)+1;saveDB();send(p.ws,{type:'reward',coins:rewards.win,reason:'🏆 مكافأة الفوز'});broadcast(r,{type:'message',text:`🏆 ${p.name} فاز! +${rewards.win} عملة`})}else next(r,d===6);broadcast(r,publicState(r));return}
  if(m.type==='chat'&&ws.room)return broadcast(ws.room,{type:'chat',name:ws.player.name,text:String(m.text||'').slice(0,160)});
 });
 ws.on('close',()=>{const r=ws.room;if(!r)return;r.players=r.players.filter(p=>p.ws!==ws);if(!r.players.length)rooms.delete(r.code);else{r.game=null;r.players.forEach((p,i)=>{p.color=colors[i];p.ready=false;p.pieces=[-1,-1,-1,-1]});broadcast(r,{type:'message',text:'🚪 انقطع لاعب، أُعيدت الغرفة إلى الانتظار'});broadcast(r,publicState(r))}})
});
process.on('SIGTERM',()=>{clearInterval(heartbeat);wss.close();server.close(()=>process.exit(0))});
process.on('SIGINT',()=>{clearInterval(heartbeat);wss.close();server.close(()=>process.exit(0))});
server.listen(PORT,HOST,()=>console.log(`Ludo Royale V8 running on ${HOST}:${PORT}`));
