// Members and roles. Two roles (OWNER, MEMBER) plus a disabled state.
//
// The rules live in the pure functions at the top so they can be tested
// without a database; setRole() and setDisabled() apply them.

import type { Role, User } from '@prisma/client';
import { db } from './db';

type Actor = Pick<User, 'id' | 'role'>;
type Target = Pick<User, 'id' | 'role' | 'disabledAt'>;

/**
 * Why `actor` may not change `target`'s role to `newRole`, or null if they
 * may. `enabledOwnerCount` is the number of owners who can still sign in.
 */
export function roleChangeError(
  actor: Actor,
  target: Target,
  newRole: Role,
  enabledOwnerCount: number
): string | null {
  if (actor.role !== 'OWNER') {
    return 'Only owners can change roles';
  }
  if (target.role === newRole) {
    return null;
  }
  const targetIsEnabledOwner = target.role === 'OWNER' && !target.disabledAt;
  if (targetIsEnabledOwner && newRole !== 'OWNER' && enabledOwnerCount <= 1) {
    return "The last owner can't be demoted";
  }
  return null;
}

/** Why `actor` may not disable or re-enable `target`, or null if they may. */
export function disableError(
  actor: Actor,
  target: Target,
  disabled: boolean,
  enabledOwnerCount: number
): string | null {
  if (actor.role !== 'OWNER') {
    return 'Only owners can disable accounts';
  }
  if (!disabled) {
    return null;
  }
  if (actor.id === target.id) {
    return "You can't disable your own account";
  }
  const targetIsEnabledOwner = target.role === 'OWNER' && !target.disabledAt;
  if (targetIsEnabledOwner && enabledOwnerCount <= 1) {
    return "The last owner can't be disabled";
  }
  return null;
}

export class MemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberError';
  }
}

function countEnabledOwners(tx: Pick<typeof db, 'user'>): Promise<number> {
  return tx.user.count({ where: { role: 'OWNER', disabledAt: null } });
}

/** Changes a user's role. Throws MemberError if the rules forbid it. */
export async function setRole(actor: Actor, targetId: string, newRole: Role): Promise<User> {
  return db.$transaction(
    async tx => {
      const target = await tx.user.findUnique({ where: { id: targetId } });
      if (!target) {
        throw new MemberError('No such user');
      }
      const error = roleChangeError(actor, target, newRole, await countEnabledOwners(tx));
      if (error) {
        throw new MemberError(error);
      }
      return tx.user.update({ where: { id: targetId }, data: { role: newRole } });
    },
    // Two owners demoting each other at the same moment must not both succeed.
    { isolationLevel: 'Serializable' }
  );
}

/**
 * Disables (or re-enables) an account. Disabling revokes every session the
 * user has; their progress and settings are kept.
 */
export async function setDisabled(actor: Actor, targetId: string, disabled: boolean): Promise<User> {
  return db.$transaction(
    async tx => {
      const target = await tx.user.findUnique({ where: { id: targetId } });
      if (!target) {
        throw new MemberError('No such user');
      }
      const error = disableError(actor, target, disabled, await countEnabledOwners(tx));
      if (error) {
        throw new MemberError(error);
      }
      if (disabled) {
        await tx.session.deleteMany({ where: { userId: targetId } });
      }
      return tx.user.update({
        where: { id: targetId },
        data: { disabledAt: disabled ? (target.disabledAt ?? new Date()) : null },
      });
    },
    { isolationLevel: 'Serializable' }
  );
}
