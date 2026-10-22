// Extra demo records so every dynamic page has something to show. Runs after seed.mjs.
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = (s, p) => c.query(s, p);
const org = (await q(`select id from organization where slug='enablenow-demo'`)).rows[0].id;
await q(`update "user" set is_superadmin=true where id='demo-user'`);
const opp = (await q(`select id from opportunity where organization_id=$1 order by created_at limit 1`, [org])).rows[0].id;
const prop = (await q(`select id from proposal where organization_id=$1 order by created_at limit 1`, [org])).rows[0].id;
const sol = (await q(`select id from solicitation where organization_id=$1 and parse_status='parsed' order by created_at limit 1`, [org])).rows[0].id;
const reqs = [
  { kind: "shall", text: "The contractor shall migrate all incident, problem and change records to ServiceNow ITSM within 120 days of award.", ref: "C.3.1" },
  { kind: "shall", text: "The contractor shall maintain 99.9% platform availability measured monthly.", ref: "C.4.2" },
  { kind: "should", text: "The offeror should describe its approach to CMDB health and service mapping.", ref: "L.5.2" },
  { kind: "shall", text: "Key personnel shall hold active ServiceNow CSA certification.", ref: "H.7" },
];
await q(`update solicitation set extracted_requirements=$2, raw_text=$3, section_l_summary=$4, section_m_summary=$5, solicitation_number='36C10B26R0042', naics_code='541512', set_aside='SDVOSB' where id=$1`,
  [sol, JSON.stringify(reqs), "SECTION C — STATEMENT OF WORK\nC.3.1 The contractor shall migrate all incident, problem and change records...\nSECTION L\nL.5.2 The offeror should describe...", "Volume I Technical (25 pages), Volume II Management (15 pages), Volume III Past Performance (3 references).", "Technical approach is most important, followed by management and past performance; price is evaluated for reasonableness."]);
// An amendment for the diff page.
await q(`insert into solicitation(organization_id,title,agency,type,parse_status,parent_solicitation_id,amendment_number,file_name,file_size,content_type,storage_path,extracted_requirements,opportunity_id)
  values($1,'VA ITSM Modernization RFP — Amendment 0001','Department of Veterans Affairs','rfp','parsed',$2,'0001','Amendment 0001.pdf',204800,'application/pdf','',$3,$4)`,
  [org, sol, JSON.stringify([...reqs.slice(0, 3), { kind: "shall", text: "Key personnel shall hold active ServiceNow CSA and CIS-ITSM certifications.", ref: "H.7" }]), opp]);
await q(`insert into solicitation_document(organization_id,solicitation_id,document_type,file_name,file_size,content_type,storage_path,parse_status) values($1,$2,'pws','Attachment J-1 PWS.pdf',512000,'application/pdf','','parsed')`, [org, sol]);
await q(`insert into company(organization_id,name,uei,cage_code,website,city,state,primary_naics,relationship,created_by_user_id) values($1,'Acme Federal Solutions','ABC123DEF456','7XY12','https://acme.example','Reston','VA','541512','competitor','demo-user')`, [org]);
await q(`insert into knowledge_entry(organization_id,kind,title,body,tags,created_by_user_id) values($1,'past_performance','VA Enterprise Service Desk (2021–2025)','Delivered a 24x7 ServiceNow service desk for 400,000 users with 98% first-call resolution.',ARRAY['va','itsm'],'demo-user')`, [org]);
await q(`insert into knowledge_artifact(organization_id,kind,source,title,tags,file_name,file_size,content_type,storage_path,raw_text,status,indexed_at,uploaded_by_user_id) values($1,'capability_brief','uploaded','ServiceNow Capability Brief',ARRAY['servicenow'],'capability-brief.pdf',350000,'application/pdf','','EnableNow is a ServiceNow pure-play partner. ITSM, CSM, HRSD, SecOps, ITAM.','indexed',now(),'demo-user')`, [org]);
await q(`insert into notification_rule(organization_id,name,description,trigger_event_kind,recipient_strategy,recipient_config,channels,created_by_user_id) values($1,'Due-soon alerts','Tell the capture lead 7 days before a response is due.','opportunity_due_soon','role_based','{"roles":["admin"]}',ARRAY['in_app','email']::notification_channel[],'demo-user')`, [org]);
await q(`insert into proposal_template(organization_id,name,description,created_by_user_id) values($1,'EnableNow standard','House template for federal responses.','demo-user')`, [org]);
await q(`insert into proposal_review(proposal_id,color,status,summary,started_by_user_id,started_at,due_date,instructions) values($1,'pink','in_progress','First look at the technical volume.','demo-user',now(),now()+interval '5 days','Score each section against Section M.')`, [prop]);
await q(`insert into opportunity_review_request(organization_id,opportunity_id,sender_user_id,reviewer_email,reviewer_name,token,note,expires_at) values($1,$2,'demo-user','reviewer@example.gov','Jordan Lee','demo-review-token-0001','Go / no-go before Friday, please.',now()+interval '7 days')`, [org, opp]);
await q(`insert into promotion_code(code,description,discount_percent,max_uses,active) values('DEMO20','Demo discount',20,50,true) on conflict do nothing`);
await q(`insert into extraction_gold_doc(title,notice_id,solicitation_number,raw_text,status,created_by_user_id) values('Gold: VA ITSM RFP','demo-notice-1','36C10B26R0042','C.3.1 The contractor shall migrate...','in_review','demo-user')`);
console.log("seed2 done");
await c.end();
