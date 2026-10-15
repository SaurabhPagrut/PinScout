// Run: node tests/scanner.test.js
const S=require('../extension/lib/scanner.js'); const assert=require('assert');
const T=(pins)=>[{id:"home",label:"h",pins:pins.map(p=>({p}))}];
const base={sleep:async()=>{},shouldStop:()=>false,onEvent:()=>{},retryDelay:0,delay:()=>0};
(async()=>{
 // 1. hung check times out, scan continues
 let r=await S.runScan({...base,checkTimeout:50,tiers:T(["1","2"]),check:p=>p==="1"?new Promise(()=>{}):{status:"available"}});
 assert.equal(r.outcome,"found"); assert.equal(r.errors,1); console.log("timeout ok");
 // 2. Stop during hung check returns promptly
 let stop=false; setTimeout(()=>stop=true,100); const t0=Date.now();
 r=await S.runScan({...base,shouldStop:()=>stop,checkTimeout:60000,tiers:T(["1"]),check:()=>new Promise(()=>{})});
 assert.equal(r.outcome,"stopped"); assert(Date.now()-t0<1000); console.log("stop-during-hang ok", Date.now()-t0,"ms");
 // 3. retry once rescues a blip
 let n=0; r=await S.runScan({...base,tiers:T(["1"]),check:()=>++n===1?{status:"error",message:"500"}:{status:"available"}});
 assert.equal(r.outcome,"found"); assert.equal(n,2); assert.equal(r.errors,0); console.log("retry ok");
 // 4. errors counted separately
 r=await S.runScan({...base,tiers:T(["1","2"]),check:p=>p==="1"?{status:"error",message:"x"}:{status:"unavailable"}});
 assert.equal(r.outcome,"none"); assert.equal(r.checked,2); assert.equal(r.errors,1); console.log("error count ok");
 // 5. fatal not retried
 n=0; r=await S.runScan({...base,tiers:T(["1","2"]),check:()=>{n++;return{status:"error",fatal:true,message:"429"}}});
 assert.equal(r.outcome,"aborted"); assert.equal(n,1); console.log("fatal ok");
 // 6. sold out everywhere stops early
 n=0; r=await S.runScan({...base,tiers:T(["1","2","3"]),check:()=>{n++;return{status:"unavailable",soldOutEverywhere:true}}});
 assert.equal(r.outcome,"soldout"); assert.equal(n,1); console.log("soldout ok");
 // 7. backoff doubles after errors, no trailing sleep
 const sleeps=[]; r=await S.runScan({...base,retryDelay:4000,sleep:async ms=>sleeps.push(ms),delay:()=>1000,tiers:T(["1","2","3"]),
   check:p=>p==="3"?{status:"unavailable"}:{status:"error",message:"x"}});
 console.log("sleeps",sleeps.join(",")); assert.deepEqual(sleeps,[4000,2000,4000,4000]);
 // 8. 3 in a row aborts
 r=await S.runScan({...base,tiers:T(["1","2","3","4"]),check:()=>({status:"error",message:"x"})});
 assert.equal(r.outcome,"aborted"); assert.equal(r.checked,3);
 // 9. keepGoing: found kept on stop
 let k=0; r=await S.runScan({...base,keepGoing:true,shouldStop:()=>k>=1,tiers:T(["1","2"]),check:()=>{k++;return{status:"available"}}});
 assert.equal(r.outcome,"stopped"); assert.equal(r.found.length,1);
 // 10. thrown check becomes error
 r=await S.runScan({...base,tiers:T(["1"]),check:()=>{throw new Error("boom")}}); assert.equal(r.errors,1);
 // 11. default pacing uses minDelay
 const sl=[]; await S.runScan({...base,delay:undefined,minDelay:2000,sleep:async ms=>sl.push(ms),tiers:T(["1","2"]),check:()=>({status:"unavailable"})});
 assert(sl[0]>=2000&&sl[0]<=3700); console.log("SCAN OK");
})().catch(e=>{console.error(e);process.exit(1)});
