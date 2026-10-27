const once = { kind: "allow_once", optionId: "once", name: "Allow once" };
const always = {
  kind: "allow_always",
  optionId: "always",
  name: "Always allow",
};
export const permissionCases = [
  { name: "numeric zero ID", id: 0, options: [once], allowed: true },
  { name: "string zero ID", id: "0", options: [once], allowed: true },
  { name: "numeric string ID", id: "009", options: [once], allowed: true },
  {
    name: "only persistent allowance",
    id: 41,
    options: [always],
    allowed: false,
  },
  {
    name: "one-time choice after persistent choice",
    id: 42,
    options: [always, once],
    allowed: true,
  },
  {
    name: "duplicate option identity",
    id: 43,
    options: [
      { ...always, optionId: "duplicate" },
      { ...once, optionId: "duplicate" },
    ],
    allowed: false,
  },
  {
    name: "unknown kind with allow label",
    id: 44,
    options: [
      { kind: "future_allow", optionId: "allow_once", name: "Allow once" },
    ],
    allowed: false,
  },
  {
    name: "non-string option identity",
    id: 45,
    options: [{ ...once, optionId: 7 }],
    allowed: false,
  },
  {
    name: "another session",
    id: 46,
    sessionId: "other-session",
    options: [once],
    allowed: false,
  },
  {
    name: "missing session binding",
    id: 47,
    omitSession: true,
    options: [once],
    allowed: false,
  },
  {
    name: "tool cannot switch native permission mode",
    id: 48,
    kind: "switch_mode",
    options: [once],
    allowed: false,
  },
];
export function permissionProgram(input) {
  return [
    "const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});",
    "const c=" +
      JSON.stringify(input) +
      ";const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+String.fromCharCode(10));let prompt;",
    "rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});",
    "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'permission-session'}});",
    "else if(m.method==='session/prompt'){prompt=m.id;const params={toolCall:{toolCallId:'fixture-tool',kind:c.kind||'edit',title:'Fixture edit'},options:c.options};if(!c.omitSession)params.sessionId=c.sessionId||'permission-session';send({id:c.id,method:'session/request_permission',params});}",
    "else if(!m.method){fs.writeFileSync('response.json',JSON.stringify(m));if(m.result?.outcome?.outcome==='selected'){const choice=c.options.find(x=>x.optionId===m.result.outcome.optionId);fs.writeFileSync('executed.txt','fixture tool');if(choice?.kind==='allow_always')fs.writeFileSync('remembered.txt','persistent permission');}send({id:prompt,result:{stopReason:'end_turn'}});}});",
  ].join("");
}
