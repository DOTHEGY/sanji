import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from './supabase-config.js';
import { startStandaloneYouTubeWedding } from './youtube-wedding-mount.js';

const root = document.getElementById('wedding-root');
if (root) {
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
  });
  startStandaloneYouTubeWedding(root, client);
}
