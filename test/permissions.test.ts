// Tests for src/core/permissions.ts: resolveEffect, EFFECTS/CAPABILITIES sanity,
// DEFAULT_GLOBAL_PERMISSIONS are all 'ask'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEffect,
  EFFECTS,
  CAPABILITIES,
  DEFAULT_GLOBAL_PERMISSIONS,
  isCapability,
  isEffect,
} from '../src/core/permissions.js';

// --- EFFECTS / CAPABILITIES sanity ---

test('EFFECTS contains allow, ask, deny', () => {
  assert.ok(EFFECTS.includes('allow'));
  assert.ok(EFFECTS.includes('ask'));
  assert.ok(EFFECTS.includes('deny'));
  assert.equal(EFFECTS.length, 3);
});

test('CAPABILITIES contains contact_agent, register_agent, spawn_agent', () => {
  assert.ok(CAPABILITIES.includes('contact_agent'));
  assert.ok(CAPABILITIES.includes('register_agent'));
  assert.ok(CAPABILITIES.includes('spawn_agent'));
  assert.equal(CAPABILITIES.length, 3);
});

test('isEffect returns true for valid effects', () => {
  assert.equal(isEffect('allow'), true);
  assert.equal(isEffect('ask'), true);
  assert.equal(isEffect('deny'), true);
});

test('isEffect returns false for unknown strings', () => {
  assert.equal(isEffect('yes'), false);
  assert.equal(isEffect(''), false);
  assert.equal(isEffect('Allow'), false);
});

test('isCapability returns true for valid capabilities', () => {
  assert.equal(isCapability('contact_agent'), true);
  assert.equal(isCapability('register_agent'), true);
  assert.equal(isCapability('spawn_agent'), true);
});

test('isCapability returns false for unknown strings', () => {
  assert.equal(isCapability('delete_all'), false);
  assert.equal(isCapability(''), false);
});

// --- DEFAULT_GLOBAL_PERMISSIONS all 'ask' ---

test('DEFAULT_GLOBAL_PERMISSIONS has exactly one entry per capability', () => {
  for (const cap of CAPABILITIES) {
    assert.ok(cap in DEFAULT_GLOBAL_PERMISSIONS, `missing default for ${cap}`);
  }
  assert.equal(Object.keys(DEFAULT_GLOBAL_PERMISSIONS).length, CAPABILITIES.length);
});

test('DEFAULT_GLOBAL_PERMISSIONS are all ask', () => {
  for (const cap of CAPABILITIES) {
    assert.equal(
      DEFAULT_GLOBAL_PERMISSIONS[cap],
      'ask',
      `expected ask for ${cap}, got ${DEFAULT_GLOBAL_PERMISSIONS[cap]}`
    );
  }
});

// --- resolveEffect ---

test('resolveEffect returns agentOverride when it is set', () => {
  assert.equal(resolveEffect({ agentOverride: 'allow', globalDefault: 'ask' }), 'allow');
  assert.equal(resolveEffect({ agentOverride: 'deny', globalDefault: 'allow' }), 'deny');
  assert.equal(resolveEffect({ agentOverride: 'ask', globalDefault: 'allow' }), 'ask');
});

test('resolveEffect falls back to globalDefault when agentOverride is null', () => {
  assert.equal(resolveEffect({ agentOverride: null, globalDefault: 'allow' }), 'allow');
  assert.equal(resolveEffect({ agentOverride: null, globalDefault: 'ask' }), 'ask');
  assert.equal(resolveEffect({ agentOverride: null, globalDefault: 'deny' }), 'deny');
});

test('resolveEffect falls back to globalDefault when agentOverride is undefined', () => {
  assert.equal(resolveEffect({ globalDefault: 'allow' }), 'allow');
  assert.equal(resolveEffect({ globalDefault: 'deny' }), 'deny');
});

test('resolveEffect: agentOverride wins over globalDefault (allow beats deny)', () => {
  assert.equal(resolveEffect({ agentOverride: 'allow', globalDefault: 'deny' }), 'allow');
});

test('resolveEffect: agentOverride wins over globalDefault (deny beats allow)', () => {
  assert.equal(resolveEffect({ agentOverride: 'deny', globalDefault: 'allow' }), 'deny');
});
