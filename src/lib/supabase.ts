import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tfquhfhmmnbwntmkfkdo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmcXVoZmhtbW5id250bWtma2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDEyOTEsImV4cCI6MjA5MTQxNzI5MX0.11YmaEMcp-GqoNPi6Q26Ahn4o0pSEmV4aQO_lcn3u6k';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
