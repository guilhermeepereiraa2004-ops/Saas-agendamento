
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tfquhfhmmnbwntmkfkdo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmcXVoZmhtbW5id250bWtma2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDEyOTEsImV4cCI6MjA5MTQxNzI5MX0.11YmaEMcp-GqoNPi6Q26Ahn4o0pSEmV4aQO_lcn3u6k';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTenantDetails() {
  const { data, error } = await supabase.from('tenants').select('*').eq('slug', 'tamarapereira').single();
  if (error) {
    console.error('Error:', error);
    return;
  }
  console.log('Tenant Details:', JSON.stringify(data, null, 2));
}

checkTenantDetails();
