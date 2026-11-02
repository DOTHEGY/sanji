// Public project configuration, never a service_role/secret key.
export const supabaseUrl = "https://ofasbfpeapbdcotnptvz.supabase.co";
export const supabaseKey = "sb_publishable_fOPRjKyeYvvSPCKoso3hXw_fjPXY4eV";

export const edgeFunctionName = "bright-function";
export const edgeFunctionUrl =
  supabaseUrl + "/functions/v1/" + edgeFunctionName;

// Independent authenticated collection snapshot API; no existing function replacement.
export const dotSnapshotFunctionUrl = supabaseUrl + "/functions/v1/dot-snapshot-direct";
