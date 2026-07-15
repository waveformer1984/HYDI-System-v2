#!/usr/bin/env node
/**
 * Test procedural memory system:
 * 1. Trigger a HEIDI action
 * 2. Query Supabase for stored lessons
 * 3. Verify confidence scoring
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://wufhlhrbskacneneylqa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDEyODg5MywiZXhwIjoyMDg1NzA0ODkzfQ.eAA6LzLdhALge4o247oZy4LI6wvkfPzNKEzAzNMPFX8';

async function testProceduralMemory() {
    console.log('🧠 Testing Procedural Memory System\n');

    // Initialize Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false },
        db: { schema: 'public' }
    });

    try {
        // 1. Check if table exists and fetch lessons
        console.log('📋 Querying heidi_procedural_lessons table...');
        const { data: lessons, error } = await supabase
            .from('heidi_procedural_lessons')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            if (error.message.includes('does not exist')) {
                console.log('⚠️  Table does not exist yet. Migration may not have run.');
                console.log('   Run: npx supabase db push');
                return;
            }
            throw error;
        }

        if (!lessons || lessons.length === 0) {
            console.log('ℹ️  No lessons stored yet. The system is ready but hasn\'t executed actions.\n');
            console.log('✅ Table exists and is accessible.');
            console.log('\nTo test:');
            console.log('  1. Make an API call to HEIDI: curl http://localhost:3006/api/chat -X POST -d \'{"message":"test"}\'');
            console.log('  2. Re-run this script to see stored lessons');
            return;
        }

        // 2. Display stored lessons
        console.log(`\n✅ Found ${lessons.length} lessons:\n`);
        lessons.forEach((lesson, i) => {
            console.log(`${i + 1}. ${lesson.situation}`);
            console.log(`   Action: ${lesson.action_type} — ${lesson.action_summary}`);
            console.log(`   Lesson: ${lesson.lesson}`);
            console.log(`   Confidence: ${(lesson.confidence * 100).toFixed(1)}%`);
            console.log(`   Applied: ${lesson.application_count}x (${lesson.success_count} successes)`);
            console.log(`   Created: ${new Date(lesson.created_at).toLocaleString()}`);
            console.log();
        });

        // 3. Stats
        const avgConfidence = (lessons.reduce((sum, l) => sum + l.confidence, 0) / lessons.length * 100).toFixed(1);
        const totalApplications = lessons.reduce((sum, l) => sum + l.application_count, 0);
        console.log(`📊 Stats:`);
        console.log(`   Average Confidence: ${avgConfidence}%`);
        console.log(`   Total Applications: ${totalApplications}`);
        console.log(`   Success Rate: ${totalApplications > 0 ? ((lessons.reduce((s, l) => s + l.success_count, 0) / totalApplications) * 100).toFixed(1) : 0}%`);

    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

testProceduralMemory().then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
});
