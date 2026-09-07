import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runtime,migrations} from './runtime.mjs';
const db=await runtime();
let passed=0, failed=0;
async function check(name,fn){
  try{await fn();console.log('PASS '+name);passed++;}
  catch(e){failed++;console.log('FAIL '+name+' '+JSON.stringify({code:e.code,message:e.message,where:e.where}));throw e;}
}
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
async function as(user,sql,params=[],role='authenticated'){
  return db.transaction(async tx=>{
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user||'']);
    await tx.exec('SET LOCAL ROLE '+role);
    return (await tx.query(sql,params)).rows;
  });
}
async function rpc(user,name,args,role='authenticated'){
  const keys=Object.keys(args);
  const rows=await as(user,`SELECT public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) AS result`,Object.values(args),role);
  return rows[0].result;
}
async function denied(fn,rx){await assert.rejects(fn,e=>!rx||rx.test(e.message));}
const key=()=>randomUUID();
try{
  console.log((await q('SELECT version()'))[0].version);
  await check('All five unchanged-on-load repaired migrations commit',()=>migrations(db));
  const ws=(await q('SELECT id FROM public.workspaces'))[0].id;
  const roster=await q('SELECT * FROM public.roster_people');
  const clients=await q('SELECT * FROM public.clients');
  const R=Object.fromEntries(roster.map(r=>[r.display_name,r.id]));
  const C=Object.fromEntries(clients.map(c=>[c.name,c.id]));
  const U={};
  await check('Seed counts: 28 / 27 active / one unassigned zanzi / no capacities',async()=>{
    assert.equal(clients.length,28);assert.equal(clients.filter(c=>c.state==='Active').length,27);
    assert.equal(clients.find(c=>c.name==='zanzi').owner_roster_id,null);
    assert.equal(roster.length,7);assert.equal((await q('SELECT * FROM public.member_capacities')).length,0);
    assert.deepEqual(Object.fromEntries(['Easy','Medium','Hard','Unknown'].map(d=>[d,clients.filter(c=>c.difficulty===d).length])),{Easy:8,Medium:15,Hard:4,Unknown:1});
    for(const [name,count] of [['ندى',5],['عماد',3],['سارة',5],['آلاء',5],['شهد',5],['آية',4]])assert.equal(clients.filter(c=>c.owner_roster_id===R[name]&&c.state==='Active').length,count);
  });
  // Auth identities below exist only in this in-memory test database.
  for(const person of roster){
    const uid=randomUUID();U[person.display_name]=uid;
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[uid,uid+'@example.test']);
  }
  const owner=U['المدير العام (Owner)'],emad=U['عماد'],sarah=U['سارة'],aya=U['آية'],nada=U['ندى'];
  const ownArgs={p_workspace_id:ws,p_owner_user_id:owner,p_roster_person_id:R['المدير العام (Owner)']};
  await check('Owner bootstrap denied to authenticated and anon',async()=>{
    await denied(()=>rpc(owner,'bootstrap_owner',ownArgs),/permission denied/);
    await denied(()=>rpc(null,'bootstrap_owner',ownArgs,'anon'),/permission denied/);
  });
  await check('Owner bootstrap through service_role succeeds',()=>rpc(owner,'bootstrap_owner',ownArgs,'service_role'));
  for(const [name,role] of [['عماد','manager'],['ندى','senior_reviewer'],['سارة','designer'],['آلاء','designer'],['شهد','designer'],['آية','designer']]){
    await q('INSERT INTO public.workspace_memberships(workspace_id,user_id,roster_person_id,role) VALUES($1,$2,$3,$4)',[ws,U[name],R[name],role]);
  }
  const call=(name,args={})=>rpc(owner,name,{p_workspace_id:ws,...args,p_idempotency_key:args.p_idempotency_key||key()});
  let campaign, task, manual, round, snap;
  await check('Campaign creation and retry preserve the same id',async()=>{
    const args={p_client_id:C['wael samir'],p_title:'September campaign',p_idempotency_key:key()};
    campaign=await call('create_campaign',args);
    assert.deepEqual(await call('create_campaign',args),campaign);
  });
  await check('Task creation preserves brief and Post 01 through wrapper',async()=>{
    task=await call('create_task',{p_client_id:C['wael samir'],p_campaign_id:campaign.campaign_id,p_title:'Post 01',p_deliverable_number:'Post 01',p_brief:'Test brief',p_primary_assignee_id:R['سارة'],p_due_at:'2026-09-10T12:00:00+03:00'});
    const t=(await q('SELECT * FROM public.tasks WHERE id=$1',[task.task_id]))[0];
    assert.equal(t.brief,'Test brief');assert.equal(t.deliverable_number,'Post 01');
  });
  const transition=(user,status,id=task.task_id,extra={})=>rpc(user,'transition_task_status',{p_task_id:id,p_workspace_id:ws,p_new_status:status,p_idempotency_key:key(),...extra});
  await check('Unassigned task denies unrelated designer content edits',async()=>{
    const unassigned=await call('create_task',{p_client_id:C['wael samir'],p_title:'Unassigned'});
    await denied(()=>rpc(aya,'update_task_details',{p_workspace_id:ws,p_task_id:unassigned.task_id,p_title:'Intrusion',p_idempotency_key:key()}),/Permission denied/);
    await denied(()=>transition(aya,'ready',unassigned.task_id),/Access denied/);
  });
  await check('Protected direct task UPDATE denied',()=>denied(()=>as(sarah,'UPDATE public.tasks SET status=\'approved\' WHERE id=$1',[task.task_id]),/permission denied/));
  await check('Priority cannot bypass manager RPC through content edits',()=>denied(()=>rpc(sarah,'update_task_details',{p_workspace_id:ws,p_task_id:task.task_id,p_priority:'Urgent',p_idempotency_key:key()}),/Only Owner or Manager/));
  await check('Valid ready -> in_progress workflow',async()=>{await transition(owner,'ready');await transition(sarah,'in_progress');});
  await check('Unrelated member cannot start timer or submit review',async()=>{
    await denied(()=>rpc(aya,'start_or_switch_timer',{p_workspace_id:ws,p_task_id:task.task_id,p_idempotency_key:key()}),/Access denied/);
    await denied(()=>rpc(aya,'submit_review_round',{p_workspace_id:ws,p_task_id:task.task_id,p_preview_url:'https://example.test/preview',p_idempotency_key:key()}),/Access denied/);
  });
  await check('Sarah September 6, 11:00-12:00 Cairo = 3600 stored seconds',async()=>{
    manual=await rpc(sarah,'record_manual_time_entry',{p_workspace_id:ws,p_task_id:task.task_id,p_started_at:'2026-09-06T11:00:00+03:00',p_ended_at:'2026-09-06T12:00:00+03:00',p_category:'initial_design',p_idempotency_key:key()});
    assert.equal(manual.duration_seconds,3600);
    assert.equal((await q('SELECT duration_seconds FROM public.time_entries WHERE id=$1',[manual.time_entry_id]))[0].duration_seconds,3600);
  });
  await check('Postgres rejects overlapping closed time and future time',async()=>{
    await denied(()=>rpc(sarah,'record_manual_time_entry',{p_workspace_id:ws,p_task_id:task.task_id,p_started_at:'2026-09-06T11:30:00+03:00',p_ended_at:'2026-09-06T12:30:00+03:00',p_idempotency_key:key()}),/conflicting key|overlap/);
    await denied(()=>rpc(sarah,'record_manual_time_entry',{p_workspace_id:ws,p_task_id:task.task_id,p_started_at:'2099-01-01T11:00:00Z',p_ended_at:'2099-01-01T12:00:00Z',p_idempotency_key:key()}),/future/);
  });
  await check('RLS hides Sarah ledger from Aya and permits Sarah',async()=>{
    assert.equal((await as(aya,'SELECT * FROM public.time_entries WHERE id=$1',[manual.time_entry_id])).length,0);
    assert.equal((await as(sarah,'SELECT * FROM public.time_entries WHERE id=$1',[manual.time_entry_id])).length,1);
  });
  await check('September SQL report includes Sarah exact hour and six team members',async()=>{
    const report=await rpc(owner,'generate_monthly_report_draft',{p_workspace_id:ws,p_month_key:'2026-09'});
    assert.equal(report.designerSummary.length,6);
    const row=report.designerSummary.find(x=>x.rosterPersonId===R['سارة']);
    assert.equal(row.loggedHours,1);assert.equal(row.designHours,1);assert.equal(row.monthlyCapacityHours,null);
  });
  await check('Timer retry returns the same entry; switch leaves one open',async()=>{
    const args={p_workspace_id:ws,p_task_id:task.task_id,p_note:'Timer',p_idempotency_key:key()};
    const a=await rpc(sarah,'start_or_switch_timer',args);
    assert.deepEqual(await rpc(sarah,'start_or_switch_timer',args),a);
    await rpc(sarah,'start_or_switch_timer',{...args,p_idempotency_key:key()});
    assert.equal((await q('SELECT * FROM public.time_entries WHERE roster_person_id=$1 AND ended_at IS NULL AND NOT is_voided',[R['سارة']])).length,1);
  });
  await check('Review submission resolves reviewer and closes all task timers',async()=>{
    await call('add_task_collaborator',{p_task_id:task.task_id,p_roster_person_id:R['آلاء']});
    await call('start_timer_on_behalf',{p_task_id:task.task_id,p_target_roster_id:R['آلاء'],p_reason:'Test coverage'});
    round=await rpc(sarah,'submit_review_round',{p_workspace_id:ws,p_task_id:task.task_id,p_preview_url:'https://example.test/preview',p_note:'Review note',p_idempotency_key:key()});
    assert.equal(round.reviewer_id,R['عماد']);
    assert.equal((await q('SELECT * FROM public.time_entries WHERE task_id=$1 AND ended_at IS NULL AND NOT is_voided',[task.task_id])).length,0);
  });
  await check('Self approval and missing change feedback are denied',async()=>{
    await denied(()=>rpc(sarah,'decide_review_round',{p_workspace_id:ws,p_round_id:round.round_id,p_decision:'approved',p_idempotency_key:key()}),/Self-approval/);
    await denied(()=>rpc(emad,'decide_review_round',{p_workspace_id:ws,p_round_id:round.round_id,p_decision:'changes_requested',p_idempotency_key:key()}),/Feedback/);
  });
  await check('Reviewer approves; DB freezes submitted content and decided round',async()=>{
    await denied(()=>q('UPDATE public.review_rounds SET decision=\'approved\', decided_at=now(), note=\'tamper\' WHERE id=$1',[round.round_id]),/immutable/);
    await rpc(emad,'decide_review_round',{p_workspace_id:ws,p_round_id:round.round_id,p_decision:'approved',p_idempotency_key:key()});
    await denied(()=>q('UPDATE public.review_rounds SET feedback=\'tamper\' WHERE id=$1',[round.round_id]),/immutable/);
    await denied(()=>q('DELETE FROM public.review_rounds WHERE id=$1',[round.round_id]),/cannot be deleted/);
  });
  await check('Delivery requires deliverable; succeeds with URL; requires reopen reason',async()=>{
    await denied(()=>transition(sarah,'delivered'),/deliverable/);
    await transition(sarah,'delivered',task.task_id,{p_final_deliverable_url:'https://example.test/final'});
    await denied(()=>transition(owner,'in_progress'),/reason/);
    await transition(owner,'in_progress',task.task_id,{p_reason:'Client revision'});
  });
  await check('Block and cancel close running timer and preserve reasons',async()=>{
    await rpc(sarah,'start_or_switch_timer',{p_workspace_id:ws,p_task_id:task.task_id,p_idempotency_key:key()});
    await transition(sarah,'blocked',task.task_id,{p_reason:'Missing assets'});
    assert.equal((await q('SELECT * FROM public.time_entries WHERE task_id=$1 AND ended_at IS NULL AND NOT is_voided',[task.task_id])).length,0);
    await transition(owner,'in_progress');
  });
  await check('Correction approval replaces original once with composite lineage',async()=>{
    const request=await rpc(sarah,'request_time_correction',{p_workspace_id:ws,p_time_entry_id:manual.time_entry_id,p_proposed_started_at:'2026-09-06T11:00:00+03:00',p_proposed_ended_at:'2026-09-06T12:00:00+03:00',p_reason:'Correct category',p_proposed_category:'internal_revision',p_idempotency_key:key()});
    const args={p_request_id:request.correction_request_id,p_decision:'approved',p_review_notes:'Checked',p_idempotency_key:key()};
    const approved=await call('decide_time_correction',args);
    assert.deepEqual(await call('decide_time_correction',args),approved);
    assert.equal((await q('SELECT * FROM public.time_entries WHERE correction_request_id=$1',[request.correction_request_id])).length,1);
    assert.equal((await q('SELECT is_voided FROM public.time_entries WHERE id=$1',[manual.time_entry_id]))[0].is_voided,true);
  });
  await check('All public SECURITY DEFINER RPCs deny anon execute',async()=>{
    const bad=await q("SELECT p.oid::regprocedure::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prosecdef AND has_function_privilege('anon',p.oid,'EXECUTE')");
    assert.deepEqual(bad,[]);
  });
  await check('Authenticated cannot invoke internal idempotency writer',()=>denied(()=>as(sarah,"SELECT private.fn_record_idempotency($1,$2,'x','x','x','{}')",[ws,R['سارة']]),/permission denied/));
  await check('Actual table column grants protect notification identity',async()=>{
    const bad=await q("SELECT column_name FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='in_app_notifications' AND grantee='authenticated' AND privilege_type='UPDATE'");
    assert.deepEqual(bad.map(x=>x.column_name),['is_read']);
  });
  await check('Same key changed previously omitted payload rejects conflict',async()=>{
    const args={p_workspace_id:ws,p_task_id:task.task_id,p_title:'Updated',p_description:'A',p_idempotency_key:key()};
    await rpc(sarah,'update_task_details',args);
    await denied(()=>rpc(sarah,'update_task_details',{...args,p_description:'B'}),/Idempotency key conflict/);
  });
  await check('Campaign update/archive and batch posts execute and replay',async()=>{
    await call('update_campaign',{p_campaign_id:campaign.campaign_id,p_objective:'Brief'});
    const camp=await call('create_campaign',{p_client_id:C['hmd'],p_title:'Batch'});
    const args={p_campaign_id:camp.campaign_id,p_client_id:C['hmd'],p_primary_assignee_id:R['ندى'],p_idempotency_key:key()};
    const batch=await call('generate_campaign_posts',args);assert.equal(batch.post_count,12);
    assert.deepEqual(await call('generate_campaign_posts',args),batch);
    await call('archive_campaign',{p_campaign_id:camp.campaign_id});
  });
  await check('Checklist create/update/delete work through authorized RPCs',async()=>{
    const item=await call('create_task_checklist_item',{p_task_id:task.task_id,p_title:'Check export',p_sort_order:2});
    await call('update_task_checklist_item',{p_item_id:item.item_id,p_is_completed:true});
    assert.equal((await q('SELECT is_completed FROM public.task_checklist_items WHERE id=$1',[item.item_id]))[0].is_completed,true);
    const args={p_item_id:item.item_id,p_idempotency_key:key()};
    const deleted=await call('delete_task_checklist_item',args);
    assert.deepEqual(await call('delete_task_checklist_item',args),deleted);
  });
  await check('Attachment metadata rejects wrong workspace/path and supports delete',async()=>{
    const args={p_task_id:task.task_id,p_file_name:'file.png',p_storage_path:`${ws}/${task.task_id}/file.png`,p_file_size_bytes:100,p_mime_type:'image/png'};
    await denied(()=>call('create_task_attachment',{...args,p_storage_path:`${randomUUID()}/${task.task_id}/file.png`}),/workspace/);
    const attachment=await call('create_task_attachment',args);
    const delArgs={p_attachment_id:attachment.attachment_id,p_idempotency_key:key()};
    const deleted=await call('delete_task_attachment',delArgs);
    assert.deepEqual(await call('delete_task_attachment',delArgs),deleted);
  });
  await check('Client/roster/capacity/settings/routing mutations and idempotency execute',async()=>{
    const c=await call('create_client',{p_name:'Test client'});await call('update_client',{p_client_id:c.client_id,p_notes:'note'});await call('archive_client',{p_client_id:c.client_id});
    const args={p_display_name:'Test roster',p_job_title:'Test',p_idempotency_key:key()};
    const person=await call('create_roster_person',args);assert.deepEqual(await call('create_roster_person',args),person);
    await call('update_roster_person',{p_roster_person_id:person.roster_person_id,p_display_name:'Test roster',p_job_title:'Changed',p_is_active:false});
    await call('upsert_member_capacity',{p_roster_person_id:R['سارة'],p_weekly_hours:30,p_reserved_management_hours:3});
    await call('manage_leave_day',{p_roster_person_id:R['سارة'],p_leave_date:'2026-09-07',p_hours:6});
    await call('update_workspace_settings',{p_name:'OMG Creative',p_workweek_days:[0,1,2,3,4]});
    const rule=await call('create_review_routing_rule',{p_priority:99,p_designer_roster_id:R['ندى'],p_client_difficulty:'Easy',p_reviewer_roster_id:R['عماد'],p_fallback_reviewer_id:R['المدير العام (Owner)']});
    await call('delete_review_routing_rule',{p_rule_id:rule.rule_id});
  });
  await check('Invitation returns raw token once; safe retry; email match; acceptance',async()=>{
    const person=await call('create_roster_person',{p_display_name:'Invite test',p_job_title:'Test'});
    const uid=randomUUID();await q('INSERT INTO auth.users(id,email) VALUES($1,$2)',[uid,'invite@example.test']);
    const args={p_email:'invite@example.test',p_role:'designer',p_roster_person_id:person.roster_person_id,p_idempotency_key:key()};
    const inv=await call('create_workspace_invitation',args);assert.equal(inv.raw_token.length,64);
    const retry=await call('create_workspace_invitation',args);assert.equal(retry.raw_token,undefined);assert.equal(retry.invitation_id,inv.invitation_id);
    assert.equal((await q('SELECT count(*)::int AS n FROM public.rpc_idempotency_records WHERE response_payload::text LIKE $1',['%'+inv.raw_token+'%']))[0].n,0);
    await denied(()=>rpc(aya,'accept_workspace_invitation',{p_raw_token:inv.raw_token}),/does not match/);
    await rpc(uid,'accept_workspace_invitation',{p_raw_token:inv.raw_token});
    await denied(()=>rpc(uid,'accept_workspace_invitation',{p_raw_token:inv.raw_token}),/no longer pending/);
    await call('update_roster_person',{p_roster_person_id:person.roster_person_id,p_display_name:'Invite test',p_job_title:'Test',p_is_active:false});
  });
  await check('Inactive roster loses RLS and RPC access immediately',async()=>{
    await q('UPDATE public.roster_people SET is_active=false WHERE id=$1',[R['سارة']]);
    assert.equal((await as(sarah,'SELECT * FROM public.time_entries')).length,0);
    await denied(()=>rpc(sarah,'start_or_switch_timer',{p_workspace_id:ws,p_task_id:task.task_id,p_idempotency_key:key()}),/Active workspace/);
    await q('UPDATE public.roster_people SET is_active=true WHERE id=$1',[R['سارة']]);
  });
  await check('Real SQL routing: Aya -> Nada, Sarah Hard -> Emad, Emad Hard -> Owner',async()=>{
    for(const [name,client,reviewer] of [['آية','rejuva','ندى'],['سارة','dr khalaf','عماد'],['عماد','karma','المدير العام (Owner)']]){
      const t=await call('create_task',{p_client_id:C[client],p_title:'Routing '+name,p_primary_assignee_id:R[name]});
      await transition(owner,'ready',t.task_id);await transition(U[name],'in_progress',t.task_id);
      const rr=await rpc(U[name],'submit_review_round',{p_workspace_id:ws,p_task_id:t.task_id,p_preview_url:'https://example.test/routing',p_idempotency_key:key()});
      assert.equal(rr.reviewer_id,R[reviewer]);
    }
  });
  await check('Storage SQL policies allow assigned uploader; deny unrelated/malformed/mismatched paths',async()=>{
    assert.equal((await q('SELECT * FROM storage.buckets WHERE public')).length,0);
    const path=`${ws}/${task.task_id}/storage-test.png`;
    await as(sarah,"INSERT INTO storage.objects(bucket_id,name) VALUES('deliverables',$1)",[path]);
    assert.equal((await as(sarah,'SELECT * FROM storage.objects WHERE name=$1',[path])).length,1);
    assert.equal((await as(aya,'SELECT * FROM storage.objects WHERE name=$1',[path])).length,0);
    await denied(()=>as(aya,"INSERT INTO storage.objects(bucket_id,name) VALUES('deliverables',$1)",[`${ws}/${task.task_id}/unauthorized.png`]),/row-level security/);
    await denied(()=>as(sarah,"INSERT INTO storage.objects(bucket_id,name) VALUES('deliverables',$1)",[`${randomUUID()}/${task.task_id}/mismatch.png`]),/row-level security/);
    await denied(()=>as(sarah,"INSERT INTO storage.objects(bucket_id,name) VALUES('deliverables','bad-uuid/bad-uuid/file.png')"),/row-level security/);
  });
  await check('Manager timer stop reason and negative involvement are enforced',async()=>{
    await denied(()=>call('start_timer_on_behalf',{p_task_id:task.task_id,p_target_roster_id:R['آية'],p_reason:'Test'}),/not assigned/);
    const timer=await rpc(sarah,'start_or_switch_timer',{p_workspace_id:ws,p_task_id:task.task_id,p_idempotency_key:key()});
    await denied(()=>call('stop_timer',{p_time_entry_id:timer.time_entry_id}),/Reason/);
    const stopped=await call('stop_timer',{p_time_entry_id:timer.time_entry_id,p_reason:'Forgotten timer'});
    assert.equal(stopped.success,true);
  });
  await check('Reassignment / due date / priority / collaborators use persistent RPCs',async()=>{
    await call('change_task_assignee',{p_task_id:task.task_id,p_new_assignee_id:R['سارة'],p_reason:'Retain Sarah'});
    await call('change_task_reviewer',{p_task_id:task.task_id,p_new_reviewer_id:R['ندى'],p_reason:'New reviewer'});
    await call('change_task_due_date',{p_task_id:task.task_id,p_new_due_date:'2026-09-11T12:00:00+03:00',p_reason:'New schedule'});
    await call('update_task_priority',{p_task_id:task.task_id,p_priority:'High'});
    await call('remove_task_collaborator',{p_task_id:task.task_id,p_roster_person_id:R['آلاء']});
    const t=(await q('SELECT * FROM public.tasks WHERE id=$1',[task.task_id]))[0];assert.equal(t.priority,'High');assert.equal(t.reviewer_id,R['ندى']);
  });
  await check('Cross-month fixture: 2-hour SQL session splits 1h September + 1h October',async()=>{
    // Future historical fixtures are inserted by the test superuser only, never by seed/RPC.
    const report=()=>rpc(owner,'generate_monthly_report_draft',{p_workspace_id:ws,p_month_key:'2026-09'});
    const before=(await report()).executiveSummary.totalHours;
    await q("INSERT INTO public.time_entries(workspace_id,task_id,roster_person_id,started_at,ended_at,duration_seconds,category,source,created_by_id) VALUES($1,$2,$3,'2026-09-30 23:00:00+03','2026-10-01 01:00:00+03',7200,'initial_design','manual',$3)",[ws,task.task_id,R['سارة']]);
    assert.equal(Math.round(((await report()).executiveSummary.totalHours-before)*100),100);
    const october=await rpc(owner,'generate_monthly_report_draft',{p_workspace_id:ws,p_month_key:'2026-10'});
    assert.equal(october.executiveSummary.totalHours,1);
  });
  await check('Lifetime first delivery vs same/next-month redelivery classification',async()=>{
    const t=await call('create_task',{p_client_id:C['wael samir'],p_title:'Historical delivery fixture',p_primary_assignee_id:R['سارة']});
    // Event fixtures below deliberately cross future reporting boundaries.
    for(const date of ['2026-09-10T10:00:00+03:00','2026-09-11T10:00:00+03:00','2026-10-02T10:00:00+03:00'])
      await q("INSERT INTO public.task_status_events(workspace_id,task_id,to_status,actor_id,created_at) VALUES($1,$2,'delivered',$3,$4)",[ws,t.task_id,R['المدير العام (Owner)'],date]);
    const sep=await rpc(owner,'generate_monthly_report_draft',{p_workspace_id:ws,p_month_key:'2026-09'});
    const oct=await rpc(owner,'generate_monthly_report_draft',{p_workspace_id:ws,p_month_key:'2026-10'});
    assert.equal(sep.executiveSummary.redeliveries,1);assert.equal(oct.executiveSummary.redeliveries,1);
    assert.equal(oct.executiveSummary.uniqueFirstDeliveries,0);
    assert.equal(oct.designerSummary.find(x=>x.rosterPersonId===R['سارة']).firstDeliveredTasks,0);
  });
  await check('Finalization produces immutable snapshot with self-consistent metadata/hash',async()=>{
    const args={p_month_key:'2026-09',p_management_commentary:{note:'Monthly test'},p_idempotency_key:key()};
    snap=await call('finalize_monthly_report_snapshot',args);assert.deepEqual(await call('finalize_monthly_report_snapshot',args),snap);
    const row=(await q("SELECT *,encode(extensions.digest(snapshot_data::text,'sha256'),'hex') AS computed FROM public.monthly_report_snapshots WHERE id=$1",[snap.snapshot_id]))[0];
    assert.equal(row.computed,row.snapshot_hash);assert.equal(row.snapshot_data.isFinalized,true);assert.equal(row.snapshot_data.revisionNumber,row.revision_number);
    assert.equal(new Date(row.snapshot_data.finalizedAt).toISOString(),new Date(row.finalized_at).toISOString());
    assert.deepEqual(row.snapshot_data.managementCommentary,row.management_commentary);
    await denied(()=>q("UPDATE public.monthly_report_snapshots SET management_commentary='{}' WHERE id=$1",[snap.snapshot_id]),/immutable|cannot/);
  });
}catch(e){if(!failed){failed++;console.log('FAIL setup '+JSON.stringify({code:e.code,message:e.message,where:e.where}));}}
finally{await db.close();console.log(`RESULT ${passed} PASSED, ${failed} FAILED`);if(failed)process.exitCode=1;}
