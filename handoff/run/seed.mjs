// Seed a demo tenant for local screenshots (idempotent: removes the previous demo org first).
import pg from "pg";
import bcrypt from "bcryptjs";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = (s, p) => c.query(s, p);
await q(`delete from organization where slug='enablenow-demo'`);
await q(`delete from "user" where id='demo-user'`);
await q(`delete from subscription_tier where slug='demo-unlimited'`);
const hash = await bcrypt.hash("ForgeDemo!2026", 12);
await q(`insert into "user"(id,name,email,"emailVerified",password_hash) values('demo-user','Avery Morgan','demo@forge.test',now(),$1)`, [hash]);
const org = (await q(`insert into organization(name,slug) values('EnableNow Demo','enablenow-demo') returning id`)).rows[0].id;
await q(`insert into membership(user_id,organization_id,role,status) values('demo-user',$1,'admin','active')`, [org]);
const flags = { aiAutoDraft: true, winnerAnalysis: true, complianceMatrix: true, bulkExport: true, apiAccess: true, customTemplates: true, advancedReporting: true };
const quotas = { aiRequestsPerMonth: 0, aiTokensPerMonth: 0, proposalsPerMonth: 0, seatsIncluded: 0, storageGb: 0 };
const tier = (await q(`insert into subscription_tier(slug,name,feature_flags,quotas) values('demo-unlimited','Platinum',$1,$2) returning id`, [flags, quotas])).rows[0].id;
await q(`insert into tenant_subscription(organization_id,tier_id) values($1,$2)`, [org, tier]);
const day = 86400000, now = Date.now();
const opps = [
  ["Enterprise ITSM Modernization", "Department of Veterans Affairs", "Office of Information & Technology", "capture", 62, 21, "4500000", "6200000"],
  ["CMDB Health & Service Mapping", "U.S. Army", "PEO Enterprise", "writing", 48, 9, "2100000", "2800000"],
  ["HR Service Delivery Platform", "Department of the Navy", "NAVSEA", "qualification", 35, 40, "1800000", "2400000"],
  ["Security Operations (SecOps) Integration", "Department of Homeland Security", "CISA", "pre_proposal", 55, 28, "3200000", "3900000"],
  ["Customer Service Management Rollout", "Social Security Administration", "OCIO", "submitted", 40, -5, "5000000", "7500000"],
  ["IT Asset Management Optimization", "General Services Administration", "FAS", "won", 100, -40, "900000", "1200000"],
  ["GRC / IRM Implementation", "Department of Energy", "OCIO", "identified", 20, 60, "1500000", "2000000"],
  ["Field Service Management Pilot", "Department of Agriculture", "Forest Service", "lost", 0, -70, "600000", "800000"],
];
const ids = [];
for (const [title, agency, office, stage, pwin, dueDays, lo, hi] of opps) {
  const r = await q(`insert into opportunity(organization_id,title,agency,office,stage,p_win,response_due_date,value_low,value_high,naics_code,set_aside,owner_user_id,created_by_user_id,description)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,'541512','Small Business','demo-user','demo-user','ServiceNow platform work for the program office.') returning id`,
    [org, title, agency, office, stage, pwin, new Date(now + dueDays * day), lo, hi]);
  ids.push(r.rows[0].id);
}
const props = [[0, "VA ITSM Modernization — Technical Volume", "pink_team"], [1, "Army CMDB Health — Proposal", "draft"], [3, "CISA SecOps — Response", "red_team"], [4, "SSA CSM — Final", "submitted"]];
for (const [i, title, stage] of props) {
  const p = (await q(`insert into proposal(organization_id,opportunity_id,title,stage,proposal_manager_user_id,created_by_user_id) values($1,$2,$3,$4,'demo-user','demo-user') returning id`, [org, ids[i], title, stage])).rows[0].id;
  const secs = [["executive_summary", "Executive summary", "approved"], ["technical", "Technical approach", "in_progress"], ["management", "Management approach", "draft_complete"], ["past_performance", "Past performance", "in_review"], ["pricing", "Pricing narrative", "not_started"]];
  let o = 0;
  for (const [kind, t, status] of secs) await q(`insert into proposal_section(proposal_id,kind,title,status,ordering) values($1,$2,$3,$4,$5)`, [p, kind, t, status, o++]);
}
for (const [title, agency, type, status, i] of [["VA ITSM Modernization RFP", "Department of Veterans Affairs", "rfp", "parsed", 0], ["Army CMDB Sources Sought", "U.S. Army", "sources_sought", "parsed", 1], ["Navy HRSD RFI", "Department of the Navy", "rfi", "parsing", 2], ["DHS SecOps RFQ", "Department of Homeland Security", "rfq", "failed", 3]])
  await q(`insert into solicitation(organization_id,title,agency,type,parse_status,opportunity_id,file_name,file_size,content_type,storage_path,response_due_date) values($1,$2,$3,$4,$5,$6,$7,1048576,'application/pdf','',$8)`, [org, title, agency, type, status, ids[i], `${title}.pdf`, new Date(now + 20 * day)]);
for (const [name, agency, title, role] of [["Ana Rivera", "Department of Veterans Affairs", "Contracting Officer", "contracting_officer"], ["Bo Chen", "U.S. Army", "Program Manager", "program_manager"], ["Dee Park", "Department of the Navy", "COR", "cor"]])
  await q(`insert into customer_contact(organization_id,name,agency,agency_key,title,role,email,owner_user_id,created_by_user_id) values($1,$2,$3,lower(regexp_replace($3,'[^a-zA-Z]+',' ','g')),$4,$5,$6,'demo-user','demo-user')`, [org, name, agency, title, role, `${name.split(" ")[0].toLowerCase()}@example.gov`]);
console.log("seeded org", org);
await c.end();
