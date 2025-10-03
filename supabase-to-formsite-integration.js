import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-chromium'

const SUPABASE_URL = 'https://uoosrrsiywklrjdhfyhi.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvb3NycnNpeXdrbHJqZGhmeWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcxMDEwNDIsImV4cCI6MjA1MjY3NzA0Mn0.Qu3zcDreG_8qAMUzKqYTRNaYsf1MuWyyJ6hhEuUtUzU'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const FORM_URL = 'https://fs29.formsite.com/res/showFormEmbed?EParam=m_OmK8apOTAKaBL53IMiRtlARFv6bfoFFzpUCZwnDno'

// Track processed leads to avoid duplicates
const processedLeads = new Set()

function mapProcedureToSpecialty(procedure) {
  const specialtyMap = {
    'mommy_makeover': 'Mommy Makeover',
    'body_contouring': 'Body Contouring After Weight Loss',
    'tummy_tuck': 'Tummy Tuck',
    'liposuction': 'Liposuction',
    'bbl': 'Brazilian Butt Lift',
    'brazilian_butt_lift': 'Brazilian Butt Lift',
    'breast_augmentation': 'Breast Augmentation',
    'breast_lift': 'Breast Lift',
    'breast_reduction': 'Breast Reduction',
    'arm_lift': 'Arm Lift',
    'thigh_lift': 'Thigh Lift',
    'rhinoplasty': 'Rhinoplasty',
    'eyelid_surgery': 'Eyelid Surgery',
    'face_lift': 'Face Lift',
    'hair_transplant': 'Hair Transplant',
    'transgender_surgery': 'Transgender Surgery'
  }
  
  if (procedure && typeof procedure === 'string') {
    const lowerProc = procedure.toLowerCase()
    for (const [key, value] of Object.entries(specialtyMap)) {
      if (lowerProc.includes(key)) return value
    }
  }
  return 'Mommy Makeover'
}

async function submitToFormsite(leadData) {
  // Skip if already processed
  if (processedLeads.has(leadData.id)) {
    console.log('⏭️ Already processed:', leadData.email)
    return { success: true, skipped: true }
  }
  
  console.log('📝 Submitting lead:', leadData.email)
  
  let browser = null
  
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    
    const page = await browser.newPage()
    await page.goto(FORM_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    
    // Fill fields
    await page.evaluate((data) => {
      const firstName = document.querySelector('input[name*="First"], input[aria-label*="First Name"]')
      if (firstName) firstName.value = data.first_name || ''
      
      const lastName = document.querySelector('input[name*="Last"], input[aria-label*="Last Name"]')
      if (lastName) lastName.value = data.last_name || ''
      
      const email = document.querySelector('input[type="email"], input[name*="Email"]')
      if (email) email.value = data.email || ''
      
      const phone = document.querySelector('input[type="tel"], input[name*="Phone"]')
      if (phone) phone.value = data.phone || ''
      
      const textareas = document.querySelectorAll('textarea')
      if (textareas[0]) textareas[0].value = data.procedure_interests || ''
      if (textareas[1]) {
        const comments = []
        if (data.medical_history_notes) comments.push('Notes: ' + data.medical_history_notes)
        if (data.preferred_location) comments.push('Location: ' + data.preferred_location)
        if (data.budget_range) comments.push('Budget: ' + data.budget_range)
        textareas[1].value = comments.join('\n')
      }
      
      const checkbox = document.querySelector('input[type="checkbox"]')
      if (checkbox && !checkbox.checked) checkbox.click()
    }, leadData)
    
    // Set specialty dropdown - improved version
    const specialty = mapProcedureToSpecialty(leadData.procedure_interests)
    try {
      const dropdownSet = await page.evaluate((specialtyValue) => {
        let select = document.querySelector('select[name*="Specialty"]')
        if (!select) select = document.querySelector('select[aria-label*="Specialty"]')
        if (!select) select = document.querySelector('select#Specialty')
        if (!select) select = document.querySelector('select')
        
        if (select) {
          const options = select.querySelectorAll('option')
          for (const option of options) {
            if (option.textContent.trim() === specialtyValue) {
              select.value = option.value
              select.dispatchEvent(new Event('change', { bubbles: true }))
              return true
            }
          }
        }
        return false
      }, specialty)
      
      if (!dropdownSet) {
        console.log(`Could not set specialty dropdown to: ${specialty}`)
        console.log(`Original procedure interest: ${leadData.procedure_interests}`)
      }
    } catch (e) {
      console.log('Error with specialty dropdown:', e.message)
    }
    
    // Submit
    await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"]')
      if (btn) btn.click()
      else document.querySelector('form')?.submit()
    })
    
    await page.waitForTimeout(3000)
    console.log('✅ Success:', leadData.email)
    
    // Mark as processed
    processedLeads.add(leadData.id)
    
    // Update database if column exists
    try {
      await supabase
        .from('consultation_requests')
        .update({ submitted_to_formsite: true })
        .eq('id', leadData.id)
    } catch (e) {
      // Column might not exist, that's okay
    }
    
    return { success: true }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    return { success: false, error: error.message }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

async function processExistingLeads() {
  console.log('🔍 Checking for leads...')
  const { data } = await supabase
    .from('consultation_requests')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(10)
  
  if (data?.length) {
    console.log(`📋 Processing ${data.length} leads`)
    for (const lead of data) {
      await submitToFormsite(lead)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}

async function startRealtimeListener() {
  console.log('👂 Setting up real-time listener...')
  
  // Subscribe to INSERT events
  const channel = supabase
    .channel('db-changes')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'consultation_requests'
      },
      async (payload) => {
        console.log('🔔 New lead detected via realtime:', payload.new.email)
        await submitToFormsite(payload.new)
      }
    )
    .subscribe((status) => {
      console.log('📡 Realtime subscription status:', status)
    })

  // Also add polling as backup (checks every 30 seconds)
  setInterval(async () => {
    const { data } = await supabase
      .from('consultation_requests')
      .select('*')
      .gt('created_at', new Date(Date.now() - 120000).toISOString()) // Last 2 minutes
      .order('created_at', { desc: true })
      .limit(5)
    
    if (data?.length) {
      for (const lead of data) {
        if (!processedLeads.has(lead.id)) {
          console.log('🔍 Found new lead via polling:', lead.email)
          await submitToFormsite(lead)
        }
      }
    }
  }, 30000) // Check every 30 seconds
}

async function main() {
  console.log('🚀 Starting Railway Integration')
  await processExistingLeads()
  await startRealtimeListener()
  console.log('💚 Running!')
  
  // Keep alive heartbeat
  setInterval(() => {
    console.log('❤️ Alive at ' + new Date().toISOString())
  }, 300000) // Every 5 minutes
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...')
  process.exit(0)
})
