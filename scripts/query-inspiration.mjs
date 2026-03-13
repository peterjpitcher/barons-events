import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf-8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);

// Test with anon key (like the user session would use — though board uses service role)
const anonDb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const adminDb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const today = '2026-03-12';
const windowEnd = '2026-09-08';

// Admin query (what listPlanningBoardData uses)
const { data: adminData, error: adminError } = await adminDb
  .from('planning_inspiration_items')
  .select('event_name, event_date')
  .gte('event_date', today)
  .lte('event_date', windowEnd)
  .order('event_date');

console.log('Admin query (service role):', adminError ? `ERROR: ${adminError.message}` : `${adminData.length} items`);

// Anon query (RLS test — unauthenticated)
const { data: anonData, error: anonError } = await anonDb
  .from('planning_inspiration_items')
  .select('event_name, event_date')
  .gte('event_date', today)
  .lte('event_date', windowEnd)
  .limit(1);

console.log('Anon query (unauthenticated):', anonError ? `ERROR: ${anonError.message}` : `${anonData.length} items (RLS blocks unauthenticated — expected)`);

// Check addDays logic: today='2026-03-12', +180
const d = new Date('2026-03-12');
d.setDate(d.getDate() + 180);
console.log('\naddDays("2026-03-12", 180) should be:', d.toISOString().split('T')[0]);
console.log('Query window end used above:', windowEnd);
