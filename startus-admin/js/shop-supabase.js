import { SHOP_SUPABASE_URL, SHOP_SUPABASE_ANON_KEY } from './shop-config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const shopSupabase = createClient(SHOP_SUPABASE_URL, SHOP_SUPABASE_ANON_KEY);
