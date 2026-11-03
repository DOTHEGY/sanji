// Public project configuration, never a service_role/secret key.
export const supabaseUrl = "https://ofasbfpeapbdcotnptvz.supabase.co";
export const supabaseKey = "sb_publishable_fOPRjKyeYvvSPCKoso3hXw_fjPXY4eV";

export const edgeFunctionName = "bright-function";
export const edgeFunctionUrl =
  supabaseUrl + "/functions/v1/" + edgeFunctionName;

// Separate manual Instagram inbox; existing bright-function is unchanged.
export const instagramInboxFunctionUrl = supabaseUrl + "/functions/v1/instagram-inbox";
// Independent authenticated collection snapshot API; no existing function replacement.
export const dotSnapshotFunctionUrl = supabaseUrl + "/functions/v1/dot-snapshot-direct";
// Separate owner-authenticated one-click creator proposal state and preparation.
export const creatorOneClickFunctionUrl = supabaseUrl + "/functions/v1/creator-one-click";
