module.exports=[217080,e=>e.a(async(t,a)=>{try{var n=e.i(365865),s=e.i(80821),r=e.i(875225),l=e.i(518899),i=e.i(501812),o=t([n,i]);async function c(e,t,a){let n=`You are a sentiment analysis AI. Analyze the text and return ONLY valid JSON:
{
  "score": <0-100>,
  "label": "positive" | "neutral" | "negative",
  "confidence": <0-100>,
  "summary": "<one-line explanation>"
}

Rules:
- score 0 = extremely negative, 50 = neutral, 100 = extremely positive
- Use the full 0-100 range, not just coarse buckets
- confidence reflects how certain you are about this classification`;try{let s=await (0,i.chat)({tenantId:t,userId:a??null,action:"sentiment_analysis",system:n,messages:[{role:"user",content:e.slice(0,2e3)}],max_tokens:256,temperature:.1,entityType:"sentiment_analysis"});return function(e){let t=e.trim();t.startsWith("```")&&(t=t.replace(/^```(?:json)?\n?/,"").replace(/\n?```$/,""));try{var a;let e=JSON.parse(t);return{score:f(e.score??50,0,100),label:(a=e.label,"positive"===a||"neutral"===a||"negative"===a?a:"neutral"),confidence:f(e.confidence??50,0,100),summary:String(e.summary??"").slice(0,300)}}catch(t){return console.error("[sentiment] Failed to parse AI response",t),d(e)}}(s.text)}catch(t){return console.error("[sentiment] AI analysis failed:",t.message),d(e)}}function d(e){let t=e.toLowerCase(),a=50;for(let e of["thank","great","happy","interested","good","love","excellent","perfect","yes"])t.includes(e)&&(a+=8);for(let e of["bad","terrible","angry","frustrated","hate","worst","poor","horrible","no","not"])t.includes(e)&&(a-=8);return{score:a=f(a,0,100),label:a>60?"positive":a<40?"negative":"neutral",confidence:40,summary:"Rule-based fallback sentiment analysis"}}async function u(e,t,a){await n.db.update(s.deals).set({metadata:l.sql`jsonb_set(
        COALESCE(${s.deals.metadata}, '{}'::jsonb),
        '{ai_sentiment}',
        ${JSON.stringify({score:a.score,label:a.label,confidence:a.confidence,summary:a.summary,analyzedAt:new Date().toISOString()})}::jsonb
      )`,updatedAt:new Date}).where((0,r.and)((0,r.eq)(s.deals.id,e),(0,r.eq)(s.deals.tenantId,t),(0,r.isNull)(s.deals.deletedAt)))}async function m(e,t,a){let i=await n.db.select({id:s.deals.id}).from(s.deals).where((0,r.and)((0,r.eq)(s.deals.contactId,e),(0,r.eq)(s.deals.tenantId,t),(0,r.isNull)(s.deals.deletedAt),l.sql`COALESCE(${s.deals.metadata}->>'outcome', '') NOT IN ('won', 'lost')`));for(let e of i)await u(e.id,t,a);return i.length}async function y(e,t,a,n){try{let s=await c(a,t,n),r=await m(e,t,s);return{sentiment:s,dealsUpdated:r}}catch(e){return console.error("[sentiment] analyzeSentimentForContact failed:",e),null}}function f(e,t,a){return Math.max(t,Math.min(a,Number(e)||0))}[n,i]=o.then?(await o)():o,e.s(["analyzeSentiment",0,c,"analyzeSentimentForContact",0,y,"updateContactDealsSentiment",0,m,"updateDealSentiment",0,u]),a()}catch(e){a(e)}},!1)];

//# sourceMappingURL=lib_ai_sentiment_ts_0y1r9y2._.js.map