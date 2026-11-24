const {spawn}=require('node:child_process'),readline=require('node:readline'),os=require('node:os');
exports.createPrintResourceMonitor=async(browser,probeDll)=>{
 const child=spawn('dotnet',[probeDll,'--print-resource-monitor'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const lines=readline.createInterface({input:child.stdout}),queue=[];let ready;
 const started=new Promise((resolve,reject)=>{ready=resolve;child.once('error',reject);});
 lines.on('line',line=>{if(line==='ready')return ready();try{queue.shift()?.resolve(JSON.parse(line));}catch(e){queue.shift()?.reject(e);}});
 child.on('exit',()=>{for(const p of queue.splice(0))p.reject(Error('Resource monitor exited'));});
 child.stderr.on('data',x=>process.stderr.write(x));await started;
 const cdp=await browser.newBrowserCDPSession();let snapshot,busy=false,active=false,stats,last;
 async function sample(){
  if(busy)return;busy=true;
  try{
   const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');
   snapshot=await new Promise((resolve,reject)=>{queue.push({resolve,reject});child.stdin.write(JSON.stringify({ids:processInfo.map(p=>p.id)})+'\n');});
   const now=performance.now(),workingSetBytes=snapshot.processes.reduce((s,p)=>s+p.workingSetBytes,0),privateBytes=snapshot.processes.reduce((s,p)=>s+p.privateBytes,0);
   const cpus=new Map(snapshot.processes.map(p=>[p.id,p.cpuSeconds]));
   if(active){
    const elapsed=(now-last.time)/1000;
    const cpuSeconds=snapshot.processes.reduce((s,p)=>s+Math.max(0,p.cpuSeconds-(last.cpus.get(p.id)||0)),0);
    stats.cpuSeconds+=cpuSeconds;stats.durationSeconds+=elapsed;
    stats.peakCpuPercent=Math.max(stats.peakCpuPercent,cpuSeconds/elapsed/os.cpus().length*100);
    stats.peakWorkingSetBytes=Math.max(stats.peakWorkingSetBytes,workingSetBytes);
    stats.peakPrivateBytes=Math.max(stats.peakPrivateBytes,privateBytes);
    stats.minimumAvailablePhysicalBytes=Math.min(stats.minimumAvailablePhysicalBytes,snapshot.memory.availablePhysicalBytes);
    stats.samples.push({ms:Math.round(now-stats.started),workingSetBytes,privateBytes,cpuPercent:cpuSeconds/elapsed/os.cpus().length*100});
   }
   last={time:now,cpus,workingSetBytes,privateBytes};
  }finally{busy=false;}
 }
 await sample();const timer=setInterval(()=>sample().catch(e=>console.error('Resource sample:',e)),250);
 return {get memory(){return snapshot?.memory;},async begin(){while(busy)await new Promise(r=>setTimeout(r,10));await sample();stats={started:performance.now(),baselineWorkingSetBytes:last.workingSetBytes,baselinePrivateBytes:last.privateBytes,peakWorkingSetBytes:last.workingSetBytes,peakPrivateBytes:last.privateBytes,peakCpuPercent:0,cpuSeconds:0,durationSeconds:0,minimumAvailablePhysicalBytes:Infinity,samples:[]};active=true;},
 async end(){while(busy)await new Promise(r=>setTimeout(r,10));await sample();active=false;stats.averageCpuPercent=stats.cpuSeconds/stats.durationSeconds/os.cpus().length*100;return stats;},
 async close(){clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,10));child.stdin.end();await cdp.detach();}};
};
