import { createClient } from '@supabase/supabase-js'
import jsforce from 'jsforce'

const SUPABASE_URL = 'https://uoosrrsiywklrjdhfyhi.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvb3NycnNpeXdrbHJqZGhmeWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcxMDEwNDIsImV4cCI6MjA1MjY3NzA0Mn0.Qu3zcDreG_8qAMUzKqYTRNaYsf1MuWyyJ6hhEuUtUzU'

// Salesforce credentials
const SF_USERNAME = 'dmora.curepassport@hwbazaar.com'
const SF_PASSWORD = 'Gv9!rT2m#Q'
const SF_LOGIN_URL = 'https://login.salesforce.com'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Track processed leads to avoid duplicates
const processedLeads = new Set()

// Map procedure values to Salesforce-friendly format
function mapProcedureForSalesforce(procedure) {
  const procedureMap = {
    'mommy-makeover': 'Mommy Makeover',
    'body-contouring': 'Body Contouring',
    'tummy-tuck': 'Tummy Tuck',
    'liposuction': 'Liposuction',
    'brazilian-butt-lift': 'Brazilian Butt Lift',
    'breast-augmentation': 'Breast Augmentation',
    'breast-lift': 'Breast Lift',
    'breast-reduction': 'Breast Reduction',
    'arm-lift': 'Arm Lift',
    'thigh-lift': 'Thigh Lift',
    'rhinoplasty': 'Rhinoplasty',
    'eyelid-surgery': 'Eyelid Surgery',
    'face-lift': 'Face Lift',
    'hair-transplant': 'Hair Transplant',
    'transgender-surgery': 'Transgender Surgery'
  }
  
  if (procedure && typeof procedure === 'string') {
    const lowerProc = procedure.toLowerCase().trim()
    return procedureMap[lowerProc] || procedure
  }
  return procedure
}

async function submitToSalesforce(leadData) {
  // Skip if already processed
  if (processedLeads.has(leadData.id)) {
    console.log('⏭️ Already processed:', leadData.email)
    return { success: true, skipped: true }
  }
  
  console.log('📝 Submitting lead to Salesforce:', leadData.email)
  
  try {
    // Create Salesforce connection
    const conn = new jsforce.Connection({
      loginUrl: SF_LOGIN_URL
    })
    
    // Login to Salesforce
    await conn.login(SF_USERNAME, SF_PASSWORD)
    console.log('✅ Logged into Salesforce')
    
    // Prepare lead data for Salesforce
    const sfLead = {
      FirstName: leadData.first_name || '',
      LastName: leadData.last_name || '',
      Email: leadData.email,
      Phone: leadData.phone || '',
      PostalCode: leadData.zip_code || '',
      LeadSource: 'CurePassport',
      Description: leadData.medical_history_notes || '',
      
      // Custom fields (assuming these exist in Salesforce)
      Procedure__c: mapProcedureForSalesforce(leadData.procedure_interests),
      Timeline_Months__c: leadData.timeline_months || 6,
      Consent_TCPA__c: leadData.consent_tcpa || true,
      Preferred_Location__c: leadData.preferred_location || '',
      Budget_Range__c: leadData.budget_range || '',
      Urgency_Level__c: leadData.urgency_level || 'Medium',
      Consultation_Type__c: leadData.consultation_type || 'Virtual',
      Preferred_Contact_Method__c: leadData.preferred_contact_method || 'Phone',
      Insurance_Coverage__c: leadData.insurance_coverage || 'No',
      Referral_Source__c: leadData.referral_source || 'Website',
      SMS_Opt_In__c: leadData.sms_opt_in || false,
      
      // UTM tracking fields (if they exist in Salesforce)
      utm_source__c: leadData.utm_source || '',
      utm_medium__c: leadData.utm_medium || '',
      utm_campaign__c: leadData.utm_campaign || '',
      utm_term__c: leadData.utm_term || '',
      utm_content__c: leadData.utm_content || ''
    }
    
    // Remove any undefined or null custom fields that might not exist
    Object.keys(sfLead).forEach(key => {
      if (sfLead[key] === undefined || sfLead[key] === null) {
        delete sfLead[key]
      }
    })
    
    // Create lead in Salesforce
    const result = await conn.sobject('Lead').create(sfLead)
    
    if (result.success) {
      console.log('✅ Lead created in Salesforce. ID:', result.id)
      
      // Mark as processed
      processedLeads.add(leadData.id)
      
      // Update Supabase record
      try {
        await supabase
          .from('consultation_requests')
          .update({ 
            submitted_to_salesforce: true,
            salesforce_id: result.id,
            submitted_at: new Date().toISOString()
          })
          .eq('id', leadData.id)
      } catch (e) {
        console.log('Could not update Supabase record:', e.message)
      }
      
      return { success: true, salesforceId: result.id }
    } else {
      console.error('❌ Failed to create lead:', result.errors)
      return { success: false, errors: result.errors }
    }
    
  } catch (error) {
    console.error('❌ Salesforce error:', error.message)
    
    // Log error in Supabase
    try {
      await supabase
        .from('consultation_requests')
        .update({ 
          submission_error: error.message,
          submission_attempted_at: new Date().toISOString()
        })
        .eq('id', leadData.id)
    } catch (e) {
      console.log('Could not log error in Supabase')
    }
    
    return { success: false, error: error.message }
  }
}

async function processExistingLeads() {
  console.log('🔍 Checking for unprocessed leads...')
  
  // First try to get leads not yet submitted to Salesforce
  let { data } = await supabase
    .from('consultation_requests')
    .select('*')
    .or('submitted_to_salesforce.is.null,submitted_to_salesforce.eq.false')
    .order('created_at', { ascending: true })
    .limit(10)
  
  // If the column doesn't exist, just get recent leads
  if (!data) {
    const result = await supabase
      .from('consultation_requests')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(10)
    data = result.data
  }
  
  if (data?.length) {
    console.log(`📋 Processing ${data.length} leads`)
    for (const lead of data) {
      await submitToSalesforce(lead)
      await new Promise(r => setTimeout(r, 2000)) // 2 second delay between submissions
    }
  } else {
    console.log('✨ No unprocessed leads found')
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
        await submitToSalesforce(payload.new)
      }
    )
    .subscribe((status) => {
      console.log('📡 Realtime subscription status:', status)
    })

  // Polling backup (checks every 30 seconds for recent leads)
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
          await submitToSalesforce(lead)
        }
      }
    }
  }, 30000) // Check every 30 seconds
}

async function main() {
  console.log('🚀 Starting Salesforce Integration')
  console.log('================================')
  
  // Test Salesforce connection on startup
  try {
    const conn = new jsforce.Connection({ loginUrl: SF_LOGIN_URL })
    await conn.login(SF_USERNAME, SF_PASSWORD)
    console.log('✅ Salesforce connection verified')
    await conn.logout()
  } catch (error) {
    console.error('❌ Could not connect to Salesforce:', error.message)
    console.log('Will retry with each lead submission...')
  }
  
  await processExistingLeads()
  await startRealtimeListener()
  console.log('💚 Running!')
  console.log('================================')
  
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
