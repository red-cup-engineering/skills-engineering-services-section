import test from 'node:test';
import assert from 'node:assert/strict';
import {flowTextVideoOptions,planFlowTextVideoShot,planFlowReferencedSceneTrial} from '../src/flow-scene-plan.mjs';
const observed=()=>[
  {key:'veo_3_1_t2v_lite',medium:'video',credits:10,seconds:8},
  {key:'veo_3_1_t2v_fast',medium:'video',credits:20,seconds:8},
  {key:'veo_3_1_t2v_fast_portrait',medium:'video',credits:20,seconds:8},
  {key:'abra_t2v_4s_360p',medium:'video',credits:4,seconds:4},
  {key:'GEM_PIX_2',medium:'image',credits:0},
  {key:'veo_3_1_r2v_fast_portrait',medium:'video',credits:20,seconds:8}
];
const shot={id:'shot-one',prompt:'Original synthetic corridor figure crosses a rotating threshold.',
  minSeconds:5,sourceRef:'reviewed-script:sha256:example'};
const args=()=>({catalog:observed(),shot,consumer:'causeway-public-fiction',
  destination:'fiction-production-custody',maxCredits:18,aspect:'9:16'});
test('catalog senses only observable text-to-video models and portrait keys',()=>{
  const models=flowTextVideoOptions(observed());
  assert.deepEqual(models.map(x=>x.model),[
    'abra_t2v_4s_360p','veo_3_1_t2v_lite','veo_3_1_t2v_fast','veo_3_1_t2v_fast_portrait'
  ]);
  assert.equal(models[1].creditsUnit,'flow-credit');
  assert.equal(models[1].referenceImagesSupported,false);
  const missing=observed().filter(x=>x.key!=='veo_3_1_t2v_fast_portrait');
  assert.equal(flowTextVideoOptions(missing).some(x=>x.model==='veo_3_1_t2v_fast'),false);
});
test('selects available clip length, charges observed credits, and remains unsubmitted',()=>{
  const plan=planFlowTextVideoShot(args());
  assert.equal(plan.status,'PROPOSED_NOT_ADMITTED');
  assert.equal(plan.preview.model,'veo_3_1_t2v_lite');
  assert.equal(plan.preview.aspect,'9:16');
  assert.equal(plan.preview.allocation,undefined);
  assert.equal(plan.estimate.units,10);
  assert.equal(plan.estimate.billableSeconds,8);
  assert.equal(plan.estimate.unusedSeconds,3);
  assert.ok(plan.caveats.includes('no-credit-hold-or-provider-invocation'));
});
test('keeps failures distinguishable instead of silently assuming free clips',()=>{
  assert.equal(planFlowTextVideoShot({...args(),maxCredits:4}).status,'HELD_CREDIT_CEILING');
  assert.equal(planFlowTextVideoShot({...args(),shot:{...shot,minSeconds:9}}).status,'HELD_NO_SUPPORTED_DURATION');
  const missing=observed().map(x=>({...x,seconds:null}));
  assert.equal(planFlowTextVideoShot({...args(),catalog:missing}).status,'HELD_NO_SUPPORTED_DURATION');
  assert.throws(()=>planFlowTextVideoShot({...args(),maxCredits:-1}),/maximum credits/u);
});
test('reference-conditioned shots refuse unsupported wire execution without losing identity',()=>{
  for(const mod of [{requiresIdentityLock:true},{referenceImages:['canon:figure']}]) {
    const result=planFlowTextVideoShot({...args(),shot:{...shot,...mod}});
    assert.equal(result.status,'HELD_UNSUPPORTED_REFERENCE_CONDITIONING');
    assert.equal(result.shotId,shot.id);
    assert.equal(result.preview,undefined);
  }
});
test('independent catalog order and untrusted choices cannot invent prices',()=>{
  assert.deepEqual(flowTextVideoOptions([...observed()].reverse()).map(x=>x.model),
    flowTextVideoOptions(observed()).map(x=>x.model));
  assert.equal(flowTextVideoOptions([{key:'veo_3_1_t2v_lite',medium:'video',credits:undefined,seconds:8}]).length,0);
});


const referenceTrial=()=>({
  sourceRef:'sha256:'+('a'.repeat(64)),
  consumer:'causeway-public-fiction',
  destination:'source-owned-cinematic-trial-custody',
  aspect:'9:16',maxCredits:25,
  referenceImages:[
    {kind:'character',label:'rill',identity:'ni:///sha-256;'+('A'.repeat(43))},
    {kind:'character',label:'kip',identity:'ni:///sha-256;'+('B'.repeat(43))},
    {kind:'environment',label:'sponge-temple',identity:'ni:///sha-256;'+('C'.repeat(43))}
  ],
  shots:[
    {id:'rill-wakes',seconds:8,prompt:'Rill has three left claws in a luminous silica temple; Kip approaches in panic.'},
    {id:'kip-replies',seconds:8,prompt:'Reverse angle: Rill holds the same three claws toward Kip; the living temple reacts.'}
  ],
  catalog:[
    {key:'veo_3_1_r2v_lite',medium:'video',credits:10,seconds:8},
    {key:'veo_3_1_r2v_fast_portrait',medium:'video',credits:20,seconds:8},
    {key:'veo_3_1_r2v_fast_landscape',medium:'video',credits:20,seconds:8},
    {key:'abra_r2v_8s',medium:'video',credits:12,seconds:8},
    {key:'abra_r2v_8s_360p',medium:'video',credits:6,seconds:8},
    {key:'veo_3_1_t2v_lite',medium:'video',credits:10,seconds:8},
    {key:'veo_3_1_r2v_quality',medium:'video',credits:100,seconds:8}
  ]
});

test('Cinematic Flow reference trial prices two character-continuity shots using observed catalog only',()=>{
 const trial=planFlowReferencedSceneTrial(referenceTrial());
 assert.equal(trial.status,'PREPARED_FLOW_UI_HANDOFF_NOT_SUBMITTED');
 assert.equal(trial.candidates.length,4);
 assert.equal(trial.cheapestFeasible.modelKey,'abra_r2v_8s_360p');
 assert.equal(trial.cheapestFeasible.totalCredits,12);
 assert.equal(trial.cheapestFeasible.referenceResolution,'360p');
 assert.equal(trial.candidates.find(x=>x.modelKey==='veo_3_1_r2v_lite').totalCredits,20);
 assert.ok(trial.candidates.every(c=>c.automatedWireSupport===false));
 assert.deepEqual(trial.references.map(x=>x.label),['rill','kip','sponge-temple']);
 assert.equal(trial.shots.length,2);
 assert.match(trial.manualReceiver,/existing Flow media custody path/u);
 assert.equal(trial.shots[0].prompt,referenceTrial().shots[0].prompt);
});
test('No evidence of signed-in Flow models, input reference images or adequate credits fails closed',()=>{
 const initial=referenceTrial();
 assert.equal(planFlowReferencedSceneTrial({...initial,catalog:[]}).status,'HELD_NO_OBSERVED_UI_MODEL');
 assert.equal(planFlowReferencedSceneTrial({...initial,maxCredits:5}).status,'HELD_CREDIT_CEILING');
 assert.equal(planFlowReferencedSceneTrial({...initial,referenceImages:[]}).status,'HELD_MISSING_OR_TOO_MANY_REFERENCES');
 assert.equal(planFlowReferencedSceneTrial({...initial,referenceImages:[...initial.referenceImages,...initial.referenceImages]}).status,'HELD_MISSING_OR_TOO_MANY_REFERENCES');
 assert.throws(()=>planFlowReferencedSceneTrial({...initial,sourceRef:'latest-file'}),/exact sha256/u);
 assert.throws(()=>planFlowReferencedSceneTrial({...initial,referenceImages:[{kind:'character',label:'rill',identity:'not-hashed'}]}),/content-addressed NI/u);
 assert.throws(()=>planFlowReferencedSceneTrial({...initial,referenceImages:[initial.referenceImages[0],initial.referenceImages[0]]}),/unique/u);
 assert.throws(()=>planFlowReferencedSceneTrial({...initial,shots:[initial.shots[0],initial.shots[0]]}),/distinct lowercase/u);
 assert.throws(()=>planFlowReferencedSceneTrial({...initial,shots:[{...initial.shots[0],seconds:5}]}),/4\/6\/8\/10/u);
});
test('Do not confuse old text-video wire capability with UI-only reference footage or same-credit-resolution performance',()=>{
 const args=referenceTrial();
 const p=planFlowReferencedSceneTrial({...args,catalog:[...args.catalog].reverse()});
 assert.deepEqual(p.candidates.map(x=>x.modelKey),
   planFlowReferencedSceneTrial(args).candidates.map(x=>x.modelKey));
 assert.ok(p.candidates.every(x=>x.modelKey.includes('_r2v_')));
 assert.equal(p.candidates.find(x=>x.modelKey==='abra_r2v_8s').referenceResolution,'720p');
 assert.equal(p.candidates.find(x=>x.modelKey==='abra_r2v_8s_360p').referenceResolution,'360p');
 assert.ok(!p.candidates.some(x=>x.modelKey.includes('_t2v_')));
 assert.ok(!p.candidates.some(x=>x.modelKey.includes('quality')));
 const six=planFlowReferencedSceneTrial({...args,shots:[{id:'short',seconds:6,prompt:'original short'}]});
 assert.equal(six.status,'HELD_NO_OBSERVED_UI_MODEL');
});
