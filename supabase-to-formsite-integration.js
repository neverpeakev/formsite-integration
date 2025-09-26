import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'

const SUPABASE_URL = 'https://uoosrrsiywklrjdhfyhi.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvb3NycnNpeXdrbHJqZGhmeWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcxMDEwNDIsImV4cCI6MjA1MjY3NzA0Mn0.Qu3zcDreG_8qAMUzKqYTRNaYsf1MuWyyJ6hhEuUtUzU'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const FORM_URL = 'https://fs29.formsite.com/res/showFormEmbed?EParam=m_OmK8apOTAKaBL53IMiRtlARFv6bfoFFzpUCZwnDno'

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
  console.log('📝 Submitting lead:', leadData.email)
  
 const browser = await puppeteer.launch({ 
  headless: true,
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
})
  
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(FORM_URL, { waitUntil: 'networkidle2' })
    await page.waitForSelector('form', { timeout: 15000 })
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
    
    // Set specialty dropdown
    const specialty = mapProcedureToSpecialty(leadData.procedure_interests)
    await page.select('select', specialty).catch(() => {})
    
    // Submit
    await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"]')
      if (btn) btn.click()
      else document.querySelector('form')?.submit()
    })
    
    await page.waitForNavigation({ timeout: 10000 }).catch(() => {})
    console.log('✅ Success:', leadData.email)
    return { success: true }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    return { success: false, error: error.message }
  } finally {
    await browser.close()
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
  console.log('👂 Listening for new leads...')
  supabase
    .channel('consultation-requests')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'consultation_requests' },
      async (payload) => {
        console.log('📥 New lead:', payload.new.email)
        await submitToFormsite(payload.new)
      }
    )
    .subscribe()
}

async function main() {
  console.log('🚀 Starting Railway Integration')
  await processExistingLeads()
  await startRealtimeListener()
  console.log('💚 Running!')
  
  // Keep alive
  setInterval(() => console.log('❤️ Alive'), 300000)
}

main().catch(console.error)
