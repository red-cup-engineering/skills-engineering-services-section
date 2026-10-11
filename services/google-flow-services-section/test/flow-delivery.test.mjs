import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { admitOrder, flowMediaInventory, flowMediaOffer, queueFlowOrder, queueFlowOrderOnce, recordFlowDelivery } from '../src/flow-generate.mjs';

test('Flow orders preserve an admitted MediaNeed and intended destination', () => {
  const [line] = admitOrder(JSON.stringify([{
    consumer: 'koios-news',
    mediaNeed: 'urn:media-need:koios:oracle-bone-short',
    destination: 'koios.news article oracle-bone-ai',
    allocation: 'media-allocation-1',
    purpose: 'short-form-discovery',
    medium: 'video',
    prompt: 'A bounded visual sequence grounded in the accepted article.',
    model: 'veo_3_1_t2v_lite',
    aspect: '9:16',
    count: 1,
  }]));
  assert.equal(line.consumer, 'koios-news');
  assert.equal(line.mediaNeed, 'urn:media-need:koios:oracle-bone-short');
  assert.equal(line.destination, 'koios.news article oracle-bone-ai');
  assert.equal(line.allocation, 'media-allocation-1');
  assert.equal(line.purpose, 'short-form-discovery');
  assert.throws(() => admitOrder(JSON.stringify([{
    consumer: 'koios-news', mediaNeed: '', destination: 'koios.news',
    medium: 'video', prompt: 'x', model: 'veo_3_1_t2v_lite',
  }])), /mediaNeed/u);
});

test('Flow inventory distinguishes generated, delivered, and public-use custody', t => {
  const state = mkdtempSync(join(tmpdir(), 'flow-delivery-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const completionId = 'ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  writeFileSync(join(state, 'generations.jsonl'), `${JSON.stringify({
    id: completionId,
    type: 'MediaArtifactWorkCompletion',
    workLot: 'urn:media-need:koios:oracle-bone-short',
    output: { identity: 'ni:///sha-256;BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', mimeType: 'video/mp4' },
    providerArtifactId: 'flow-media-1',
    consumer: 'koios-news',
    mediaNeed: 'urn:media-need:koios:oracle-bone-short',
    destination: 'koios.news article oracle-bone-ai',
    allocation: 'media-allocation-1',
    purpose: 'short-form-discovery',
    resource: { path: '/state/media/example.mp4' },
    recordedAt: '2026-10-04T16:00:00.000Z',
  })}\n`);

  let inventory = flowMediaInventory({ state });
  assert.deepEqual(inventory.counts, { pending: 0, generated: 1, delivered: 0, publicUse: 0, undelivered: 1 });
  assert.equal(inventory.artifacts[0].custody, 'generated');
  assert.equal(inventory.artifacts[0].allocation, 'media-allocation-1');
  assert.equal(inventory.artifacts[0].purpose, 'short-form-discovery');

  const delivered = recordFlowDelivery({
    completionId,
    consumer: 'koios-news',
    destination: 'koios.news article oracle-bone-ai',
    stage: 'delivered',
    at: '2026-10-04T16:10:00.000Z',
  }, { state });
  assert.equal(delivered.type, 'MediaArtifactDeliveryReceipt');
  assert.equal(delivered.allocation, 'media-allocation-1');
  assert.equal(delivered.purpose, 'short-form-discovery');

  inventory = flowMediaInventory({ state });
  assert.deepEqual(inventory.counts, { pending: 0, generated: 1, delivered: 1, publicUse: 0, undelivered: 0 });
  assert.equal(inventory.artifacts[0].delivery.id, delivered.id);

  const publicUse = recordFlowDelivery({
    completionId,
    consumer: 'koios-news',
    destination: 'koios.news article oracle-bone-ai',
    stage: 'public-use',
    publicAddress: 'https://koios.news/oracle-bone-ai',
    at: '2026-10-04T16:20:00.000Z',
  }, { state });
  inventory = flowMediaInventory({ state });
  assert.deepEqual(inventory.counts, { pending: 0, generated: 1, delivered: 0, publicUse: 1, undelivered: 0 });
  assert.equal(inventory.artifacts[0].delivery.id, publicUse.id);
  assert.equal(inventory.artifacts[0].delivery.publicAddress, 'https://koios.news/oracle-bone-ai');

  assert.throws(() => recordFlowDelivery({
    completionId, consumer: 'koios-news', destination: 'somewhere else',
  }, { state }), /destination differs/u);
  assert.throws(() => recordFlowDelivery({
    completionId, consumer: 'koios-news', destination: 'koios.news article oracle-bone-ai', stage: 'public-use',
  }, { state }), /requires publicAddress/u);

  const lines = readFileSync(join(state, 'deliveries.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
});


test('queueFlowOrderOnce refuses duplicate CMO allocation ids already pending', t => {
  const state = mkdtempSync(join(tmpdir(), 'flow-once-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const line = {
    consumer: 'koios-news-services-section',
    mediaNeed: 'ni:///sha-256;need',
    destination: 'https://bsky.app/profile/koiosnews.bsky.social',
    allocation: 'ni:///sha-256;allocation-1',
    purpose: 'social-outbound',
    medium: 'image',
    prompt: 'Royal-blue abstract editorial companion.',
    model: 'GEM_PIX_2',
    aspect: '16:9',
    count: 1,
  };
  const first = queueFlowOrderOnce([line], { state, name: 'koios-social', now: new Date('2026-10-04T18:30:00Z') });
  assert.equal(first.queued, 1);
  const second = queueFlowOrderOnce([line], { state, name: 'koios-social', now: new Date('2026-10-04T18:31:00Z') });
  assert.equal(second.queued, 0);
  assert.deepEqual(second.duplicates, ['ni:///sha-256;allocation-1']);
  const inventory = flowMediaInventory({ state });
  assert.equal(inventory.pendingOrders[0].allocation, 'ni:///sha-256;allocation-1');
  assert.equal(inventory.pendingOrders[0].purpose, 'social-outbound');
});


test('Flow exposes a provider-neutral current zero-credit image offer from its live catalog shape', async () => {
  const offer = await flowMediaOffer({
    config: { tier: 2, account: 'urn:ame:test-flow' },
    open: async () => ({
      async credits() { return { balance: 1050, renewsAt: '2026-11-03T07:00:00.000Z' }; },
      async models() {
        return [
          { key: 'veo_3_1_t2v_lite', medium: 'video', credits: 10 },
          { key: 'GEM_PIX_3', medium: 'image', credits: 0 },
          { key: 'GEM_PIX_2', medium: 'image', credits: 0 },
        ];
      },
    }),
  });
  assert.equal(offer.provider, 'urn:ame:google-flow');
  assert.equal(offer.balance, 1050);
  assert.equal(offer.capabilities['image-generation'].units, 0);
  assert.equal(offer.capabilities['image-generation'].model, 'GEM_PIX_2');
  assert.deepEqual(offer.capabilities['image-generation'].supportedAspects, ['1:1', '9:16', '16:9', '3:4', '4:3']);
});

test('Flow does not advertise provider-neutral image generation when the current catalog has no free image model', async () => {
  const offer = await flowMediaOffer({
    config: { tier: 2, account: 'urn:ame:test-flow' },
    open: async () => ({
      async credits() { return { balance: 40, renewsAt: '2026-11-03T07:00:00.000Z' }; },
      async models() { return [{ key: 'veo_3_1_t2v_lite', medium: 'video', credits: 10 }]; },
    }),
  });
  assert.deepEqual(offer.capabilities, {});
});
