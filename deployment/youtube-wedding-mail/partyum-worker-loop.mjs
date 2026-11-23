// Local implementation only: off by default, no service or credentials constructed.
const waitMs=5000;
export async function startPartyumWorker({enabled,db,runDue,listen,onError=()=>{},signal}){
 if(enabled!==true||signal?.aborted)return ()=>{};
 if(typeof listen!=='function'||typeof db?.heartbeat!=='function'||typeof runDue!=='function')throw Error('Partyum worker is not configured');
 let stopped=false,running=false,pending=false,unsubscribe,timer;
 async function tick(){
  if(stopped)return;
  if(running){pending=true;return;}
  running=true;
  try {
   do{
    pending=false;
    await db.heartbeat();
    const outcomes=await runDue({limit:10});
    // If the work-conserving claim hits the batch size, continue immediately.
    if(Array.isArray(outcomes)&&outcomes.length===10)pending=true;
   }while(!stopped&&pending);
  }catch(e){try{await db.heartbeat({ready:false});}catch{}try{onError(e);}catch{}}
  finally{running=false;}
 }
 // listen must validate it subscribed to this exact server-only PostgreSQL channel;
 // interval fallback continuously checks due work even if a notification is lost.
 unsubscribe=await listen('sanji_partyum_due',()=>{void tick();});
 if(typeof unsubscribe!=='function')throw Error('Partyum notification subscription unavailable');
 function stop(){if(stopped)return;stopped=true;clearInterval(timer);unsubscribe();void db.heartbeat({ready:false}).catch(()=>{});signal?.removeEventListener('abort',stop);}
 if(signal?.aborted){stop();return ()=>{};}
 signal?.addEventListener('abort',stop,{once:true});
 timer=setInterval(()=>{void tick();},waitMs);
 void tick();
 return stop;
}
