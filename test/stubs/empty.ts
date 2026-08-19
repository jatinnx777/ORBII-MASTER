// Catch-all stub for native/network modules a pure unit test never calls.
export const supabase = {
  rpc: async () => ({ data: null, error: null }),
  from: () => ({ select: async () => ({ data: null, error: null }) }),
  auth: { getSession: async () => ({ data: { session: null } }) },
};
export default {};
