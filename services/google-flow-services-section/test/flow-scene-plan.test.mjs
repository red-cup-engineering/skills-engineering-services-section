import test from 'node:test';
import assert from 'node:assert/strict';
import {flowTextVideoOptions,planFlowTextVideoShot} from '../src/flow-scene-plan.mjs';
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
