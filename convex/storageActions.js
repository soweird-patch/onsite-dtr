import { action } from './_generated/server.js';
import { internal } from './_generated/api.js';
import { v } from 'convex/values';

export const punch = action({ args: { token: v.string(), input: v.any() }, handler: async (ctx, { token, input }) => {
  await ctx.runQuery(internal.core.userForToken, { token, role: 'employee' });
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(input.selfie || '');
  if (!match || match[2].length > 1_050_000) throw new Error('A compressed selfie photo is required (maximum 750 KB).');
  const binary = atob(match[2]);
  if (binary.length < 1000 || binary.length > 750_000) throw new Error('Selfie must be 1 KB–750 KB.');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const type = `image/${match[1]}`;
  const selfieId = await ctx.storage.store(new Blob([bytes], { type }));
  try {
    const { selfie: _selfie, ...proof } = input;
    return await ctx.runMutation(internal.core.submitPunch, { token, input: proof, selfieId });
  } catch (error) {
    await ctx.storage.delete(selfieId);
    throw error;
  }
}});

export const selfie = action({ args: { token: v.string(), id: v.string() }, handler: async (ctx, args) => {
  const storageId = await ctx.runQuery(internal.core.selfieFor, args);
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new Error('Photo not found.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${blob.type};base64,${btoa(binary)}`;
}});

export const setBranding = action({ args: { token: v.string(), appName: v.string(),
  logo192: v.optional(v.string()), logo512: v.optional(v.string()), removeLogo: v.boolean() }, handler: async (ctx, args) => {
  await ctx.runQuery(internal.core.userForToken, { token: args.token, role: 'admin' });
  if (!!args.logo192 !== !!args.logo512) throw new Error('Both logo sizes are required.');
  const uploaded = [];
  try {
    for (const image of [args.logo192, args.logo512].filter(Boolean)) {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if (!match || match[1].length > 2_700_000) throw new Error('Logo must be a PNG image under 2 MB.');
      const binary = atob(match[1]);
      if (binary.length < 100 || binary.length > 2_000_000) throw new Error('Logo must be a PNG image under 2 MB.');
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      uploaded.push(await ctx.storage.store(new Blob([bytes], { type: 'image/png' })));
    }
    const result = await ctx.runMutation(internal.core.updateBranding, { token: args.token, appName: args.appName,
      ...(uploaded.length ? { logo192Id: uploaded[0], logo512Id: uploaded[1] } : {}), removeLogo: args.removeLogo });
    if (uploaded.length || args.removeLogo) {
      for (const oldId of [result.oldLogo192Id, result.oldLogo512Id].filter(Boolean)) {
        try { await ctx.storage.delete(oldId); } catch { /* Branding was already saved. */ }
      }
    }
    return { ok: true };
  } catch (error) {
    for (const id of uploaded) await ctx.storage.delete(id);
    throw error;
  }
}});
