"use node";

import { action } from './_generated/server.js';
import { api, internal } from './_generated/api.js';
import { v } from 'convex/values';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { validEmail, validUsername } from './lib.js';

function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password, stored) {
  try {
    const [kind, salt, digest] = stored.split('$');
    if (kind !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(digest)) return false;
    const actual = scryptSync(password, salt, 64), expected = Buffer.from(digest, 'hex');
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}

async function storeProfilePhoto(ctx, image) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image || '');
  if (!match || match[2].length > 1_050_000) throw new Error('Choose a compressed profile photo under 750 KB.');
  const bytes = Buffer.from(match[2], 'base64');
  const type = `image/${match[1]}`;
  const valid = type === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
    : type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid || bytes.length < 1000 || bytes.length > 750_000)
    throw new Error('Profile photo must be a PNG, JPG, or WebP image under 750 KB.');
  return ctx.storage.store(new Blob([bytes], { type }));
}

export const login = action({ args: { identifier: v.string(), password: v.string(), remember: v.boolean() }, handler: async (ctx, args) => {
  const identifier = args.identifier.trim().toLowerCase();
  if (identifier.length > 200 || (!validUsername(identifier) && !validEmail(identifier)) || args.password.length > 1024)
    throw new Error('Invalid username, admin email, or password.');
  const attempt = await ctx.runQuery(internal.core.loginAttempt, { email: identifier });
  if (attempt && attempt.until > Date.now() && attempt.count >= 5) throw new Error('Too many attempts. Try again later.');
  const user = await ctx.runQuery(internal.core.userForLogin, { identifier });
  if (!user?.active || !passwordMatches(args.password, user.passwordHash)) {
    await ctx.runMutation(internal.core.recordLoginFailure, { email: identifier });
    throw new Error('Invalid username, admin email, or password.');
  }
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await ctx.runMutation(internal.core.issueSession, { userId: user._id, tokenHash, remember: args.remember, email: identifier });
  return { ...result, token };
}});

export const bootstrapAdmin = action({ args: {}, handler: async (ctx) => {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
  if (!email || !password || password.length < 8) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) in Convex environment first.');
  return await ctx.runMutation(internal.core.bootstrapAdmin, { email, name, passwordHash: passwordHash(password) });
}});

export const registerFirstAdmin = action({ args: {
  name: v.string(), email: v.string(), password: v.string(), remember: v.boolean(),
  profileImage: v.optional(v.string())
}, handler: async (ctx, args) => {
  if (!(await ctx.runQuery(api.core.signupStatus, {})).available)
    throw new Error('An admin account already exists. Please sign in.');
  if (args.password.length < 8 || args.password.length > 1024)
    throw new Error('Password must have 8–1024 characters.');
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  let profileImageId;
  try {
    if (args.profileImage) profileImageId = await storeProfilePhoto(ctx, args.profileImage);
    const result = await ctx.runMutation(internal.core.registerFirstAdmin, {
      name: args.name, email: args.email, passwordHash: passwordHash(args.password),
      tokenHash, remember: args.remember, ...(profileImageId ? { profileImageId } : {})
    });
    return { ...result, token };
  } catch (error) {
    if (profileImageId) await ctx.storage.delete(profileImageId);
    throw error;
  }
}});

export const setProfilePhoto = action({ args: {
  token: v.string(), profileImage: v.optional(v.string()), remove: v.boolean()
}, handler: async (ctx, args) => {
  await ctx.runQuery(internal.core.userForToken, { token: args.token, role: 'admin' });
  let profileImageId;
  try {
    if (args.profileImage) profileImageId = await storeProfilePhoto(ctx, args.profileImage);
    return await ctx.runMutation(internal.core.updateProfileImage, {
      token: args.token, remove: args.remove, ...(profileImageId ? { profileImageId } : {})
    });
  } catch (error) {
    if (profileImageId) await ctx.storage.delete(profileImageId);
    throw error;
  }
}});

export const deleteAdminAccount = action({ args: {
  token: v.string(), password: v.string(), confirmation: v.string()
}, handler: async (ctx, args) => {
  if (args.confirmation !== 'DELETE') throw new Error('Type DELETE to confirm.');
  const user = await ctx.runQuery(internal.core.userForToken, { token: args.token, role: 'admin' });
  if (!passwordMatches(args.password, user.passwordHash)) throw new Error('Current password is incorrect.');
  return ctx.runMutation(internal.core.deleteAdminAccount, { token: args.token, oldHash: user.passwordHash });
}});

export const changePassword = action({ args: { token: v.string(), currentPassword: v.string(), newPassword: v.string() }, handler: async (ctx, args) => {
  if (args.newPassword.length < 8 || args.newPassword.length > 1024) throw new Error('New password must have 8–1024 characters.');
  const user = await ctx.runQuery(internal.core.userForToken, { token: args.token });
  if (!passwordMatches(args.currentPassword, user.passwordHash)) throw new Error('Current password is incorrect.');
  return await ctx.runMutation(internal.core.changePassword, { token: args.token, oldHash: user.passwordHash, newHash: passwordHash(args.newPassword) });
}});

export const createEmployee = action({ args: { token: v.string(), input: v.any() }, handler: async (ctx, { token, input }) => {
  await ctx.runQuery(internal.core.userForToken, { token, role: 'admin' });
  if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 1024) throw new Error('Temporary password must have 8–1024 characters.');
  const { password, ...profile } = input;
  return await ctx.runMutation(internal.core.createEmployee, { token, input: { ...profile, passwordHash: passwordHash(password) } });
}});

export const updateEmployee = action({ args: { token: v.string(), id: v.string(), input: v.any() }, handler: async (ctx, { token, id, input }) => {
  await ctx.runQuery(internal.core.userForToken, { token, role: 'admin' });
  if (input.password && (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 1024)) throw new Error('New password must have 8–1024 characters.');
  const { password, ...profile } = input;
  return await ctx.runMutation(internal.core.updateEmployee, { token, id,
    input: { ...profile, ...(password ? { passwordHash: passwordHash(password) } : {}) } });
}});
