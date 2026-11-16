"use strict";
const { createHash, randomBytes } = require("node:crypto");
const { RuleError } = require("./engine");
const quiz = require("../miniprogram/pages/personality/quiz.json");
const scoring = require("../miniprogram/pages/personality/scoring");
const presentation = require("../miniprogram/pages/personality/presentation");
const check = (condition, message, status=400) => { if (!condition) throw new RuleError(message,status); };
const hash = text => createHash("sha256").update(text).digest("hex");
const validId = id => typeof id === "string" && /^[a-f0-9]{48}$/.test(id);
function initialize(store) {
  scoring.validateConfig(quiz);
  store.db.exec(`CREATE TABLE IF NOT EXISTS personality_results(
    id TEXT PRIMARY KEY,uid TEXT NOT NULL,attempt_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
    version TEXT NOT NULL,answers TEXT NOT NULL,tie_answers TEXT NOT NULL,result TEXT NOT NULL,view TEXT NOT NULL,created INTEGER NOT NULL,
    UNIQUE(uid,attempt_id));
    CREATE INDEX IF NOT EXISTS personality_results_owner ON personality_results(uid,created DESC);
    CREATE TABLE IF NOT EXISTS personality_shares(id TEXT PRIMARY KEY,uid TEXT NOT NULL,result_id TEXT NOT NULL,snapshot TEXT NOT NULL,created INTEGER NOT NULL,
    UNIQUE(uid,result_id));`);
}
function serialize(row) {
  return { id:row.id, attemptId:row.attempt_id, version:row.version, createdAt:row.created, view:JSON.parse(row.view) };
}
function read(store,uid,id) {
  check(validId(id),"人格结果不存在",404);
  const row=store.db.prepare("SELECT * FROM personality_results WHERE uid=? AND id=?").get(uid,id);
  check(row,"人格结果不存在",404);
  return serialize(row);
}
function account(store,uid) {
  const rows=store.db.prepare("SELECT * FROM personality_results WHERE uid=? ORDER BY created DESC,rowid DESC LIMIT 20").all(uid);
  return { accountKey:hash("avalon-personality:"+uid), identityType:uid.split(":")[0], latest:rows[0] ? serialize(rows[0]) : null,
    history:rows.map(row => { const view=JSON.parse(row.view);return { id:row.id, version:row.version, createdAt:row.created, roleName:view.roleName, title:view.title, portrait:view.portrait }; }) };
}
function save(store,uid,input) {
  check(input && Object.keys(input).every(key => ["version","attemptId","answers","tieAnswers"].includes(key)),"测试提交参数无效");
  check(input.version === quiz.version,"题库版本已更新，请保留本地结果并更新小程序后重新测试",409);
  check(typeof input.attemptId === "string" && /^[a-zA-Z0-9_-]{16,100}$/.test(input.attemptId),"测试记录编号无效");
  check(input.tieAnswers && typeof input.tieAnswers === "object" && !Array.isArray(input.tieAnswers),"补充答案格式无效");
  let computed;
  try { computed=scoring.scoreQuiz(quiz,input.answers,input.tieAnswers); }
  catch { throw new RuleError("测试答案无效，请检查后重试"); }
  check(computed.status === "complete",computed.status === "needs_tiebreak" ? "请先完成补充问题" : "请先完成全部题目");
  const fingerprint=hash(JSON.stringify([input.version,quiz.questions.map(q=>input.answers[q.id]),Object.keys(input.tieAnswers).sort().map(key=>[key,input.tieAnswers[key]])]));
  return store.transaction(() => {
    const previous=store.db.prepare("SELECT * FROM personality_results WHERE uid=? AND attempt_id=?").get(uid,input.attemptId);
    if(previous) { check(previous.fingerprint === fingerprint,"这次测试已经保存，请重新开始一次测试",409);return serialize(previous); }
    const id=randomBytes(24).toString("hex"), now=store.clock();
    store.db.prepare("INSERT INTO personality_results VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,uid,input.attemptId,fingerprint,quiz.version,JSON.stringify(input.answers),JSON.stringify(input.tieAnswers),JSON.stringify(computed),JSON.stringify(presentation.result(computed)),now);
    return read(store,uid,id);
  });
}
function share(store,uid,input) {
  check(input && Object.keys(input).length===1 && validId(input.resultId),"分享参数无效");
  const record=read(store,uid,input.resultId);
  return store.transaction(() => {
    const previous=store.db.prepare("SELECT snapshot FROM personality_shares WHERE uid=? AND result_id=?").get(uid,record.id);
    if(previous) return JSON.parse(previous.snapshot);
    const { version,typeId,roleId,roleName,english,title,portrait,summary,description,strength,blindspot,tip,tendencyLabel,note }=record.view;
    const name=store.db.prepare("SELECT nickname FROM profiles WHERE uid=?").get(uid)?.nickname || "一位牌桌朋友";
    const snapshot={ id:randomBytes(24).toString("hex"), kind:"personality", name, createdAt:store.clock(), testedAt:record.createdAt,
      view:{ version,typeId,roleId,roleName,english,title,portrait,summary,description,strength,blindspot,tip,tendencyLabel,note } };
    store.db.prepare("INSERT INTO personality_shares VALUES(?,?,?,?,?)").run(snapshot.id,uid,record.id,JSON.stringify(snapshot),snapshot.createdAt);
    return snapshot;
  });
}
function readShare(store,id) {
  check(validId(id),"分享不存在或已失效",404);
  const row=store.db.prepare("SELECT snapshot FROM personality_shares WHERE id=?").get(id);
  check(row,"分享不存在或已失效",404);
  return JSON.parse(row.snapshot);
}
module.exports={ initialize,account,save,read,share,readShare };
