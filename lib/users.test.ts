import { describe, expect, it } from 'vitest';
import { disableError, roleChangeError } from './users';

const owner = { id: 'o1', role: 'OWNER' as const, disabledAt: null };
const owner2 = { id: 'o2', role: 'OWNER' as const, disabledAt: null };
const member = { id: 'm1', role: 'MEMBER' as const, disabledAt: null };
const disabledOwner = { id: 'o3', role: 'OWNER' as const, disabledAt: new Date() };

describe('roleChangeError', () => {
  it('lets an owner promote a member', () => {
    expect(roleChangeError(owner, member, 'OWNER', 1)).toBeNull();
  });

  it("refuses to demote the last owner, including by themselves", () => {
    expect(roleChangeError(owner, owner, 'MEMBER', 1)).toMatch(/last owner/);
  });

  it('lets an owner demote another owner while one remains', () => {
    expect(roleChangeError(owner, owner2, 'MEMBER', 2)).toBeNull();
    expect(roleChangeError(owner, owner, 'MEMBER', 2)).toBeNull();
  });

  it('does not count a disabled owner as the last owner', () => {
    // Demoting an already-disabled owner never removes the last usable owner.
    expect(roleChangeError(owner, disabledOwner, 'MEMBER', 1)).toBeNull();
  });

  it('refuses members', () => {
    expect(roleChangeError(member, owner2, 'MEMBER', 2)).toMatch(/Only owners/);
    expect(roleChangeError(member, member, 'OWNER', 1)).toMatch(/Only owners/);
  });

  it('allows a no-op', () => {
    expect(roleChangeError(owner, owner, 'OWNER', 1)).toBeNull();
  });
});

describe('disableError', () => {
  it('lets an owner disable a member and re-enable them', () => {
    expect(disableError(owner, member, true, 1)).toBeNull();
    expect(disableError(owner, { ...member, disabledAt: new Date() }, false, 1)).toBeNull();
  });

  it('refuses disabling yourself', () => {
    expect(disableError(owner, owner, true, 2)).toMatch(/your own account/);
  });

  it('lets an owner disable another owner while one remains', () => {
    expect(disableError(owner, owner2, true, 2)).toBeNull();
  });

  it('refuses disabling the last enabled owner', () => {
    // Can only happen with inconsistent input (the actor is an owner too),
    // but the rule must hold on its own.
    expect(disableError(owner, owner2, true, 1)).toMatch(/last owner/);
  });

  it('refuses members', () => {
    expect(disableError(member, owner, true, 2)).toMatch(/Only owners/);
    expect(disableError(member, member, false, 1)).toMatch(/Only owners/);
  });
});
