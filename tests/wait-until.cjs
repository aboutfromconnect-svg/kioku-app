// Await asynchronous browser predicates explicitly before deciding to stop polling.
module.exports=async function waitUntil(page,predicate,arg,timeout=45000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await page.evaluate(predicate,arg))return;await page.waitForTimeout(100);}
  throw new Error('Asynchronous browser condition timed out: '+predicate.toString());
};
