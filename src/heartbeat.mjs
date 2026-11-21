/** Independent missing-run monitor. Endpoint is a secret; never print it. */
export function requiresFreshnessSignal(mode,event){
 return mode==='production'&&event==='schedule';
}

export async function signalMonitor(endpoint,event,fetchImpl=fetch){
 let url;
 try{url=new URL(endpoint);}catch{throw new Error('Backup monitor endpoint invalid');}
 if(url.protocol!=='https:'||url.hostname!=='hc-ping.com'||!/^\/[a-f0-9-]{36}$/i.test(url.pathname)||url.search||url.hash||url.username||url.password)throw new Error('Backup monitor endpoint invalid');
 if(event==='start')url.pathname+='/start';
 else if(event==='fail')url.pathname+='/fail';
 else if(event!=='success')throw new Error('Unknown backup monitor event');
 const response=await fetchImpl(url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10_000)});
 // The ping API also uses HTTP 200 for unknown checks and rate-limited pings.
 if(response.status!==200||(await response.text()).trim()!=='OK')throw new Error('Backup monitor signal was not accepted');
}
