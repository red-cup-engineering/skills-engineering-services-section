#!/usr/bin/env node
import { agentSenMessage, extractSenPart, parseA2aMessage } from "@red-cup-engineering/a2a-services-section/sen-part";
import { decodeSemantic, semanticBytes, semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { termToJson } from "@red-cup-engineering/computer-data-services-section/semiotic-expression-notation/json-codec";
import {
  admitNormalizedSemanticContent,
} from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import {
  EMPTY_WITNESS_ROOT,
  identifyJsonSemanticContent,
} from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";
import { executeA2aLibraryRead } from "./a2a-library-read.mjs";
import { PROVIDER } from "./contract-gemini-notebook-audio-delivery.js";
import { executeGeminiNotebookContract } from "./contract-gemini-notebook.js";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const ROOT=resolve(fileURLToPath(new URL("..",import.meta.url)));
const RESOURCE_METERS=Object.freeze(JSON.parse(readFileSync(join(ROOT,"content/config/workspace-market.json"),"utf8")).accounting.meters);

function codeRefusal(request,code,detail){return{type:"GeminiNotebookA2ACodeArtifactResult",provider:PROVIDER,operation:request?.operationId??null,disposition:"refused",code,...(detail?{detail}:{}),externalEffects:[]};}
function codeNormalized(request){return{customer:request.customer,sources:request.sources,prompt:request.prompt,executionMode:request.executionMode,corpusMode:"ephemeral-upload",artifactType:"code",resourceBudgetAuthorization:request.resourceBudgetAuthorization};}
function codeRequestValid(request){const authorization=request?.resourceBudgetAuthorization;return request?.type==="GeminiNotebookA2ACodeArtifactOperation"&&typeof request.customer==="string"&&request.customer.startsWith("urn:")&&isNiUri(request.operationId??"")&&Array.isArray(request.sources)&&request.sources.length>0&&typeof request.prompt==="string"&&request.prompt.trim()!==""&&["dry-run","live"].includes(request.executionMode)&&authorization?.type==="ResourceBudgetAuthorization"&&typeof authorization.id==="string"&&authorization.id.startsWith("urn:")&&authorization.provider===PROVIDER&&authorization.status==="authorized"&&authorization.fixedFee===null&&authorization.markup==="0"&&authorization.monetaryConversion==="none-without-an-observed-cost-oracle"&&JSON.stringify(authorization.meters)===JSON.stringify(RESOURCE_METERS)&&request.providerRequestDigest===semanticId(codeNormalized(request));}
function validateCodeBundle(bundle){if(bundle?.format!=="json-code-bundle"||bundle.assayRequired!==true||!Array.isArray(bundle.files)||bundle.files.length===0||typeof bundle.summary!=="string")return null;const paths=new Set(),files=[];for(const row of bundle.files){if(!row||typeof row!=="object"||typeof row.path!=="string"||row.path.startsWith("/")||row.path.split(/[\\/]/u).some((part)=>part===""||part==="..")||paths.has(row.path)||typeof row.language!=="string"||typeof row.content!=="string")return null;paths.add(row.path);const bytes=Buffer.from(row.content,"utf8");files.push({path:row.path,language:row.language,byteLength:bytes.length,digest:sha256Digest(bytes)});}const canonical=JSON.stringify({format:bundle.format,files:bundle.files,summary:bundle.summary,assayRequired:bundle.assayRequired});return Object.freeze({bundleDigest:sha256Digest(canonical),files:Object.freeze(files)});}
async function executeCodeContract(request,options={}){
  if(!codeRequestValid(request))return codeRefusal(request,"invalid-code-artifact-operation");
  const sourceActivity={"@context":"https://www.w3.org/ns/activitystreams",id:`${request.operationId}:source`,type:"Create",actor:request.customer,target:PROVIDER,object:{type:"Note",content:"Use Gemini Notebook to propose code from the supplied digest-bound sources.",attachment:{type:"GeminiNotebookRequest",sources:request.sources,prompt:request.prompt,artifactType:"code",executionMode:request.executionMode,corpusMode:"ephemeral-upload"}}};
  const solicitation={"@context":"https://www.w3.org/ns/activitystreams",id:`${request.operationId}:solicitation`,type:"Offer",actor:request.customer,target:PROVIDER,object:{type:"ServiceSolicitation",demand:request.operationId,sourceActivity}};
  const runtime={instant:options.now??new Date().toISOString(),testOnlyWitness:options.testOnlyWitness};
  const offered=await executeGeminiNotebookContract("solicit-service",solicitation,runtime);
  if(offered.response.type!=="Offer")return codeRefusal(request,"code-contract-not-offered",offered.response.object?.reason??offered.response.object?.missing?.join(", "));
  const offer=offered.response,allowedActions=["invoke-service",...(offer.object.effects??[])];
  const capability={id:`${request.operationId}:capability`,type:"Capability",issuer:request.customer,holder:PROVIDER,invocationTarget:PROVIDER,parentOffer:offer.id,allowedActions,attenuation:{sourceActivity:offer.object.sourceActivity,requestDigest:offer.object.requestDigest,effects:offer.object.effects,providerScope:offer.object.scope,customerTerritoryMutation:false},capTP:{target:PROVIDER,method:"invoke-service"}};
  const invocation={"@context":"https://www.w3.org/ns/activitystreams",id:`${request.operationId}:invocation`,type:"Accept",actor:request.customer,target:PROVIDER,inReplyTo:offer.id,object:{type:"ServiceContract",contract:offer.object.contract,demand:request.operationId,offer,capability,resourceBudgetAuthorization:request.resourceBudgetAuthorization}};
  const invoked=await executeGeminiNotebookContract("invoke-service",invocation,runtime);
  if(invoked.response.type!=="Accept"||invoked.response.object?.disposition==="in-progress")return codeRefusal(request,"code-contract-refused",invoked.response.object?.reason);
  const artifact=invoked.response.object?.artifact??invoked.response.object?.providerExchange?.artifact;
  const codeBundle=request.executionMode==="live"&&artifact?.type==="code"&&typeof artifact.path==="string"?JSON.parse(readFileSync(artifact.path,"utf8")):null;
  const codeEvidence=request.executionMode==="live"?validateCodeBundle(codeBundle):null;
  if(request.executionMode==="live"&&!codeEvidence)return codeRefusal(request,"code-bundle-invalid");
  return{type:"GeminiNotebookA2ACodeArtifactResult",provider:PROVIDER,operation:request.operationId,disposition:"completed",contract:{offer:offer.id,invocation:invocation.id,result:invoked.response.id,law:offer.object.contract,requestDigest:offer.object.requestDigest},consideration:offer.object.consideration,codeBundle,codeEvidence,externalEffects:offer.object.effects??[]};
}

export async function executeGeminiNotebookA2aMessage(source,options={}){
  const message=parseA2aMessage(source),bytes=extractSenPart(message.parts).bytes;
  let term, semanticEnvelope = false;
  try {
    term = termToJson(admitNormalizedSemanticContent(bytes).envelope.settledBody);
    semanticEnvelope = true;
  } catch {
    term = decodeSemantic(bytes);
  }
  let result;
  const runtime={now:options.now??process.env.GEMINI_NOTEBOOK_NOW,witnessJournalAgentUrl:options.witnessJournalAgentUrl??process.env.WITNESS_JOURNAL_RDF_AGENT,artifactBaseUrl:options.artifactBaseUrl??process.env.GEMINI_NOTEBOOK_ARTIFACT_BASE_URL,artifactCustody:options.artifactCustody,testOnlyWitness:options.testOnlyWitness};
  if(term?.[0]==="gemini-notebook-live-question"&&term.length===2)result=await executeA2aLibraryRead("question",term[1],options);
  else if(term?.[0]==="gemini-notebook-live-studio-observation"&&term.length===2)result=await executeA2aLibraryRead("studio-observation",term[1],options);
  else if(term?.[0]==="gemini-notebook-live-studio-report-read"&&term.length===2)result=await executeA2aLibraryRead("studio-report-read",term[1],options);
  else if(term?.[0]==="gemini-notebook-code-artifact-operation"&&term.length===2)result=await executeCodeContract(term[1],runtime);
  else throw new TypeError("unsupported Gemini Notebook A2A operation");
  const response = ["gemini-notebook-operation-result",result];
  const responseBytes = semanticEnvelope
    ? identifyJsonSemanticContent({ objectKind: "gemini-notebook.a2a-operation-result", value: JSON.parse(JSON.stringify(response)), witnessRoot: EMPTY_WITNESS_ROOT }).bytes
    : semanticBytes(response);
  return agentSenMessage(responseBytes,"gemini-notebook-operation-result.sen.cbor");
}
if(import.meta.url===`file://${process.argv[1]}`){let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{input+=chunk;});process.stdin.on("end",async()=>{try{process.stdout.write(`${JSON.stringify(await executeGeminiNotebookA2aMessage(JSON.parse(input)))}\n`);}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=2;}});}
