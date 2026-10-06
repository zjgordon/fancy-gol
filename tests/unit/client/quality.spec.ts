/**
 * P3-D-4 — the degrade governor, wired into the client.
 *
 * The behaviour under test is the wiring's three promises: the compositor gets a governor that
 * actually drives its registry, `?test=1` pins quality so the 48 committed visual baselines
 * stay machine-independent, and degradation is announced once in plain language rather than
 * silently or every 100 ms.
 */
import { describe, expect, it } from 'vitest';
import { attachDegradeGovernor, createDegradeNotifier, pinQuality, qualityIndicatorText, unpinQuality, type QualityHost } from '@client/quality';
import { EffectRegistry } from '@render/effects/registry';
import type { EffectPass, EffectStage } from '@render/effects/pass';
import type { QualityGovernor } from '@render/quality-governor';

function stubPass(id: string, stage: EffectStage, cost: number): EffectPass {
  return { id, cost, stage, render() {}, dispose() {} };
}

/** Minimal `QualityHost` — the two Compositor methods the governor needs. */
function host(): { host: QualityHost; governor: () => QualityGovernor | null } {
  let governor: QualityGovernor | null = null;
  return {
    host: {
      setQualityGovernor: (g) => {
        governor = g;
      },
      getQualityGovernor: () => governor,
    },
    governor: () => governor,
  };
}

describe('attachDegradeGovernor', () => {
  it('installs a governor on the host and starts at the theme ceiling', () => {
    const registry = new EffectRegistry({ quality: 3 });
    const h = host();
    const governor = attachDegradeGovernor(h.host, { registry });
    expect(h.governor()).toBe(governor);
    expect(governor.getQuality()).toBe(3);
    expect(governor.isPinned()).toBe(false);
    expect(registry.getQuality()).toBe(3);
  });

  it('honours a lower theme ceiling', () => {
    const registry = new EffectRegistry({ quality: 3 });
    const governor = attachDegradeGovernor(host().host, { registry, maxQuality: 2 });
    expect(governor.getMaxQuality()).toBe(2);
    expect(governor.getQuality()).toBe(2);
  });

  it('pins at the ceiling in test mode so screenshots cannot depend on machine speed', () => {
    const registry = new EffectRegistry({ quality: 3 });
    const governor = attachDegradeGovernor(host().host, { registry, testMode: true });
    expect(governor.isPinned()).toBe(true);
    // A slow frame must not move quality while pinned — that is the whole point of the pin.
    for (let i = 0; i < 60; i++) governor.observeFrame(120);
    expect(governor.getQuality()).toBe(3);
    expect(registry.getQuality()).toBe(3);
  });

  it('drives the registry when it degrades: post drops first, then effects, then background', () => {
    const registry = new EffectRegistry({ quality: 3 });
    const governor = attachDegradeGovernor(host().host, { registry });
    const passes = [stubPass('bloom', 'post', 2), stubPass('trailFade', 'effects', 1), stubPass('starfield', 'background', 1)];
    registry.setPasses(passes);
    for (let i = 0; i < 30; i++) governor.observeFrame(40);
    expect(governor.getQuality()).toBe(2);
    expect(registry.getQuality()).toBe(2);
    expect(registry.totalDeclaredCost()).toBe(2); // post's bloom is no longer counted
  });
});

describe('pinQuality / unpinQuality', () => {
  it('freezes and releases automatic changes, and tolerates a missing governor', () => {
    const registry = new EffectRegistry({ quality: 3 });
    const governor = attachDegradeGovernor(host().host, { registry });
    pinQuality(governor, 1);
    expect(governor.getQuality()).toBe(1);
    expect(registry.getQuality()).toBe(1);
    for (let i = 0; i < 60; i++) governor.observeFrame(90);
    expect(governor.getQuality()).toBe(1);
    unpinQuality(governor);
    expect(governor.isPinned()).toBe(false);
    // No governor (a host that never attached one) must be a silent no-op, not a throw.
    expect(() => pinQuality(null, 2)).not.toThrow();
    expect(() => unpinQuality(null)).not.toThrow();
  });
});

describe('qualityIndicatorText', () => {
  it('is empty at full quality and names the dropped passes when reduced', () => {
    const registry = new EffectRegistry({ quality: 3 });
    const h = host();
    const governor = attachDegradeGovernor(h.host, { registry });
    registry.setPasses([stubPass('bloom', 'post', 2), stubPass('starfield', 'background', 1)]);
    expect(qualityIndicatorText(h.host)).toBe('');
    for (let i = 0; i < 30; i++) governor.observeFrame(40);
    const text = qualityIndicatorText(h.host);
    expect(text).toMatch(/reduced/);
    expect(text).toMatch(/bloom/);
  });

  it('keeps an approximation label out of the toast, but in the governor copy (ADR-012 D3)', () => {
    const registry = new EffectRegistry({ quality: 3 });
    const h = host();
    const governor = attachDegradeGovernor(h.host, { registry });
    const crt: EffectPass = { ...stubPass('crtCurvature', 'post', 2), approximation: 'CRT corners drawn as a mask' };
    registry.setPasses([crt]);
    expect(governor.indicatorText()).toBe(
      'effects at full quality — approximated: crtCurvature: CRT corners drawn as a mask',
    );
    expect(qualityIndicatorText(h.host)).toBe(''); // a standing fact, not a degradation: no toast
  });

  it('is empty when the host has no governor at all', () => {
    expect(qualityIndicatorText(host().host)).toBe('');
  });
});

describe('createDegradeNotifier', () => {
  it('says nothing while quality is full', () => {
    const messages: string[] = [];
    const registry = new EffectRegistry({ quality: 3 });
    const h = host();
    attachDegradeGovernor(h.host, { registry });
    const notifier = createDegradeNotifier(h.host, (m) => messages.push(m));
    for (let i = 0; i < 5; i++) notifier.check();
    expect(messages).toEqual([]);
    expect(notifier.announced).toBe(false);
  });

  it('announces the first degradation once, however often the tick asks', () => {
    const messages: string[] = [];
    const registry = new EffectRegistry({ quality: 3 });
    const h = host();
    const governor = attachDegradeGovernor(h.host, { registry });
    registry.setPasses([stubPass('bloom', 'post', 2)]);
    const notifier = createDegradeNotifier(h.host, (m) => messages.push(m));
    for (let i = 0; i < 30; i++) governor.observeFrame(40);
    for (let i = 0; i < 50; i++) notifier.check();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/bloom/);
    expect(notifier.announced).toBe(true);
  });

  it('reset() re-arms the announcement, so a new theme announces its own first downgrade', () => {
    const messages: string[] = [];
    const registry = new EffectRegistry({ quality: 3 });
    const h = host();
    const governor = attachDegradeGovernor(h.host, { registry });
    registry.setPasses([stubPass('bloom', 'post', 2)]);
    const notifier = createDegradeNotifier(h.host, (m) => messages.push(m));
    for (let i = 0; i < 30; i++) governor.observeFrame(40);
    notifier.check();
    notifier.check();
    notifier.reset();
    expect(notifier.announced).toBe(false);
    notifier.check();
    expect(messages).toHaveLength(2);
  });

  it('stays quiet when a governor is pinned at the ceiling', () => {
    const messages: string[] = [];
    const registry = new EffectRegistry({ quality: 3 });
    const h = host();
    const governor = attachDegradeGovernor(h.host, { registry, testMode: true });
    registry.setPasses([stubPass('bloom', 'post', 2)]);
    const notifier = createDegradeNotifier(h.host, (m) => messages.push(m));
    for (let i = 0; i < 60; i++) governor.observeFrame(120);
    notifier.check();
    expect(messages).toEqual([]);
    expect(qualityIndicatorText(h.host)).toBe('');
  });
});

describe('a theme change hands the governor a new ceiling', () => {
  it('raises and lowers maxQuality without losing the pinned state', () => {
    const registry = new EffectRegistry({ quality: 3 });
    const governor = attachDegradeGovernor(host().host, { registry });
    governor.setMaxQuality(2);
    expect(governor.getQuality()).toBe(2);
    expect(governor.getMaxQuality()).toBe(2);
    governor.setMaxQuality(3);
    expect(governor.getMaxQuality()).toBe(3);
    // Unpinned, the ceiling does not force quality back up — that is the frame-time policy's job.
    expect(governor.getQuality()).toBe(2);

    const pinned = attachDegradeGovernor(host().host, { registry, testMode: true });
    pinned.setMaxQuality(1);
    expect(pinned.getQuality()).toBe(1);
    expect(pinned.isPinned()).toBe(true);
  });
});