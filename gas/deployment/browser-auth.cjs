"use strict";
// Fetch one hop at a time. route.continue headers otherwise survive redirects.
async function installOriginAuthorization(context,origin,token){
  if(new URL(origin).origin!==origin)throw new Error('Exact authorization origin required');
  let failed=false;
  await context.route(url=>url.origin===origin,async route=>{
    try{
      const headers=Object.fromEntries(Object.entries(route.request().headers()).filter(([key])=>key.toLowerCase()!=='authorization'));
      const response=await route.fetch({headers:{...headers,Authorization:'Bearer '+token},maxRedirects:0});
      await route.fulfill({response});
    }catch{
      // Playwright fetch errors can include headers. Never propagate that error.
      failed=true;await route.abort('failed').catch(()=>{});
    }
  });
  return {get failed(){return failed;}};
}
module.exports={installOriginAuthorization};
