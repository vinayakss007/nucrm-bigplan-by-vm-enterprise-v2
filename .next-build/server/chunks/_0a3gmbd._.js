module.exports=[384793,e=>e.a(async(t,a)=>{try{var n=e.i(373285),r=e.i(89171),o=e.i(468876),s=e.i(365865),i=e.i(70293);e.i(595907);var l=e.i(80821),c=e.i(930482),d=e.i(875225),u=e.i(349129),p=t([o,s]);async function m(e){try{let t=await (0,o.requireAuth)(e);if(t instanceof r.NextResponse)return t;if(!(0,o.can)(t,"contacts.edit"))return r.NextResponse.json({error:"Permission denied"},{status:403});if(!await s.db.query.tenantModules.findFirst({where:(0,d.and)((0,d.eq)(c.tenantModules.tenantId,t.tenantId),(0,d.eq)(c.tenantModules.moduleId,"ai-assistant"),(0,d.eq)(c.tenantModules.status,"active"))}))return r.NextResponse.json({error:"AI Assistant module not installed"},{status:403});let{contact_id:a,deal_id:n,purpose:u,tone:p="professional",length:m="medium",custom_instructions:h}=await e.json();if(!u)return r.NextResponse.json({error:"purpose is required"},{status:400});let f=null;a&&(f=(await s.db.select({id:l.contacts.id,firstName:l.contacts.firstName,lastName:l.contacts.lastName,email:l.contacts.email,companyName:l.companies.name}).from(l.contacts).leftJoin(l.companies,(0,d.eq)(l.companies.id,l.contacts.companyId)).where((0,d.and)((0,d.eq)(l.contacts.id,a),(0,d.eq)(l.contacts.tenantId,t.tenantId))))[0]);n&&(await s.db.select({id:l.deals.id,title:l.deals.title,firstName:l.contacts.firstName,lastName:l.contacts.lastName,companyName:l.companies.name}).from(l.deals).leftJoin(l.contacts,(0,d.eq)(l.contacts.id,l.deals.contactId)).leftJoin(l.companies,(0,d.eq)(l.companies.id,l.deals.companyId)).where((0,d.and)((0,d.eq)(l.deals.id,n),(0,d.eq)(l.deals.tenantId,t.tenantId))))[0];let y={follow_up:{subject:`Following up{{${f?.first_name?`, ${f.first_name}`:""}}}`,body:`Hi {{first_name}},

I hope this email finds you well. I wanted to follow up on our {{last_interaction}}.

{{custom_message}}

Would you be available for a quick call this week to discuss further?

Best regards,
{{sender_name}}`},introduction:{subject:"Introduction from {{sender_company}}",body:`Hi {{first_name}},

I came across {{company_name}} and was impressed by {{company_achievement}}.

I help companies like yours {{value_proposition}}. I'd love to explore if there's a fit.

Are you open to a brief conversation next week?

Best,
{{sender_name}}`},check_in:{subject:`Checking in{{${f?.first_name?`, ${f.first_name}`:""}}}`,body:`Hi {{first_name}},

It's been a while since we last connected. I wanted to check in and see how things are going at {{company_name}}.

{{custom_message}}

Let me know if there's anything I can help with!

Best,
{{sender_name}}`},proposal:{subject:"Proposal for {{company_name}}",body:`Hi {{first_name}},

Thank you for the opportunity to put together this proposal for {{company_name}}.

Based on our discussions, I believe we can help you {{value_proposition}}.

Key highlights:
- {{highlight_1}}
- {{highlight_2}}
- {{highlight_3}}

I've attached the detailed proposal. Let's schedule a time to review and answer any questions.

Looking forward to your feedback!

Best regards,
{{sender_name}}`},closing:{subject:"Next steps for {{deal_name}}",body:`Hi {{first_name}},

I'm excited about the opportunity to work together!

To move forward, here are the next steps:
1. {{step_1}}
2. {{step_2}}
3. {{step_3}}

Please let me know if you have any questions or concerns. I'm here to help make this process smooth.

Looking forward to partnering with you!

Best,
{{sender_name}}`}},w=y[u]||y.follow_up;if(!w)return r.NextResponse.json({error:"No email template found for this purpose"},{status:404});let g=w.subject,_=w.body;f&&(g=g.replace(/{{first_name}}/g,f.firstName||""),_=(_=_.replace(/{{first_name}}/g,f.firstName||"")).replace(/{{company_name}}/g,f.companyName||"your company")),_=h?_.replace(/{{custom_message}}/g,h):_.replace(/{{custom_message}}/,"");let R=(await s.db.insert(i.emailDrafts).values({tenantId:t.tenantId,contactId:a||null,dealId:n||null,purpose:u,subject:g,body:_,tone:p,length:m,createdBy:t.userId}).returning())[0];return r.NextResponse.json({ok:!0,draft:R,variables:{first_name:f?.firstName||"",company_name:f?.companyName||"",sender_name:"[Your Name]",sender_company:"[Your Company]"}})}catch(e){return console.error("[AI Email Draft] POST error:",e),(0,n.apiError)(e)}}async function h(e){try{let t=await (0,o.requireAuth)(e);if(t instanceof r.NextResponse)return t;let{searchParams:a}=new URL(e.url),n=a.get("contact_id"),c=a.get("deal_id"),p=parseInt(a.get("limit")||"20"),m=[(0,d.eq)(i.emailDrafts.tenantId,t.tenantId)];n&&m.push((0,d.eq)(i.emailDrafts.contactId,n)),c&&m.push((0,d.eq)(i.emailDrafts.dealId,c));let h=(await s.db.select({draft:i.emailDrafts,contact:{firstName:l.contacts.firstName,lastName:l.contacts.lastName,email:l.contacts.email}}).from(i.emailDrafts).leftJoin(l.contacts,(0,d.eq)(l.contacts.id,i.emailDrafts.contactId)).where((0,d.and)(...m)).orderBy((0,u.desc)(i.emailDrafts.createdAt)).limit(p)).map(e=>({...e.draft,first_name:e.contact?.firstName,last_name:e.contact?.lastName,email:e.contact?.email}));return r.NextResponse.json({data:h})}catch(e){return console.error("[AI Email Drafts] GET error:",e),(0,n.apiError)(e)}}[o,s]=p.then?(await p)():p,e.s(["GET",0,h,"POST",0,m]),a()}catch(e){a(e)}},!1),911257,e=>e.a(async(t,a)=>{try{var n=e.i(747909),r=e.i(174017),o=e.i(996250),s=e.i(759756),i=e.i(561916),l=e.i(174677),c=e.i(869741),d=e.i(316795),u=e.i(487718),p=e.i(995169),m=e.i(47587),h=e.i(666012),f=e.i(570101),y=e.i(626937),w=e.i(10372),g=e.i(193695);e.i(820232);var _=e.i(600220),R=e.i(384793),v=t([R]);[R]=v.then?(await v)():v;let I=new n.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/tenant/ai/email-draft/route",pathname:"/api/tenant/ai/email-draft",filename:"route",bundlePath:""},distDir:".next-build",relativeProjectDir:"",resolvedPagePath:"[project]/app/api/tenant/ai/email-draft/route.ts",nextConfigOutput:"",userland:R,...{}}),{workAsyncStorage:b,workUnitAsyncStorage:E,serverHooks:x}=I;async function N(e,t,a){a.requestMeta&&(0,s.setRequestMeta)(e,a.requestMeta),I.isDev&&(0,s.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let n="/api/tenant/ai/email-draft/route";n=n.replace(/\/index$/,"")||"/";let o=await I.prepare(e,t,{srcPage:n,multiZoneDraftMode:!1});if(!o)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:R,deploymentId:v,params:N,nextConfig:b,parsedUrl:E,isDraftMode:x,prerenderManifest:q,routerServerContext:A,isOnDemandRevalidate:C,revalidateOnlyGenerated:T,resolvedPathname:k,clientReferenceManifest:P,serverActionsManifest:S}=o,D=(0,c.normalizeAppPath)(n),O=!!(q.dynamicRoutes[D]||q.routes[k]),H=async()=>((null==A?void 0:A.render404)?await A.render404(e,t,E,!1):t.end("This page could not be found"),null);if(O&&!x){let e=!!q.routes[k],t=q.dynamicRoutes[D];if(t&&!1===t.fallback&&!e){if(b.adapterPath)return await H();throw new g.NoFallbackError}}let j=null;!O||I.isDev||x||(j=k,j="/index"===j?"/":j);let M=!0===I.isDev||!O,U=O&&!M;S&&P&&(0,l.setManifestsSingleton)({page:n,clientReferenceManifest:P,serverActionsManifest:S});let B=e.method||"GET",$=(0,i.getTracer)(),F=$.getActiveScopeSpan(),L=!!(null==A?void 0:A.isWrappedByNextServer),K=!!(0,s.getRequestMeta)(e,"minimalMode"),G=(0,s.getRequestMeta)(e,"incrementalCache")||await I.getIncrementalCache(e,b,q,K);null==G||G.resetRequestCache(),globalThis.__incrementalCache=G;let J={params:N,previewProps:q.preview,renderOpts:{experimental:{authInterrupts:!!b.experimental.authInterrupts},cacheComponents:!!b.cacheComponents,supportsDynamicResponse:M,incrementalCache:G,cacheLifeProfiles:b.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,a,n,r)=>I.onRequestError(e,t,n,r,A)},sharedContext:{buildId:R,deploymentId:v}},W=new d.NodeNextRequest(e),V=new d.NodeNextResponse(t),X=u.NextRequestAdapter.fromNodeNextRequest(W,(0,u.signalFromNodeResponse)(t));try{let o,s=async e=>I.handle(X,J).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let a=$.getRootSpanAttributes();if(!a)return;if(a.get("next.span_type")!==p.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${a.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let r=a.get("next.route");if(r){let t=`${B} ${r}`;e.setAttributes({"next.route":r,"http.route":r,"next.span_name":t}),e.updateName(t),o&&o!==e&&(o.setAttribute("http.route",r),o.updateName(t))}else e.updateName(`${B} ${n}`)}),l=async o=>{var i,l;let c=async({previousCacheEntry:r})=>{try{if(!K&&C&&T&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let n=await s(o);e.fetchMetrics=J.renderOpts.fetchMetrics;let i=J.renderOpts.pendingWaitUntil;i&&a.waitUntil&&(a.waitUntil(i),i=void 0);let l=J.renderOpts.collectedTags;if(!O)return await (0,h.sendResponse)(W,V,n,J.renderOpts.pendingWaitUntil),null;{let e=await n.blob(),t=(0,f.toNodeOutgoingHttpHeaders)(n.headers);l&&(t[w.NEXT_CACHE_TAGS_HEADER]=l),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let a=void 0!==J.renderOpts.collectedRevalidate&&!(J.renderOpts.collectedRevalidate>=w.INFINITE_CACHE)&&J.renderOpts.collectedRevalidate,r=void 0===J.renderOpts.collectedExpire||J.renderOpts.collectedExpire>=w.INFINITE_CACHE?void 0:J.renderOpts.collectedExpire;return{value:{kind:_.CachedRouteKind.APP_ROUTE,status:n.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:a,expire:r}}}}catch(t){throw(null==r?void 0:r.isStale)&&await I.onRequestError(e,t,{routerKind:"App Router",routePath:n,routeType:"route",revalidateReason:(0,m.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:C})},!1,A),t}},d=await I.handleResponse({req:e,nextConfig:b,cacheKey:j,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:q,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:T,responseGenerator:c,waitUntil:a.waitUntil,isMinimalMode:K});if(!O)return null;if((null==d||null==(i=d.value)?void 0:i.kind)!==_.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(l=d.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});K||t.setHeader("x-nextjs-cache",C?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),x&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let u=(0,f.fromNodeOutgoingHttpHeaders)(d.value.headers);return K&&O||u.delete(w.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||u.get("Cache-Control")||u.set("Cache-Control",(0,y.getCacheControlHeader)(d.cacheControl)),await (0,h.sendResponse)(W,V,new Response(d.value.body,{headers:u,status:d.value.status||200})),null};L&&F?await l(F):(o=$.getActiveScopeSpan(),await $.withPropagatedContext(e.headers,()=>$.trace(p.BaseServerSpan.handleRequest,{spanName:`${B} ${n}`,kind:i.SpanKind.SERVER,attributes:{"http.method":B,"http.target":e.url}},l),void 0,!L))}catch(t){if(t instanceof g.NoFallbackError||await I.onRequestError(e,t,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,m.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:C})},!1,A),O)throw t;return await (0,h.sendResponse)(W,V,new Response(null,{status:500})),null}}e.s(["handler",0,N,"patchFetch",0,function(){return(0,o.patchFetch)({workAsyncStorage:b,workUnitAsyncStorage:E})},"routeModule",0,I,"serverHooks",0,x,"workAsyncStorage",0,b,"workUnitAsyncStorage",0,E]),a()}catch(e){a(e)}},!1)];

//# sourceMappingURL=_0a3gmbd._.js.map