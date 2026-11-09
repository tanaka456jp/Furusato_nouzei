"use strict";
/**
 * Read-only owner-PC v0.1.20 acceptance reconciliation.
 *
 * Combines locally recorded owner answers with an independent Google GET
 * attestation of the same immutable private v0.1.20 stage. No deployment,
 * source update, resource creation/deletion, or credentials/receipt rewrite.
 * The Google OAuth access-token request may occur in read-only diagnosis.
 *
 * This does not independently witness the iPhone, certify OCR accuracy,
 * or authorize public release / v0.1.23 acceptance.
 */
const fs=require("node:fs");
const {createHash}=require("node:crypto");
const path=require("node:path");
const ownerAudit=require("./audit-owner-ocr-evidence.cjs");
const {checkPrerequisites}=require("./diagnose-v020-isolated-stage.cjs");

function fingerprintEvidence(directory){
 const dir=fs.lstatSync(directory);
 if(!dir.isDirectory()||dir.isSymbolicLink())throw Error("EVIDENCE_DIRECTORY_UNSAFE");
 const names=fs.readdirSync(directory).filter(x=>x.startsWith("owner-ocr-")).sort();
 const hash=createHash("sha256");
 for(const name of names){
  const file=path.join(directory,name),st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>1024*1024)
   throw Error("EVIDENCE_FILE_UNSAFE");
  const content=fs.readFileSync(file);
  hash.update(String(name.length)+":"+name+":"+String(content.length)+":");
  hash.update(content);
 }
 return hash.digest("hex");
}

function evaluate({owner,remote,receiptUnchanged,evidenceUnchanged}){
 const reasons=[];
 const fail=(code,condition)=>{if(condition)reasons.push(code);};
 const ownersPass=owner?.schema==="furusato-owner-ocr-audit/v2"&&
  owner?.mode==="OFFLINE_READ_ONLY"&&owner?.candidateVersion==="v0.1.20"&&
  owner?.structuralStatus==="OWNER_ATTESTED_STRUCTURE_PASS"&&
  owner?.windows?.status==="OWNER_ATTESTED_STRUCTURE_PASS"&&
  owner?.iphone?.status==="OWNER_ATTESTED_STRUCTURE_PASS"&&
  owner?.sameRecordedSourceCommit==="YES"&&
  owner?.stageReceiptBinding==="LOCAL_RECEIPT_SHA256_AND_SOURCE_COMMIT"&&
  owner?.release==="HOLD"&&owner?.unsafeOrInvalidFiles===0;
 fail("OWNER_EVIDENCE_NOT_ATTESTED",!ownersPass);
 const stagePass=remote?.stageDirectory==="PRESENT"&&
  remote?.journal==="STRUCTURE_PASS"&&remote?.journalStep==="COMPLETE"&&
  remote?.privateReceipt==="STRUCTURE_PASS"&&
  remote?.preflight==="PASS_READONLY"&&remote?.failedAt==="NONE"&&
  remote?.existingStage==="NOT_RECREATED"&&
  remote?.authorization==="NO_CREATION_FROM_DIAGNOSTIC"&&
  remote?.candidateVersion==="v0.1.20"&&remote?.oldVersion==="v0.1.17"&&
  remote?.release==="HOLD";
 fail("STAGE_LOCAL_OR_PROTECTED_ENV_UNVERIFIED",!stagePass);
 const deployed=remote?.remote;
 const deployedPass=deployed?.resume==="OWNER_ACCEPTANCE_READY"&&
  deployed?.stageSheetCount===1&&
  deployed?.inventoryScope==="DEDICATED_OAUTH_USER_CORPUS_INCLUDING_TRASH"&&
  deployed?.sheetIdentity==="PASS"&&
  deployed?.projectIdentity==="PASS"&&
  deployed?.projectSource==="PASS"&&
  deployed?.immutableVersion==="PASS"&&
  deployed?.privateDeployment==="PASS";
 fail("REMOTE_IMMUTABLE_PRIVATE_STAGE_UNVERIFIED",!deployedPass);
 const drive=remote?.drive;
 const cleanupPass=drive?.status==="PASS"&&
  drive?.temporaryOcrFiles===0&&
  Number.isSafeInteger(drive?.pages)&&drive.pages>0&&
  drive?.coverage==="FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY";
 fail("DEDICATED_OAUTH_DRIVE_CLEANUP_UNVERIFIED",!cleanupPass);
 fail("STAGE_RECEIPT_CHANGED_DURING_AUDIT",receiptUnchanged!==true);
 fail("OWNER_EVIDENCE_CHANGED_DURING_AUDIT",evidenceUnchanged!==true);
 return {
  schema:"furusato-v020-owner-readonly-gate/v1",
  release:"HOLD",pr:"DRAFT",version:"v0.1.20",
  status:reasons.length?"HOLD":"LIMITED_V020_OWNER_EVIDENCE_AND_GOOGLE_GET_PASS",
  reasons,
  ownerAnswers:ownersPass?"RECORDED_PASS":"HOLD",
  privateImmutableDeployment:deployedPass?"READONLY_VERIFIED":"HOLD",
  protectedEnvironment:stagePass?"READONLY_VERIFIED":"HOLD",
  dedicatedOAuthTemporaryFiles:cleanupPass?"ZERO_WITHIN_SCOPE":"HOLD",
  iphonePhysicalObservation:"OWNER_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
  independentOcrAccuracy:"NOT_VERIFIED",
  independentDeletionOutsideOauthScope:"NOT_VERIFIED",
  v023SameVersionGoogleAcceptance:"NOT_TESTED",
  googleWrites:"NONE_FROM_THIS_GATE"
 };
}

async function main(){
 if(process.platform!=="win32"||process.env.CI||
    process.argv.length!==3||process.argv[2]!=="--verify-readonly")
  throw Error("OWNER_WINDOWS_READONLY_ONLY");
 const before=ownerAudit.readStageContext();
 const fpBefore=fingerprintEvidence(ownerAudit.stageEvidenceDir);
 const evidence=ownerAudit.loadRecords(ownerAudit.stageEvidenceDir);
 const owner=ownerAudit.summarizeRecords(evidence.records,evidence.rejected,before);
 // Independent GET of old protected and isolated fixed versions + Drive scope.
 const remote=await checkPrerequisites({reconcile:true});
 const after=ownerAudit.readStageContext();
 const fpAfter=fingerprintEvidence(ownerAudit.stageEvidenceDir);
 const result=evaluate({
  owner,remote,
  receiptUnchanged:before.receiptFingerprint===after.receiptFingerprint&&
   before.sourceCommit===after.sourceCommit,
  evidenceUnchanged:fpBefore===fpAfter
 });
 console.log(JSON.stringify(result));
 if(result.status!=="LIMITED_V020_OWNER_EVIDENCE_AND_GOOGLE_GET_PASS")process.exitCode=2;
}
module.exports={evaluate,fingerprintEvidence};
if(require.main===module)main().catch(()=>{
 // No raw Google exceptions, private filesystem paths, receipt, URL or hash.
 console.error("V020_OWNER_READONLY_GATE_HOLD: UNVERIFIED_LOCAL_OR_GOOGLE_STATUS; RELEASE=HOLD");
 process.exitCode=2;
});
