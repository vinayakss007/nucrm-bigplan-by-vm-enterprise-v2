module.exports=[111103,e=>e.a(async(t,a)=>{try{var n=e.i(373285),s=e.i(89171),r=e.i(469719),o=e.i(998701),l=e.i(468876),i=e.i(365865),d=e.i(518899),u=t([l,i]);async function c(e){let t=await (0,l.requireAuth)(e);if(!t||t instanceof s.NextResponse)return t instanceof s.NextResponse?t:s.NextResponse.json({error:"Unauthorized"},{status:401});if(!t.isSuperAdmin)return s.NextResponse.json({error:"Super admin access required"},{status:403});let{searchParams:a}=new URL(e.url),n=a.get("action");return"summary"===n?E(a):"schema"===n?p():R(a)}async function E(e){try{let t=e.get("tenantId");if(t){let e=await i.db.execute(d.sql`
        SELECT t.id, t.name, t.subdomain, t.slug, t.status, p.name as plan,
               t.created_at, t.trial_ends_at,
               u.email as owner_email, u.full_name as owner_name,
               (SELECT count(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL) as contact_count,
               (SELECT count(*) FROM leads WHERE tenant_id = t.id AND deleted_at IS NULL) as lead_count,
               (SELECT count(*) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL) as deal_count,
               (SELECT count(*) FROM companies WHERE tenant_id = t.id AND deleted_at IS NULL) as company_count,
               (SELECT count(*) FROM tasks WHERE tenant_id = t.id AND deleted_at IS NULL) as task_count,
               (SELECT count(*) FROM tenant_members WHERE tenant_id = t.id) as member_count,
               (SELECT count(*) FROM activities WHERE tenant_id = t.id) as activity_count,
               (SELECT count(*) FROM workflows WHERE tenant_id = t.id) as workflow_count,
               (SELECT COALESCE(SUM(amount), 0) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL) as total_pipeline_value
        FROM tenants t
        LEFT JOIN public.plans p ON p.id = t.plan_id
        LEFT JOIN users u ON t.owner_id = u.id
        WHERE t.id = ${t}
      `);if(0===e.rows.length)return s.NextResponse.json({error:"Tenant not found"},{status:404});return s.NextResponse.json({tenant:e.rows[0]})}let a=await i.db.execute(d.sql`
      SELECT
        (SELECT count(*) FROM tenants) as total_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'active') as active_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'trialing') as trialing_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'suspended') as suspended_tenants,
        (SELECT count(*) FROM users) as total_users,
        (SELECT count(*) FROM contacts WHERE deleted_at IS NULL) as total_contacts,
        (SELECT count(*) FROM leads WHERE deleted_at IS NULL) as total_leads,
        (SELECT count(*) FROM deals WHERE deleted_at IS NULL) as total_deals,
        (SELECT count(*) FROM companies WHERE deleted_at IS NULL) as total_companies,
        (SELECT count(*) FROM tasks WHERE deleted_at IS NULL) as total_tasks,
        (SELECT COALESCE(SUM(d.amount), 0) FROM deals d WHERE d.deleted_at IS NULL) as total_pipeline_value,
        (SELECT count(*) FROM tenants WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week,
        (SELECT count(*) FROM tenants WHERE created_at > NOW() - INTERVAL '30 days') as new_this_month
    `);return s.NextResponse.json({summary:a.rows[0]})}catch(e){return(0,n.apiError)(e)}}async function p(){try{let e=(await i.db.execute(d.sql`
      SELECT 
        t.table_name,
        (SELECT count(*) FROM information_schema.columns c 
         WHERE c.table_name = t.table_name AND c.table_schema = 'public') as column_count,
        (SELECT EXISTS(
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = t.table_name AND column_name = 'tenant_id'
        )) as has_tenant_id,
        (SELECT EXISTS(
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = t.table_name AND column_name = 'deleted_at'
        )) as has_soft_delete
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `)).rows.filter(e=>e.has_tenant_id),t=[];for(let a of e.slice(0,20))try{let e=await i.db.execute(d.sql`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = ${a.table_name} AND table_schema = 'public'
          ORDER BY ordinal_position
        `),n=await i.db.execute(d.sql`SELECT count(*) FROM "${d.sql.raw(a.table_name)}"`);t.push({table:a.table_name,columns:e.rows,totalRows:parseInt(n.rows[0]?.count||"0",10)})}catch{}return s.NextResponse.json({tables:t})}catch(e){return(0,n.apiError)(e)}}async function R(e){try{let t=e.get("q")?.trim()||"",a=e.get("type")||"all",n=e.get("tenantId"),r=Math.max(1,parseInt(e.get("page")||"1")),o=Math.min(200,Math.max(1,parseInt(e.get("limit")||"50"))),l=(r-1)*o,u=e.get("sort")||"created_at",c=(e.get("order")||"desc").toUpperCase(),E=e.get("field"),p=e.get("value"),R=["id","name","email","title","created_at","updated_at","amount","lead_status","lead_source","first_name","last_name","phone","company_name"].includes(u)?u:"created_at",_="ASC"===c?"ASC":"DESC",m={},w=0,N=(e,a)=>{let s=[];if(t){let n=`%${t}%`,r=a.map(t=>d.sql`${d.sql.raw(`${e}.${t}`)} ILIKE ${n}`);s.push(d.sql`(${d.sql.join(r,d.sql` OR `)})`)}return n&&s.push(d.sql`${d.sql.raw(`${e}.tenant_id`)} = ${n}`),s};if("all"===a||"tenants"===a){let e=N("t",["name","slug","billing_email"]),t=e.length?d.sql`WHERE ${d.sql.join(e,d.sql` AND `)}`:d.sql``,a=await i.db.execute(d.sql`SELECT count(*) FROM tenants t ${t}`),n=parseInt(a.rows[0]?.count||"0",10);m.tenants={data:(await i.db.execute(d.sql`
        SELECT t.id, t.name, t.slug, t.status, p.name as plan,
               t.created_at, t.updated_at,
               u.email as owner_email,
               (SELECT count(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL) as contact_count
        FROM tenants t
        LEFT JOIN public.plans p ON p.id = t.plan_id
        LEFT JOIN users u ON t.owner_id = u.id
        ${t}
        ORDER BY t.${d.sql.raw(R)} ${d.sql.raw(_)}
        LIMIT ${o} OFFSET ${l}
      `)).rows,total:n,page:r,limit:o},w+=n}if("all"===a||"contacts"===a){let e=["first_name","last_name","email","phone","lead_status","lead_source"],t=N("c",e);t.push(d.sql`c.deleted_at IS NULL`),E&&p&&e.includes(E)&&t.push(d.sql`${d.sql.raw(`c.${E}`)} = ${p}`);let n=d.sql`WHERE ${d.sql.join(t,d.sql` AND `)}`,s=await i.db.execute(d.sql`SELECT count(*) FROM contacts c ${n}`),u=parseInt(s.rows[0]?.count||"0",10);m.contacts={data:(await i.db.execute(d.sql`
        SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
               c.lead_status, c.lead_source, c.created_at, c.updated_at,
               t.name as tenant_name,
               co.name as company_name
        FROM contacts c
        JOIN tenants t ON c.tenant_id = t.id
        LEFT JOIN companies co ON c.company_id = co.id
        ${n}
        ORDER BY c.${d.sql.raw(R)} ${d.sql.raw(_)}
        LIMIT ${o} OFFSET ${l}
      `)).rows,total:u,page:r,limit:o},"contacts"===a&&(w=u)}if("all"===a||"leads"===a){let e=N("l",["first_name","last_name","email"]);e.push(d.sql`l.deleted_at IS NULL`);let t=d.sql`WHERE ${d.sql.join(e,d.sql` AND `)}`,n=await i.db.execute(d.sql`SELECT count(*) FROM leads l ${t}`),s=parseInt(n.rows[0]?.count||"0",10);m.leads={data:(await i.db.execute(d.sql`
        SELECT l.id, l.first_name, l.last_name, l.email, l.phone,
               l.lead_status, l.created_at,
               t.name as tenant_name
        FROM leads l
        JOIN tenants t ON l.tenant_id = t.id
        ${t}
        ORDER BY l.${d.sql.raw(R)} ${d.sql.raw(_)}
        LIMIT ${o} OFFSET ${l}
      `)).rows,total:s,page:r,limit:o},"leads"===a&&(w=s)}if("all"===a||"deals"===a){let e=N("d",["title"]);e.push(d.sql`d.deleted_at IS NULL`);let t=d.sql`WHERE ${d.sql.join(e,d.sql` AND `)}`,n=await i.db.execute(d.sql`SELECT count(*) FROM deals d ${t}`),s=parseInt(n.rows[0]?.count||"0",10);m.deals={data:(await i.db.execute(d.sql`
        SELECT d.id, d.title, d.amount, d.stage_id, d.close_date,
               d.created_at, d.updated_at,
               t.name as tenant_name,
               c.first_name || ' ' || c.last_name as contact_name
        FROM deals d
        JOIN tenants t ON d.tenant_id = t.id
        LEFT JOIN contacts c ON d.contact_id = c.id
        ${t}
        ORDER BY d.${d.sql.raw("value"===R?"amount":R)} ${d.sql.raw(_)}
        LIMIT ${o} OFFSET ${l}
      `)).rows,total:s,page:r,limit:o},"deals"===a&&(w=s)}if("all"===a||"companies"===a){let e=N("co",["name","industry","website"]);e.push(d.sql`co.deleted_at IS NULL`);let t=d.sql`WHERE ${d.sql.join(e,d.sql` AND `)}`,n=await i.db.execute(d.sql`SELECT count(*) FROM companies co ${t}`),s=parseInt(n.rows[0]?.count||"0",10);m.companies={data:(await i.db.execute(d.sql`
        SELECT co.id, co.name, co.industry, co.website, co.phone,
               co.created_at, co.updated_at,
               t.name as tenant_name,
               (SELECT count(*) FROM contacts WHERE company_id = co.id AND deleted_at IS NULL) as contact_count
        FROM companies co
        JOIN tenants t ON co.tenant_id = t.id
        ${t}
        ORDER BY co.${d.sql.raw(R)} ${d.sql.raw(_)}
        LIMIT ${o} OFFSET ${l}
      `)).rows,total:s,page:r,limit:o},"companies"===a&&(w=s)}if("all"===a||"users"===a){let e=N("u",["email","full_name"]),t=e.length?d.sql`WHERE ${d.sql.join(e,d.sql` AND `)}`:d.sql``,n=await i.db.execute(d.sql`SELECT count(DISTINCT u.id) FROM users u ${t}`),s=parseInt(n.rows[0]?.count||"0",10);m.users={data:(await i.db.execute(d.sql`
        SELECT u.id, u.email, u.full_name, u.is_super_admin,
               u.created_at, u.last_login_at,
               tm.tenant_id, t.name as tenant_name,
               tm.role_slug as tenant_role
        FROM users u
        LEFT JOIN tenant_members tm ON tm.user_id = u.id
        LEFT JOIN tenants t ON tm.tenant_id = t.id
        ${t}
        ORDER BY u.${d.sql.raw(R)} ${d.sql.raw(_)}
        LIMIT ${o} OFFSET ${l}
      `)).rows,total:s,page:r,limit:o},"users"===a&&(w=s)}return s.NextResponse.json({results:m,totalAcrossAll:w,query:t,filters:{type:a,tenantId:n,page:r,limit:o}})}catch(e){return console.error("[Superadmin Data Explorer] Search error:",e),(0,n.apiError)(e)}}[l,i]=u.then?(await u)():u;let w=r.z.object({table:r.z.string().min(1),id:r.z.string().min(1),field:r.z.string().min(1),value:r.z.any()}),N=r.z.object({table:r.z.string().min(1),id:r.z.string().min(1),softDelete:r.z.boolean().optional()});async function _(e){let t=await (0,l.requireAuth)(e);if(!t||t instanceof s.NextResponse)return t instanceof s.NextResponse?t:s.NextResponse.json({error:"Unauthorized"},{status:401});if(!t.isSuperAdmin)return s.NextResponse.json({error:"Super admin access required"},{status:403});try{let t=await e.json(),a=(0,o.validateBody)(w,t);if(a instanceof s.NextResponse)return a;let{table:n,id:r,field:l,value:u}=a.data;if(!["tenants","contacts","leads","deals","companies","tasks","users","roles","webhooks","api_keys","email_templates","workflows","automations","forms","pipelines","deal_stages","tags","modules"].includes(n))return s.NextResponse.json({error:`Table '${n}' is not allowed for editing`},{status:400});let c=l.replace(/[^a-zA-Z0-9_]/g,"");if(!c)return s.NextResponse.json({error:"Invalid field name"},{status:400});let E=await i.db.execute(d.sql`
      UPDATE "${d.sql.raw(n)}" SET "${d.sql.raw(c)}" = ${u}, updated_at = now() 
      WHERE id = ${r} RETURNING id, "${d.sql.raw(c)}"
    `);if(0===E.rows.length)return s.NextResponse.json({error:"Record not found"},{status:404});return s.NextResponse.json({message:"Record updated",data:E.rows[0]})}catch(e){return(0,n.apiError)(e)}}async function m(e){let t=await (0,l.requireAuth)(e);if(!t||t instanceof s.NextResponse)return t instanceof s.NextResponse?t:s.NextResponse.json({error:"Unauthorized"},{status:401});if(!t.isSuperAdmin)return s.NextResponse.json({error:"Super admin access required"},{status:403});try{let t=await e.json(),a=(0,o.validateBody)(N,t);if(a instanceof s.NextResponse)return a;let{table:n,id:r,softDelete:l}=a.data;if(!n||!r)return s.NextResponse.json({error:"table and id are required"},{status:400});if(!["contacts","leads","deals","companies","tasks","webhooks","api_keys","email_templates","workflows","automations","forms","tags","notes"].includes(n))return s.NextResponse.json({error:`Table '${n}' is not allowed for deletion`},{status:400});if(l){let e=await i.db.execute(d.sql`
        UPDATE "${d.sql.raw(n)}" SET deleted_at = NOW() WHERE id = ${r} RETURNING id
      `);if(0===e.rows.length)return s.NextResponse.json({error:"Record not found"},{status:404})}else{let e=await i.db.execute(d.sql`
        DELETE FROM "${d.sql.raw(n)}" WHERE id = ${r} RETURNING id
      `);if(0===e.rows.length)return s.NextResponse.json({error:"Record not found"},{status:404})}return s.NextResponse.json({message:"Record deleted",id:r})}catch(e){return(0,n.apiError)(e)}}e.s(["DELETE",0,m,"GET",0,c,"PUT",0,_]),a()}catch(e){a(e)}},!1),288434,e=>e.a(async(t,a)=>{try{var n=e.i(747909),s=e.i(174017),r=e.i(996250),o=e.i(759756),l=e.i(561916),i=e.i(174677),d=e.i(869741),u=e.i(316795),c=e.i(487718),E=e.i(995169),p=e.i(47587),R=e.i(666012),_=e.i(570101),m=e.i(626937),w=e.i(10372),N=e.i(193695);e.i(820232);var h=e.i(600220),S=e.i(111103),f=t([S]);[S]=f.then?(await f)():f;let L=new n.AppRouteRouteModule({definition:{kind:s.RouteKind.APP_ROUTE,page:"/api/superadmin/data-explorer/route",pathname:"/api/superadmin/data-explorer",filename:"route",bundlePath:""},distDir:".next-build",relativeProjectDir:"",resolvedPagePath:"[project]/app/api/superadmin/data-explorer/route.ts",nextConfigOutput:"",userland:S,...{}}),{workAsyncStorage:O,workUnitAsyncStorage:q,serverHooks:C}=L;async function T(e,t,a){a.requestMeta&&(0,o.setRequestMeta)(e,a.requestMeta),L.isDev&&(0,o.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let n="/api/superadmin/data-explorer/route";n=n.replace(/\/index$/,"")||"/";let r=await L.prepare(e,t,{srcPage:n,multiZoneDraftMode:!1});if(!r)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:S,deploymentId:f,params:T,nextConfig:O,parsedUrl:q,isDraftMode:C,prerenderManifest:b,routerServerContext:x,isOnDemandRevalidate:I,revalidateOnlyGenerated:g,resolvedPathname:$,clientReferenceManifest:F,serverActionsManifest:M}=r,A=(0,d.normalizeAppPath)(n),y=!!(b.dynamicRoutes[A]||b.routes[$]),v=async()=>((null==x?void 0:x.render404)?await x.render404(e,t,q,!1):t.end("This page could not be found"),null);if(y&&!C){let e=!!b.routes[$],t=b.dynamicRoutes[A];if(t&&!1===t.fallback&&!e){if(O.adapterPath)return await v();throw new N.NoFallbackError}}let H=null;!y||L.isDev||C||(H=$,H="/index"===H?"/":H);let D=!0===L.isDev||!y,U=y&&!D;M&&F&&(0,i.setManifestsSingleton)({page:n,clientReferenceManifest:F,serverActionsManifest:M});let W=e.method||"GET",j=(0,l.getTracer)(),k=j.getActiveScopeSpan(),P=!!(null==x?void 0:x.isWrappedByNextServer),B=!!(0,o.getRequestMeta)(e,"minimalMode"),z=(0,o.getRequestMeta)(e,"incrementalCache")||await L.getIncrementalCache(e,O,b,B);null==z||z.resetRequestCache(),globalThis.__incrementalCache=z;let J={params:T,previewProps:b.preview,renderOpts:{experimental:{authInterrupts:!!O.experimental.authInterrupts},cacheComponents:!!O.cacheComponents,supportsDynamicResponse:D,incrementalCache:z,cacheLifeProfiles:O.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,a,n,s)=>L.onRequestError(e,t,n,s,x)},sharedContext:{buildId:S,deploymentId:f}},K=new u.NodeNextRequest(e),Y=new u.NodeNextResponse(t),G=c.NextRequestAdapter.fromNodeNextRequest(K,(0,c.signalFromNodeResponse)(t));try{let r,o=async e=>L.handle(G,J).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let a=j.getRootSpanAttributes();if(!a)return;if(a.get("next.span_type")!==E.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${a.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let s=a.get("next.route");if(s){let t=`${W} ${s}`;e.setAttributes({"next.route":s,"http.route":s,"next.span_name":t}),e.updateName(t),r&&r!==e&&(r.setAttribute("http.route",s),r.updateName(t))}else e.updateName(`${W} ${n}`)}),i=async r=>{var l,i;let d=async({previousCacheEntry:s})=>{try{if(!B&&I&&g&&!s)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let n=await o(r);e.fetchMetrics=J.renderOpts.fetchMetrics;let l=J.renderOpts.pendingWaitUntil;l&&a.waitUntil&&(a.waitUntil(l),l=void 0);let i=J.renderOpts.collectedTags;if(!y)return await (0,R.sendResponse)(K,Y,n,J.renderOpts.pendingWaitUntil),null;{let e=await n.blob(),t=(0,_.toNodeOutgoingHttpHeaders)(n.headers);i&&(t[w.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let a=void 0!==J.renderOpts.collectedRevalidate&&!(J.renderOpts.collectedRevalidate>=w.INFINITE_CACHE)&&J.renderOpts.collectedRevalidate,s=void 0===J.renderOpts.collectedExpire||J.renderOpts.collectedExpire>=w.INFINITE_CACHE?void 0:J.renderOpts.collectedExpire;return{value:{kind:h.CachedRouteKind.APP_ROUTE,status:n.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:a,expire:s}}}}catch(t){throw(null==s?void 0:s.isStale)&&await L.onRequestError(e,t,{routerKind:"App Router",routePath:n,routeType:"route",revalidateReason:(0,p.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:I})},!1,x),t}},u=await L.handleResponse({req:e,nextConfig:O,cacheKey:H,routeKind:s.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:b,isRoutePPREnabled:!1,isOnDemandRevalidate:I,revalidateOnlyGenerated:g,responseGenerator:d,waitUntil:a.waitUntil,isMinimalMode:B});if(!y)return null;if((null==u||null==(l=u.value)?void 0:l.kind)!==h.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==u||null==(i=u.value)?void 0:i.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});B||t.setHeader("x-nextjs-cache",I?"REVALIDATED":u.isMiss?"MISS":u.isStale?"STALE":"HIT"),C&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let c=(0,_.fromNodeOutgoingHttpHeaders)(u.value.headers);return B&&y||c.delete(w.NEXT_CACHE_TAGS_HEADER),!u.cacheControl||t.getHeader("Cache-Control")||c.get("Cache-Control")||c.set("Cache-Control",(0,m.getCacheControlHeader)(u.cacheControl)),await (0,R.sendResponse)(K,Y,new Response(u.value.body,{headers:c,status:u.value.status||200})),null};P&&k?await i(k):(r=j.getActiveScopeSpan(),await j.withPropagatedContext(e.headers,()=>j.trace(E.BaseServerSpan.handleRequest,{spanName:`${W} ${n}`,kind:l.SpanKind.SERVER,attributes:{"http.method":W,"http.target":e.url}},i),void 0,!P))}catch(t){if(t instanceof N.NoFallbackError||await L.onRequestError(e,t,{routerKind:"App Router",routePath:A,routeType:"route",revalidateReason:(0,p.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:I})},!1,x),y)throw t;return await (0,R.sendResponse)(K,Y,new Response(null,{status:500})),null}}e.s(["handler",0,T,"patchFetch",0,function(){return(0,r.patchFetch)({workAsyncStorage:O,workUnitAsyncStorage:q})},"routeModule",0,L,"serverHooks",0,C,"workAsyncStorage",0,O,"workUnitAsyncStorage",0,q]),a()}catch(e){a(e)}},!1)];

//# sourceMappingURL=_08xiqy3._.js.map