
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tfquhfhmmnbwntmkfkdo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmcXVoZmhtbW5id250bWtma2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDEyOTEsImV4cCI6MjA5MTQxNzI5MX0.11YmaEMcp-GqoNPi6Q26Ahn4o0pSEmV4aQO_lcn3u6k';
const supabase = createClient(supabaseUrl, supabaseKey);

const services = [
  { id: "s1", name: "Mão", price: 30, duration: 28 },
  { id: "s2", name: "Pé", price: 30, duration: 15 },
  { id: "s3", name: "Pé e mão", price: 60, duration: 20 },
  { id: "s4", name: "SPA dos Pés", price: 45, duration: 13 }
];

const workingHours = [
  { day: 1, start: '09:00', end: '18:00' }, // Segunda
  { day: 3, start: '09:00', end: '18:00' }, // Quarta
  { day: 4, start: '09:00', end: '18:00' }, // Quinta
  { day: 5, start: '09:00', end: '18:00' }, // Sexta
  { day: 6, start: '09:00', end: '14:00' }  // Sábado
];

async function updateTenant() {
  const { error } = await supabase.from('tenants').update({
    services: services,
    working_hours: workingHours
  }).eq('slug', 'tamarapereira');

  if (error) {
    console.error('Error updating tenant:', error);
  } else {
    console.log('Tenant updated successfully!');
  }
}

updateTenant();
